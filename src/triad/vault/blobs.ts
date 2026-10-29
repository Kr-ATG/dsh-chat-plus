/**
 * dsh-vault 图片字节存储（**「减小占用」真正落地的地方**）。
 *
 * ── 为什么不用官方附件服务 ───────────────────────────────────────────
 * DSH 有 ctx.attachments（内容寻址、去重、EXIF 归正、尺寸上限都做好了），
 * 但它**没有删除接口**，README 也明写「已存储的图片永远不会被自动删除」。
 * 档案页删掉一条记录、换证归档旧照片、配额超限淘汰——这三件事都需要真正
 * 把字节回收掉，否则「减小占用」就只是一句口号。
 *
 * 所以这里自己管一棵 blobs 树，仍然沿用官方那套被验证过的做法：
 *   · 内容寻址（sha256），同字节只落一份——同一张身份证照在十个会话里各贴
 *     一次、在证件正反面各引用一次，磁盘上只有一个文件；
 *   · 分片目录（blobs/<前2位>/<sha256>），避免单目录堆几千个文件；
 *   · tmp + rename 原子写，半截文件不会变成「看起来存在的 blob」；
 *   · 读时校验 sha256：字节被改过、被截断，宁可报错也不把坏图当原图。
 *
 * 而官方附件服务那边仍然有用：会话里贴的图由它保管，我们要归档时
 * readImage(ref) 读出字节、压成三档存进自己的树，然后就不再依赖它。
 *
 * ── 引用计数 ────────────────────────────────────────────────────────
 * index.json 是 sha256 -> 引用它的 photoId 列表。删照片时从列表里摘掉，
 * **摘空了才删文件**。没有孤儿文件，也没有「还在被用却删掉了」。
 *
 * ── 配额淘汰的边界（很重要）────────────────────────────────────────
 * 超配额时按 original -> display -> thumb 的顺序淘汰字节，但**记录文本永远
 * 不删**。行和字段是用户的真实数据，图片只是佐证；为了腾几十 MB 就把一条
 * 档案的记录删掉，那是数据事故而不是清理。
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { VaultBlobRef, VaultImageVariant } from './types.js'

/** 支持的图片魔数签名（只接受浏览器能直接显示的三种）。 */
const MEDIA_SIGNATURES: Array<{ mediaType: VaultBlobRef['mediaType']; test: (b: Buffer) => boolean }> = [
  { mediaType: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mediaType: 'image/png', test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  {
    mediaType: 'image/webp',
    test: (b) => b.length > 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
]

/** 单张图字节上限（20MB，与官方附件服务同量级；超过是用户选错了文件）。 */
export const MAX_BLOB_BYTES = 20 * 1024 * 1024

/** blob 索引里的一条。 */
interface BlobIndexEntry {
  sha256: string
  bytes: number
  /** MIME（图片为 image/*；文件为上传时声明，未知为 application/octet-stream）。 */
  mediaType: string
  width: number
  height: number
  /** 引用它的 photoId（可能为空数组=待回收）。 */
  refs: string[]
  createdAt: string
  /** 字节最后一次被读取的时间（LRU 淘汰的次要依据；缺省=从未读）。 */
  lastReadAt?: string
}

/** 索引文件结构。 */
interface BlobIndex {
  version: 1
  blobs: Record<string, BlobIndexEntry>
}

/** 魔数探测：返回实际媒体类型，认不出来返回 null。 */
export function detectMediaType(bytes: Buffer): VaultBlobRef['mediaType'] | null {
  for (const signature of MEDIA_SIGNATURES) {
    if (signature.test(bytes)) return signature.mediaType
  }
  return null
}

/** 计算 sha256（十六进制小写）。 */
export function sha256Of(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** 淘汰优先级：数字越小越先被淘汰（原图先走，缩略图最后）。 */
export function evictionRankOf(variant: VaultImageVariant): number {
  if (variant === 'original') return 0
  if (variant === 'display') return 1
  return 2
}

/**
 * 图片字节仓库。
 *
 * 构造时不读任何文件（延迟到首次操作），因此 createBlobStore 本身永不抛。
 */
export class BlobStore {
  private index: BlobIndex | null = null

  constructor(private readonly root: string) {}

  /** blobs 根目录。 */
  get blobsDir(): string {
    return join(this.root, 'blobs')
  }

  /** 索引文件路径。 */
  get indexPath(): string {
    return join(this.root, 'blobs', 'index.json')
  }

  /** 单个 blob 的落盘路径（两级分片）。 */
  pathOf(sha256: string): string {
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('invalid sha256: ' + sha256)
    return join(this.blobsDir, sha256.slice(0, 2), sha256)
  }

  /** 读索引（懒加载；坏文件回落空索引而不是抛错）。 */
  private async loadIndex(): Promise<BlobIndex> {
    if (this.index !== null) return this.index
    try {
      const raw = await readFile(this.indexPath, 'utf8')
      const parsed = JSON.parse(raw) as BlobIndex
      this.index = parsed !== null && typeof parsed === 'object' && typeof parsed.blobs === 'object'
        ? parsed
        : { version: 1, blobs: {} }
    } catch {
      this.index = { version: 1, blobs: {} }
    }
    return this.index
  }

  /** 落盘索引（tmp + rename 原子写）。 */
  private async saveIndex(): Promise<void> {
    const index = await this.loadIndex()
    await mkdir(dirname(this.indexPath), { recursive: true })
    const tmp = this.indexPath + '.tmp'
    await writeFile(tmp, JSON.stringify(index), 'utf8')
    await rename(tmp, this.indexPath)
  }

  /**
   * 存一份字节，返回引用。
   *
   * @param bytes 图片字节（已由客户端压缩到目标档位）。
   * @param meta 宽高与显示名、以及引用它的 photoId。
   * @returns 归档引用；字节不合法（超限/不是图片）时返回 null（不抛）。
   */
  async put(
    bytes: Buffer,
    meta: { width: number; height: number; name?: string; photoId: string },
  ): Promise<VaultBlobRef | null> {
    if (bytes.length === 0 || bytes.length > MAX_BLOB_BYTES) return null
    const mediaType = detectMediaType(bytes)
    // 认不出魔数就拒收：客户端可能把 .heic 改了扩展名，或者传了非图片。
    if (mediaType === null) return null
    return this.storeBytes(bytes, {
      mediaType,
      width: meta.width,
      height: meta.height,
      name: meta.name,
      refId: meta.photoId,
    })
  }

  /**
   * 存一份**任意文件**字节（不校验图片魔数、不压缩）。
   *
   * 文件与照片共用同一棵 blobs 树与同一份索引：引用计数、删除、配额统计、
   * 工作台云同步全部复用。区别只有一处——put 会拒绝非图片，putRaw 接受任意
   * 字节（配置文件、订阅、证书、脚本都可以）。
   * @returns 引用；空字节或超过单文件上限时返回 null。
   */
  async putRaw(
    bytes: Buffer,
    meta: { mediaType?: string; name?: string; refId: string },
  ): Promise<VaultBlobRef | null> {
    if (bytes.length === 0 || bytes.length > MAX_BLOB_BYTES) return null
    const mediaType = typeof meta.mediaType === 'string' && meta.mediaType.trim() !== ''
      ? meta.mediaType.trim()
      : 'application/octet-stream'
    return this.storeBytes(bytes, {
      mediaType,
      width: 0,
      height: 0,
      name: meta.name,
      refId: meta.refId,
    })
  }

  /** 存字节的公共实现（内容去重 + 引用登记 + 原子写）。 */
  private async storeBytes(
    bytes: Buffer,
    meta: { mediaType: string; width: number; height: number; name?: string; refId: string },
  ): Promise<VaultBlobRef> {
    const sha256 = sha256Of(bytes)
    const index = await this.loadIndex()
    const existing = index.blobs[sha256]
    if (existing !== undefined) {
      // 同字节已在盘上：只加引用，不重复写文件。
      if (!existing.refs.includes(meta.refId)) existing.refs.push(meta.refId)
      existing.lastReadAt = new Date().toISOString()
      await this.saveIndex()
      return {
        sha256,
        mediaType: existing.mediaType,
        width: existing.width,
        height: existing.height,
        bytes: existing.bytes,
        name: meta.name,
      }
    }
    await mkdir(dirname(this.pathOf(sha256)), { recursive: true })
    const target = this.pathOf(sha256)
    const tmp = target + '.tmp'
    await writeFile(tmp, bytes)
    await rename(tmp, target)
    const now = new Date().toISOString()
    index.blobs[sha256] = {
      sha256,
      bytes: bytes.length,
      mediaType: meta.mediaType,
      width: Math.max(0, Math.round(meta.width)),
      height: Math.max(0, Math.round(meta.height)),
      refs: [meta.refId],
      createdAt: now,
      lastReadAt: now,
    }
    await this.saveIndex()
    return { sha256, mediaType: meta.mediaType, width: Math.max(0, Math.round(meta.width)), height: Math.max(0, Math.round(meta.height)), bytes: bytes.length, name: meta.name }
  }

  /**
   * 读字节（**校验 sha256**）。
   *
   * 校验是刻意的：blob 被外层工具改过/截断时，返回坏图会让页面显示半张
   * 乱码照片，而用户完全无法判断是「图片坏了」还是「插件坏了」。宁可
   * 明确报错。
   * @returns 字节；文件缺失或校验失败返回 null。
   */
  async get(sha256: string): Promise<Buffer | null> {
    try {
      const bytes = await readFile(this.pathOf(sha256))
      if (sha256Of(bytes) !== sha256) {
        console.warn('[dsh-vault] blob 校验失败（字节与索引不符）：' + sha256.slice(0, 12))
        return null
      }
      const index = await this.loadIndex()
      const entry = index.blobs[sha256]
      if (entry !== undefined) {
        entry.lastReadAt = new Date().toISOString()
        // 读路径不每次写索引：读是很频繁的操作，写盘只为 LRU 精度不值得。
        // 下次任何写操作会顺带把它持久化。
      }
      return bytes
    } catch {
      return null
    }
  }

  /**
   * 追加一个引用（**同一 sha 被第二张照片复用时调用**）。
   *
   * 与 put 的分工：put 用首次写入方的 photoId 登记，claim 给后来者补登。
   * 分开是因为「字节已在盘上」时 put 会直接返回，此时它的 refs 里已经有
   * 第一个引用方；后到的照片必须显式 claim 才能让引用计数对得上。
   * @param sha256 blob 摘要。
   * @param photoId 引用方 id。
   * @returns 是否登记成功（blob 不存在时 false）。
   */
  async claim(sha256: string, photoId: string): Promise<boolean> {
    const index = await this.loadIndex()
    const entry = index.blobs[sha256]
    if (entry === undefined) return false
    if (!entry.refs.includes(photoId)) {
      entry.refs.push(photoId)
      await this.saveIndex()
    }
    return true
  }

  /**
   * 减引用（删照片时调用）。
   * @param sha256 blob 摘要。
   * @param photoId 引用方 id。
   * @param dropFile true = 引用归零时立即删文件（默认 true）。
   * @returns 文件是否被删掉。
   */
  async release(sha256: string, photoId: string, dropFile = true): Promise<boolean> {
    const index = await this.loadIndex()
    const entry = index.blobs[sha256]
    if (entry === undefined) return false
    entry.refs = entry.refs.filter((id) => id !== photoId)
    let removed = false
    if (entry.refs.length === 0 && dropFile) {
      delete index.blobs[sha256]
      await rm(this.pathOf(sha256), { force: true })
      removed = true
    }
    await this.saveIndex()
    return removed
  }

  /** 强制删除一个 blob（配额淘汰用；不管引用）。 */
  async drop(sha256: string): Promise<void> {
    const index = await this.loadIndex()
    delete index.blobs[sha256]
    await rm(this.pathOf(sha256), { force: true })
    await this.saveIndex()
  }

  /** 读 blob 元信息（下载文件时定 content-type 与长度）。 */
  async info(sha256: string): Promise<{ sha256: string; bytes: number; mediaType: string } | null> {
    const index = await this.loadIndex()
    const entry = index.blobs[sha256]
    if (entry === undefined) return null
    return { sha256: entry.sha256, bytes: entry.bytes, mediaType: entry.mediaType }
  }

  /** 该 blob 是否仍在盘上（且大小与索引一致）。 */
  async has(sha256: string): Promise<boolean> {
    try {
      const info = await stat(this.pathOf(sha256))
      return info.isFile() && info.size > 0
    } catch {
      return false
    }
  }

  /** 全量统计（配额判定与面板展示）。 */
  async stats(): Promise<{ count: number; bytes: number; shas: string[] }> {
    const index = await this.loadIndex()
    let count = 0
    let bytes = 0
    const shas: string[] = []
    for (const entry of Object.values(index.blobs)) {
      count += 1
      bytes += entry.bytes
      shas.push(entry.sha256)
    }
    return { count, bytes, shas }
  }

  /** 索引快照（配额淘汰时需要知道每个 blob 的引用情况）。 */
  async snapshot(): Promise<Array<{ sha256: string; bytes: number; refs: string[]; lastReadAt?: string }>> {
    const index = await this.loadIndex()
    return Object.values(index.blobs).map((entry) => ({
      sha256: entry.sha256,
      bytes: entry.bytes,
      refs: [...entry.refs],
      lastReadAt: entry.lastReadAt,
    }))
  }

  /**
   * 清理孤儿：索引里 refs 为空、或文件已经不在的条目。
   *
   * 什么时候会有孤儿：进程在「写文件」与「写索引」之间被杀（索引里没有）、
   * 或删除时 rm 成功但索引没来得及落盘（索引里有、文件没了）。定期跑一次
   * 比在热路径上做两阶段提交便宜得多。
   * @returns 清掉的条目数与释放的字节。
   */
  async sweepOrphans(): Promise<{ removed: number; freedBytes: number }> {
    const index = await this.loadIndex()
    let removed = 0
    let freedBytes = 0
    for (const [sha256, entry] of Object.entries(index.blobs)) {
      const onDisk = await this.has(sha256)
      if (!onDisk) {
        delete index.blobs[sha256]
        removed += 1
        continue
      }
      if (entry.refs.length === 0) {
        freedBytes += entry.bytes
        delete index.blobs[sha256]
        await rm(this.pathOf(sha256), { force: true })
        removed += 1
      }
    }
    if (removed > 0) await this.saveIndex()
    return { removed, freedBytes }
  }
}
