/**
 * dsh-chat-plus — 官方侧边栏的音视频渲染器（client 半身，2026-10-19）。
 *
 * ## 为什么需要它
 *
 * 「产出物 / 画廊全部用官方侧边栏查看」这条收口之后，右栏成了**唯一**的预览出口。
 * 而官方文档预览对这些格式是**空的**：
 *
 *   · `dsh-client-ui-sidebar-documentpreview` 的 `UNVIEWABLE_BINARY_EXTENSIONS`
 *     把 mp4 / mov / webm / mp3 / wav / flac … 直接列为「没有渲染器的已知二进制
 *     容器」，打开的正文是「不支持预览」的空态，连纯文本回退都不给；
 *   · 它注册的渲染器只有 markdown / 代码 / html / 图片 / pdf / office / excel。
 *
 * 于是画廊里的音频、产出物里的录屏与视频，在这个收口之后会**从"能看见"退化成
 * "点开说一句不支持"** —— 那等于把功能做坏了。这里按官方公开契约
 * （`ctx.documentPreviews.register` 的 `extension` 档，外部实现优先于产品实现）
 * 注册一个音视频渲染器，正文是原生 `<video>` / `<audio>`。
 *
 * ## 为什么是 renderer 模式而不是 bytes-complete
 *
 * 视频动辄几十上百 MB，官方 `workspaceFiles.readBytes` 受 `maxFileBytes` 上限约束
 * （超限直接报 too-large，不给流式）；而 `<video src>` 交给浏览器自己解码 + 分段
 * 请求才是最省内存、也最像原生播放器的做法。所以：
 *
 *   1. **主路**：插件自己的 `/api/triad/gallery/raw`（索引即白名单，也认会话作用域
 *      的相对路径）。它是 `createReadStream` 的逐块转发，浏览器可以边下边播；
 *   2. **兜底**：raw 准入不认（例如用户从文件树里点开了一个从没被对话产出过、
 *      也不在本会话产出清单里的媒体文件）时，退回官方 `remote.workspaceFiles.readBytes`
 *      读成 Blob URL。这条路受大小上限约束，但至少不会让文件彻底打不开。
 *
 * 判定顺序反了会很糟：raw 是同步可拼的地址（不用等一次读盘），但它有准入面；
 * 先探 HEAD 再决定，既拿到最快路径，也不会对没权限的文件白读一遍字节。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { getService, workspaceCwdOf } from '../client-ctx.js'
import { resolveWorkspacePath } from '../open-preview.js'
import { sessionRawUrl } from '../triad/gallery/api.js'
import { whenDocumentPreviews, type DocumentPreviewsLike } from '../sidebar/document-registry.js'
import { parseFileAddress } from '../sidebar-doc/address.js'
import { openOutputFile } from '../open-file.js'

/** 渲染器 id（同时是 keyed slot 的 key；官方要求全局唯一）。 */
export const SIDEBAR_MEDIA_ID = 'dsh-chat-plus/sidebar-media'

/** 视频扩展名（与产出物收集层的 video 类别对齐）。 */
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'mkv', 'm4v', 'avi'] as const
/** 音频扩展名。 */
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'opus', 'wma'] as const
/*
 * 只接管官方明确列进「已知二进制容器、但没有渲染器」的那一族音视频后缀。
 *
 * gif 不在这里：它在官方内置的图片渲染器里（IMAGE_EXTENSIONS），<img> 播动图
 * 本来就是对的，抢过来只会让用户少掉官方那套缩放与背景处理。
 */
const CLAIMED_EXTENSIONS = [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS] as const

/** 官方文档正文的 owner 面（只用到本渲染器需要的字段）。 */
interface DocumentBodyOwner {
  readonly resourceAddress: string
  readonly content: {
    readonly kind: 'renderer'
    readonly revision: number
    readonly loaded: (version: string) => void
    readonly failed: () => void
    readonly reload: () => void
  }
  readonly scrollportRef: (element: HTMLElement | null) => void
}

/** `remote.workspaceFiles.message.received` 的返回值形状（只用到字节数组）。 */
interface ReadBytesResult {
  readonly data?: Uint8Array
  readonly absolutePath?: string
}

/** `remote.workspaceFiles` 的最小面（只读整份字节）。 */
interface WorkspaceFilesLike {
  readBytes?: (sessionId: string, path: string, options: Record<string, unknown>, signal?: AbortSignal) => Promise<ReadBytesResult>
}

/**
 * 取官方 `workspaceFiles` 客户端服务（与 open-preview.ts 同一套双路查找）。
 *
 * 两条路都要试：Gateway 把每个 Remote 命名空间注册成独立 Service（`remote.<ns>`），
 * 而根 `remote` 服务也可能挂着同名命名空间；且 cordis 的 ctx 是 Proxy，读未 inject
 * 的属性会抛 —— 每条单独 try/catch，读不到就当服务不存在。
 */
function workspaceFilesService(): WorkspaceFilesLike | undefined {
  for (const name of ['remote.workspaceFiles', 'remote']) {
    let candidate: Record<string, unknown> | undefined
    try {
      candidate = getService<Record<string, unknown>>(name)
    } catch {
      continue
    }
    if (candidate === undefined || candidate === null) continue
    try {
      if (typeof candidate.readBytes === 'function') return candidate as WorkspaceFilesLike
      const nested = candidate.workspaceFiles
      if (typeof nested === 'object' && nested !== null && typeof (nested as WorkspaceFilesLike).readBytes === 'function') {
        return nested as WorkspaceFilesLike
      }
    } catch {
      continue
    }
  }
  return undefined
}

/** 扩展名（小写，不含点）。 */
function extOf(path: string): string {
  const base = path.split(/[\\/]/).filter(Boolean).at(-1) ?? ''
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase()
}

/** 这个扩展名是音频吗。 */
function isAudioExt(ext: string): boolean {
  return (AUDIO_EXTENSIONS as readonly string[]).includes(ext)
}

/**
 * 播放器需要的最小 MIME。
 *
 * ⚠ 这张表**不是**「让声明更明确」的装饰，它直接决定浏览器肯不肯解码。
 * 2026-10-24 用真实 Chromium（154.0.8037.44）灌真实文件实测（见下），
 * 同一个字节流换个 MIME 就从「能播」变成 `error: SRC_NOT_SUPPORTED`：
 *
 *  · **mov 必须声明成 video/mp4** —— 这是本表最重要的一条。Chromium 对 QuickTime
 *    容器本身是能解的（实测同一份 t.mov：声明 video/mp4 → loadeddata 320×240；
 *    声明 video/quicktime → SRC_NOT_SUPPORTED；声明 application/octet-stream →
 *    同样失败）。原来写 video/quicktime，等于把**所有 mov 视频**判成打不开。
 *    QuickTime 与 MP4 同属 ISO-BMFF 家族、解码路径一致，声明 mp4 是准确的。
 *  · **音频里 opus 用 audio/ogg** —— 同理：`audio/opus` 在 canPlayType 上是空串
 *    （= 不支持），而 `audio/ogg; codecs=opus` 是 "probably"。裸 `audio/opus`
 *    这个类型浏览器根本不认。
 *  · mkv 声明 video/x-matroska 是可播的（实测 loadeddata）—— 与 canPlayType 的
 *    "maybe" 一致，不要想当然认为"mkv 浏览器不支持"。它播不了的是编码，
 *    不是容器。
 *
 * 真正播不了的是 **avi（Video for Windows 容器）与 wma（Windows Media Audio）**：
 * 实测三种 MIME 声明全部 SRC_NOT_SUPPORTED，容器本身不在 Chromium 的解码面里。
 * 这两个归 `canShowInSidebar` 判成 external（交系统默认应用），见 sidebar-display.ts。
 */
const MIME_BY_EXT: Readonly<Record<string, string>> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  // mov 声明成 mp4：QuickTime 容器 Chromium 能解，但只认 mp4 这个 MIME（实测）。
  mov: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  // avi 保留原 MIME：它本来就播不了，声明什么都不影响（归 external）。
  avi: 'video/x-msvideo',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  // opus 是 ogg 容器里的编码，不是独立 MIME（audio/opus → 不支持）。
  opus: 'audio/ogg',
  wma: 'audio/x-ms-wma',
}

/**
 * 正文：一个原生播放器（视频）或一条音轨（音频）+ 加载/失败态。
 *
 * 状态机刻意只有三档（probing / ready / failed）：媒体没有「部分可用」这种中间态，
 * 探到源就播、探不到就说清楚为什么，比留一个永远转圈的播放器诚实。
 */
function SidebarMediaBody(props: DocumentBodyOwner): JSX.Element {
  const owner = props
  const address = owner.resourceAddress
  const revision = owner.content.revision
  const [state, setState] = useState<'probing' | 'ready' | 'failed'>('probing')
  const [detail, setDetail] = useState('')
  const [src, setSrc] = useState('')
  /** 失败态第二出口的进行中标志（防连点、给按钮一个「正在打开」的文案）。 */
  const [opening, setOpening] = useState(false)
  const blobRef = useRef<string | null>(null)
  const aliveRef = useRef(true)

  // 官方要求：自己管滚动区时把 ref 报上去（卸载恢复共享正文的滚动职责）。
  useEffect(() => {
    owner.scrollportRef(null)
    return () => { owner.scrollportRef(null) }
  }, [owner])

  useEffect(() => {
    aliveRef.current = true
    setState('probing')
    setDetail('')
    setSrc('')

    const parsed = parseFileAddress(address)
    if (parsed === null) {
      owner.content.failed()
      setState('failed')
      setDetail('地址无法解析')
      return () => { aliveRef.current = false }
    }

    const controller = new AbortController()
    /*
     * 主路：插件自己的 /raw（索引即白名单；逐块转发，浏览器可边下边播）。
     *
     * ⚠ 路径必须**先折成绝对**再请求（2026-10-19 修「侧栏里音频/视频打不开」）。
     * 官方文件地址里工作区内的路径是**相对**的（`landing/video/bgm.mp3`），而
     * /raw 的会话作用域准入把索引里的**绝对路径**与会话 cwd 折出来的绝对路径
     * 比对 —— 实测相对路径那条路 403、同一文件换成绝对路径 200。产出物卡
     * 2026-10-05 修过同一个坑，这里当时没跟。
     *
     * cwd 拿不到时原样传（host 侧还能按会话 cwd 再折一次，是同一结果的兜底）。
     */
    const absolute = resolveWorkspacePath(workspaceCwdOf(parsed.sessionId), parsed.path)
    const raw = sessionRawUrl(absolute, parsed.sessionId)

    const release = (): void => {
      if (blobRef.current !== null) {
        URL.revokeObjectURL(blobRef.current)
        blobRef.current = null
      }
    }

    void (async (): Promise<void> => {
      try {
        const head = await fetch(raw, { method: 'HEAD', cache: 'no-store', signal: controller.signal })
        if (!aliveRef.current) return
        if (head.ok) {
          setSrc(raw)
          setState('ready')
          owner.content.loaded(`rev-${revision}-${Date.now()}`)
          return
        }
        // 兜底：官方读字节面（受 maxFileBytes 约束，但不会因为准入面而彻底打不开）。
        const files = workspaceFilesService()
        if (files === undefined || typeof files.readBytes !== 'function') {
          owner.content.failed()
          setState('failed')
          setDetail(head.status === 403 ? '这个文件不在可预览范围内' : `读取失败（HTTP ${head.status}）`)
          return
        }
        const result = await files.readBytes(parsed.sessionId, absolute, {}, controller.signal)
        if (!aliveRef.current) return
        const data = result.data
        if (data === undefined || data.byteLength === 0) {
          owner.content.failed()
          setState('failed')
          setDetail('文件读不到内容')
          return
        }
        // 复制一份独立 ArrayBuffer 再交给 Blob：Remote 返回的视图可能是共享缓冲区，
        // 直接 Blob 化会让后续读取覆盖已发给播放器的字节。
        const copy = new Uint8Array(data.byteLength)
        copy.set(data)
        const type = MIME_BY_EXT[extOf(parsed.path)] ?? 'application/octet-stream'
        const url = URL.createObjectURL(new Blob([copy], { type }))
        blobRef.current = url
        setSrc(url)
        setState('ready')
        owner.content.loaded(`rev-${revision}-${Date.now()}`)
      } catch {
        if (!aliveRef.current) return
        owner.content.failed()
        setState('failed')
        setDetail('网络或服务不可达')
      }
    })()

    return () => {
      aliveRef.current = false
      controller.abort()
      release()
    }
    // revision 变化 = 官方要求重载：重新取一次源。
  }, [address, revision, owner])

  const parsed = parseFileAddress(address)
  const ext = parsed === null ? '' : extOf(parsed.path)
  const kind = isAudioExt(ext) ? 'audio' : 'video'
  /*
   * 失败态「用系统默认应用打开」的目标：**绝对路径**。
   *
   * 必须在这里折成绝对而不是把相对路径直接发出去：host 的 resolveTarget 对
   * 相对路径要求请求里带 cwd，而侧栏地址里的 path 是工作区相对的
   * （`landing/video/x.mp4`）。折一次既省掉一个参数，也让失败日志里能直接看出
   * 打开的是哪个文件。
   */
  const openTarget = parsed === null
    ? ''
    : resolveWorkspacePath(workspaceCwdOf(parsed.sessionId), parsed.path)

  /*
   * 播放器**真解码失败** → 转 failed 态。
   *
   * 这一条是「第二出口」能不能出现的唯一开关，也是 2026-10-24 之前真正的缺口：
   * 原来的 ready 判定只看「HEAD 探测成功」—— 那只证明**文件读得到**，完全不证明
   * **浏览器解得出**。于是 avi / wma 这类容器会一路走到 ready：播放器挂出来、
   * UI 一切正常、时间轴停在 0:00、画面全黑，而 <video> 内部的 error 事件没有
   * 任何人监听 —— 用户看到的就是「一片黑，也没有任何按钮可按」。
   *
   * 浏览器给的 MediaError.code 分四种，只有两种值得说给人听：
   *   3 MEDIA_ERR_DECODE            —— 容器认了但解不开（编码不支持 / 文件损坏）
   *   4 MEDIA_ERR_SRC_NOT_SUPPORTED —— 容器本身不认（avi / wma 正是这个）
   * 1（用户中止）直接忽略：那是用户自己按了停止，不是故障。
   * 2（网络）保留通用文案：重试确实可能有用。
   *
   * 用 document.querySelector 而不是 ref：播放器元素在条件渲染里，ref 在
   * failed 态切走后就断开，而 error 事件恰好是在切走那一刻触发的。
   */
  const onMediaError = useCallback((): void => {
    const element = document.querySelector('[data-dsh-sidebar-media] audio')
      ?? document.querySelector('[data-dsh-sidebar-media] video')
    const media = element as (HTMLMediaElement | null)
    const code = media?.error?.code ?? 0
    if (code === 1) return
    owner.content.failed()
    setState('failed')
    setDetail(code === 4
      ? '浏览器解不了这个容器，用系统播放器打开试试'
      : code === 3
        ? '这个文件的编码浏览器解不开，用系统播放器打开试试'
        : '播放失败，可以重试或交给系统应用')
  }, [owner])

  return (
    <div style={wrapStyle} data-dsh-sidebar-media={state} data-kind={kind}>
      {state === 'probing' && (
        <div style={centerStyle}>
          <span style={spinStyle} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M12 3a9 9 0 1 0 9 9" />
            </svg>
          </span>
          <span style={hintStyle}>正在准备媒体预览…</span>
        </div>
      )}
      {state === 'failed' && (
        <div style={centerStyle}>
          <span style={hintStyle}>{detail === '' ? '这个文件暂时播放不了' : detail}</span>
          {/*
           * 「用系统默认应用打开」是失败态的**第二出口**，不是重试的替代。
           *
           * 为什么必须在这里出现：侧栏播放不了的原因分两类 ——
           *   ① 临时的（网络抖动、raw 准入暂时拒、读字节超大小上限）→ 重试有用；
           *   ② 结构的（容器浏览器根本解不了、编码这台机器不支持）→ 重试一万次
           *      还是同一个结果。
           * 而②恰恰是用户最需要「换成系统播放器看一眼」的场景：文件是存在的、
           * 内容也是真的，只是浏览器的解码面覆盖不到它。不给这个出口，用户就
           * 被关在一个只会循环报错的格子里 —— 明明双击文件就能看。
           *
           * 走的是与产出物卡同一条 openOutputFile（本插件 /api/chat-flow/open-file：
           * 按会话工作区绝对化 + stat 文件本体），失败时按钮自己说明原因，
           * 不弹 toast、不打断用户。 */}
          <div style={failActionsStyle}>
            <button type="button" style={retryStyle} onClick={() => { owner.content.reload() }}>重试</button>
            {openTarget !== '' && (
              <button
                type="button"
                style={retryStyle}
                disabled={opening}
                onClick={() => {
                  setOpening(true)
                  void openOutputFile(openTarget).then((result) => {
                    setOpening(false)
                    if (result === 'opened') return
                    setDetail(result === 'unavailable' ? '这台宿主没有可用的桌面，无法交给系统应用' : '系统应用没能打开这个文件')
                  })
                }}
              >
                {opening ? '正在打开…' : '用系统默认应用打开'}
              </button>
            )}
          </div>
        </div>
      )}
      {state === 'ready' && src !== '' && (
        <div style={stageStyle}>
          {kind === 'audio' ? (
            <div style={audioCardStyle}>
              <span style={audioIconStyle} aria-hidden="true">
                <svg width="46" height="46" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="24" cy="24" r="18" opacity=".35" />
                  <path d="M19 30V19.5l10-2.2V28" />
                  <circle cx="16.6" cy="30" r="2.6" />
                  <circle cx="26.6" cy="28" r="2.6" />
                </svg>
              </span>
              <audio
                src={src}
                controls
                autoPlay
                preload="metadata"
                style={audioStyle}
                onError={onMediaError}
              />
            </div>
          ) : (
            <video
              src={src}
              controls
              autoPlay
              preload="metadata"
              style={videoStyle}
              onError={onMediaError}
            />
          )}
        </div>
      )}
    </div>
  )
}

const wrapStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
}
const stageStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  background: 'transparent',
}
const videoStyle: CSSProperties = {
  maxWidth: '100%',
  maxHeight: '100%',
  borderRadius: 10,
  background: '#000',
  boxShadow: '0 12px 40px rgba(0,0,0,.35)',
}
const audioCardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 18,
  padding: '28px 26px',
  borderRadius: 14,
  border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.28))',
  background: 'var(--dsw-alias-bg-module-platform, rgba(128,128,128,.06))',
  color: 'var(--dsw-alias-label-secondary, #9ca3af)',
}
const audioIconStyle: CSSProperties = { display: 'inline-flex', opacity: .8 }
const audioStyle: CSSProperties = { width: 'min(520px, 70vw)' }
const centerStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  color: 'var(--dsw-alias-label-secondary, #9ca3af)',
}
const hintStyle: CSSProperties = { fontSize: 12.5, lineHeight: 1.7 }
/** 失败态两枚按钮并排（重试 + 用系统默认应用打开）；窄容器下自动换行。 */
const failActionsStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
}
const spinStyle: CSSProperties = { display: 'inline-flex', animation: 'dsh-sdp-spin 900ms linear infinite' }
const retryStyle: CSSProperties = {
  height: 28,
  padding: '0 14px',
  borderRadius: 8,
  border: '1px solid var(--dsw-alias-border-l3, rgba(128,128,128,.35))',
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary, #eee)',
  fontSize: 12.5,
  fontFamily: 'inherit',
  cursor: 'pointer',
}

/**
 * 挂载音视频渲染器：注册元数据（extension 档，赢过任何产品实现）+ keyed 正文槽位。
 *
 * 两段各自 try/catch：老宿主没有 `documentPreviews` 服务时只让这一块不挂，
 * 官方渲染器原样兜底（用户看到的是官方那句"不支持预览"，而不是整块消失）。
 *
 * @param ctx - client 根上下文。
 */
export function applySidebarMedia(ctx: Record<string, any>): void {
  const injectStyles = (): void => {
    if (typeof document === 'undefined') return
    if (document.getElementById('dsh-sdp-styles') !== null) return
    const tag = document.createElement('style')
    tag.id = 'dsh-sdp-styles'
    tag.dataset.plugin = 'dsh-chat-plus'
    tag.textContent = '@keyframes dsh-sdp-spin{to{transform:rotate(360deg)}}'
    document.head.appendChild(tag)
  }
  injectStyles()

  // 服务必须走 getService（根 ctx 的 get()）：官方用 ctx.reflect.provide 把它挂成
  // 服务，属性直读会被 cordis Proxy 拒（未 inject 的属性和 '' 一样抛）。
  //
  // 而且**必须等它出现**：本插件 client apply 跑在官方 ui-sidebar-documentpreview
  // provide 之前，同步取一次拿到的是 undefined（2026-10-19 实机定位，见
  // sidebar/document-registry.ts 的说明）。轮询到就绪为止。
  whenDocumentPreviews(
    () => getService<DocumentPreviewsLike>('documentPreviews'),
    (registry) => {
      let disposeMeta: (() => void) | null = null
      try {
        disposeMeta = registry.register({
          id: SIDEBAR_MEDIA_ID,
          extensions: [...CLAIMED_EXTENSIONS],
          // 这些后缀的字节**永远不是可读文本**：列进来才不会再给一个"纯文本"选项
          // （拿播放器字节当文本读只会得到一行乱码）。
          binaryExtensions: [...CLAIMED_EXTENSIONS],
          // extension 档：排在官方任何实现之前（官方契约：外部实现赢）。
          priority: 'extension',
          title: () => '媒体预览（插件）',
          // renderer 模式：字节由正文自己取（视频走流式 raw，音频走读字节），
          // owner 不预读 —— 预读意味着几十 MB 先全部进内存。
          loading: 'renderer',
          wrap: false,
        })
      } catch {
        return
      }

      try {
        ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({
          name: 'sidebar.right.tab.document',
          key: SIDEBAR_MEDIA_ID,
        }, (props: Record<string, any>) => (
          <SidebarMediaBody {...(props as unknown as DocumentBodyOwner)} />
        )))
      } catch {
        // 槽位注入失败：元数据已注册但没有正文 → 官方会回落到下一个候选实现。
        disposeMeta?.()
      }
    },
  )
}
