/**
 * webui — PNG 拼接（零依赖：node:zlib + 手写 filter 逆运算 / CRC32）。
 *
 * 背景：对话截图 4K（deviceScaleFactor=3）内容稍长时，Chromium/Edge 无头软件的
 * 合成表面（宽×高×scale 的输出像素面积）超过可处理临界，Page.captureScreenshot
 * 会挂死 → 渲染管线被重置 → CDP WebSocket 断开（1006）→ 「CDP 连接已关闭」。
 * 解决：改成「小视口滚动分段截图」——每段输出像素高度 ≤ 8192，逐段截取后再
 * 由本模块拼回整张 PNG。clip + captureBeyondViewport 不可行（合成表面仍按整
 * 视口全高合成，照样挂死），必须让视口本身保持小尺寸。
 *
 * 兼容范围：Chromium captureScreenshot PNG 标准输出（8-bit、color type 2/6、
 * 非交织）；其余格式直接抛错，调用方按其失败路径重试。
 */
import { deflateSync, inflateSync } from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** CRC32 查表（PNG chunk 校验）。 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4, 8), data])), 0)
  return Buffer.concat([head, data, crc])
}

export interface DecodedPng {
  /** 像素宽（px）。 */
  width: number
  /** 像素高（px）。 */
  height: number
  /** 每像素字节数（3=RGB，4=RGBA）。 */
  bpp: number
  /** 原始像素（长度 = width×height×bpp，行序从上到下）。 */
  pixels: Uint8Array
}

/**
 * 解码一张标准 PNG（8-bit、color type 2/6、非交织）。
 * 需要逆 filter 0~4（None/Sub/Up/Average/Paeth），逐行重建原始像素。
 */
export function decodePng(buf: Buffer): DecodedPng {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('PNG 签名无效')
  }
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat: Buffer[] = []
  let pos = 8
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      if (len < 13) throw new Error('PNG IHDR 不完整')
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data))
    } else if (type === 'IEND') {
      break
    }
    pos += 12 + len
  }
  if (bitDepth !== 8) throw new Error(`不支持的 PNG 位深: ${bitDepth}`)
  if (colorType !== 2 && colorType !== 6) throw new Error(`不支持的 PNG 颜色类型: ${colorType}`)
  if (interlace !== 0) throw new Error('不支持的 PNG 交织模式')
  if (width <= 0 || height <= 0) throw new Error('PNG 缺少合法的 IHDR')
  const bpp = colorType === 6 ? 4 : 3
  const stride = width * bpp
  const raw = inflateSync(Buffer.concat(idat))
  const expected = (stride + 1) * height
  if (raw.length < expected) throw new Error(`PNG 数据不完整: ${raw.length} < ${expected}`)
  const out = new Uint8Array(stride * height)
  let prev = new Uint8Array(stride)
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1)
    const filter = raw[rowStart]
    const row = raw.subarray(rowStart + 1, rowStart + 1 + stride)
    const cur = out.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? cur[x - bpp] : 0
      const b = prev[x]
      const c = x >= bpp ? prev[x - bpp] : 0
      let v = row[x]
      switch (filter) {
        case 0: break
        case 1: v = (v + a) & 0xff; break
        case 2: v = (v + b) & 0xff; break
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
          v = (v + pred) & 0xff
          break
        }
        default: throw new Error(`未知 PNG filter: ${filter}`)
      }
      cur[x] = v
    }
    prev = cur
  }
  return { width, height, bpp, pixels: out }
}

/**
 * 编码一张 8-bit RGB/RGBA PNG（每行 filter 用 None，靠 deflate 压重复行；
 * 截图类图像行内相关性弱、行间强，None 的压缩率损失可忽略，胜在简单可靠）。
 *
 * 传入的 `pixels` 必须是 **PNG raw 格式**（每行首字节是 filter type，行距
 * stride+1），也就是 encodeRawPng 产出的那种布局。stitchPng 刻意把拼接画布按
 * 同一格式分配：长图整图可达 1.15 亿像素，「画布 + 另一份 raw」并存就是两份
 * ~344MB；让画布本身就是 raw，这份多出来的内存直接消失。
 */
export function encodePng(width: number, height: number, pixels: Uint8Array, bpp: number): Buffer {
  if (width <= 0 || height <= 0) throw new Error('编码尺寸非法')
  if (bpp !== 3 && bpp !== 4) throw new Error(`不支持的 bpp: ${bpp}`)
  const stride = width * bpp
  if (pixels.length < (stride + 1) * height) throw new Error('像素缓冲不足')
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = bpp === 4 ? 6 : 2 // color type
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter method
  ihdr[12] = 0 // interlace
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(pixels, { level: 3 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * 把「紧凑像素」转成 PNG raw 格式（每行前置 1 字节 filter type）。
 *
 * 与 encodePng 成对：stitchPng 直接分配 raw 格式的画布省掉一次全图拷贝，
 * 其它地方若只有紧凑像素则用它转一层。
 */
export function toRawScanlines(pixels: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp
  const raw = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0 // filter: None
    raw.set(pixels.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1)
  }
  return raw
}

/** 一个待拼接片段：PNG 内容 + 其在整图中的位置（设备像素坐标）与尺寸。 */
export interface PngTile {
  png: Buffer
  x: number
  y: number
  width: number
  height: number
}

/**
 * 长图拼接的输出预算（整图像素数）。
 *
 * 上限来自峰值内存而不是"图能有多大"：4K 档 + 超长会话会排出 1.15 亿像素，
 * 光整图画布（RGB 3bpp）就是 ~344MB，再加各段解码缓冲与编码缓冲，峰值逼近
 * 1GB —— Node 扛不住就是被 OOM 直接带崩，不是一个"重一点"的降级。
 * 真正的解法是让每一步都不同时驻留（见 stitchPng / encodePng 的逐段逐块
 * 处理）；这个上限是最后一道闸，超了给出可读错误而不是让进程消失。
 */
export const MAX_STITCH_PIXELS = 60_000_000

/**
 * 把多段 PNG 拼成一张（各段需同宽、同颜色类型；按 x/y 放置，越界裁剪）。
 * 段内像素按「声明尺寸」拷贝；声明尺寸与实际解码不符时以解码为准（并校验）。
 *
 * **一段一段解、一段拼完立刻放手**。原来先把所有段 decode 进一个数组再统一
 * 拷贝，于是「全部段缓冲 + 整图画布」两份同时驻留；长图下这是白给的一倍内存
 * （约 344MB）。改成边解边拼、出了循环就不可达，峰值只剩画布 + 当前一段。
 */
export function stitchPng(tiles: PngTile[], totalWidth: number, totalHeight: number): Buffer {
  if (tiles.length === 0) throw new Error('没有可拼接的片段')
  if (totalWidth <= 0 || totalHeight <= 0) throw new Error('拼接目标尺寸非法')
  const totalPixels = totalWidth * totalHeight
  if (totalPixels > MAX_STITCH_PIXELS) {
    throw new Error(`长图过大：${totalWidth}x${totalHeight}（${totalPixels} 像素），超出 ${MAX_STITCH_PIXELS} 上限`)
  }
  // 先只解第一段拿 bpp（颜色类型必须全段一致），顺带避免为它单独解两遍。
  const first = decodePng(tiles[0]!.png)
  const bpp = first.bpp
  if (bpp !== 3 && bpp !== 4) throw new Error(`不支持的片段色型: ${bpp}`)
  // 画布直接按 PNG raw 布局分配：行距 stride+1、每行首字节预置 filter=0。
  // 这样编码时 deflateSync 直接吃它，不用再复制出第二份整图缓冲 ——
  // 长图整图 1.15 亿像素时，那一份就是白给的 ~344MB。
  const stride = totalWidth * bpp
  const out = new Uint8Array((stride + 1) * totalHeight)
  let cursor = 0
  for (const tile of tiles) {
    const d = cursor === 0 ? first : decodePng(tile.png)
    if (d.bpp !== bpp) throw new Error('片段颜色类型不一致')
    if (d.width !== tile.width || d.height !== tile.height) {
      throw new Error(`片段尺寸与声明不符: 实际 ${d.width}x${d.height}，声明 ${tile.width}x${tile.height}`)
    }
    // 完全落在目标画布之外的段直接跳过（与段自身尺寸无关）
    if (tile.x < totalWidth && tile.y < totalHeight) {
      // 目标可见范围（tile 可能部分越出画布）
      const tx0 = Math.max(0, tile.x)
      const tx1 = Math.min(totalWidth, tile.x + tile.width)
      const ty0 = Math.max(0, tile.y)
      const ty1 = Math.min(totalHeight, tile.y + tile.height)
      if (tx1 > tx0 && ty1 > ty0) {
        const cols = tx1 - tx0
        const srcCol = tx0 - tile.x // 目标列 tx0 对应的源列
        const rowBytes = tile.width * bpp
        for (let ty = ty0; ty < ty1; ty += 1) {
          const srcRow = ty - tile.y // 源行从段顶(0)起，与目标绝对行无关
          const srcStart = srcRow * rowBytes + srcCol * bpp
          out.set(d.pixels.subarray(srcStart, srcStart + cols * bpp), ty * (stride + 1) + 1 + tx0 * bpp)
        }
      }
    }
    // 显式断引用：长图下 tiles.length 可能十几段，每段的像素缓冲都是几 MB，
    // 全部留在一轮循环的可达范围内就等于又攒了一份。
    cursor += 1
  }
  return encodePng(totalWidth, totalHeight, out, bpp)
}
