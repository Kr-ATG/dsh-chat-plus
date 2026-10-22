/**
 * dsh-chat-plus — 官方侧边栏的 PDF / Office 文档渲染器（client 半身）。
 *
 * ## 为什么要接管官方的 PDF 预览
 *
 * 用户 2026-10-06 报「无法显示 PDF：n.toHex is not a function」。定位到官方
 * `dsh-client-ui-sidebar-documentpreview` 内嵌的 pdf.js（6.3.289）在算文档指纹时：
 *
 *   shadow(this, "fingerprints", [n.toHex(), a?.toHex() ?? null])
 *
 * 其中 `n` 来自 `stringToBytes(...)` —— 而**同一个 bundle 里** `stringToBytes`
 * 返回的是裸 `Uint8Array`，没有 `toHex` 方法（pdf.js 上游里它返回的是自带
 * `toHex` 的 `Bytes` 子类，打包时被替换掉了）。于是**任何带 `/ID` 字典的 PDF**
 * 一打开就抛 TypeError；不带 `/ID` 的走 calculateMD5 分支才侥幸能开。
 *
 * 三个事实决定了不能靠补丁绕过：
 *  1. 崩溃点在 **PDF worker**（独立 realm）里，主线程改原型够不到；
 *  2. worker 源码是**内联字符串**塞进 chunk 的，没有独立文件可换；
 *  3. ppt / word 的官方预览是「officeToPdf 转 PDF → 同一条 pdf.js」，所以
 *     Office 预览与 PDF 预览**一起坏**（带 /ID 的转换结果同样触发）。
 *
 * 官方给了正规的替换口：`ctx.documentPreviews.register` 的 `priority: 'extension'`
 * 档**优先于**产品自带的 builtin 实现（README 原话「External implementations win
 * over product implementations」）。于是这里注册一个自己的渲染器，把
 * pdf / doc / docx / ppt / pptx / odt / odp / ods 全部接管过来，正文用
 * **浏览器内置 PDF 查看器**（iframe 指插件的 /office/pdf 或 /office/page）渲染 ——
 * 零新依赖、不碰 pdf.js、翻页/缩放/文字选择全是浏览器原生能力。
 *
 * ## 与官方渲染器的分工
 *
 * 只接管「二进制文档」这一族。markdown / 代码 / 图片 / **表格**（xls/xlsx 的浏览器
 * 内 FortunSheet 渲染）仍走官方 builtin —— 那些链路没坏，接管它们只会平白多一层
 * 维护面，而且"能在格子里选中复制"本来就比"转成 PDF 看个样子"好用。
 *
 * `ods` 是唯一的例外（2026-10-22 补）：官方 Excel 渲染器不认它、官方又把它列进
 * UNVIEWABLE，而 host 的 LibreOffice 引擎本来就支持它（src/office/index.ts 的
 * RENDERABLE_EXT 含 .ods）—— 不接管的话「引擎能转、侧栏不认」，点开只有一句
 * 「该格式文件暂时无法预览」。
 */

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { officePdfUrl } from '../triad/gallery/api.js'
import { getService, workspaceCwdOf } from '../client-ctx.js'
import { resolveWorkspacePath } from '../open-preview.js'
import { whenDocumentPreviews, type DocumentPreviewsLike } from '../sidebar/document-registry.js'
import { parseFileAddress } from './address.js'

/** 渲染器 id（同时是 keyed slot 的 key；官方要求全局唯一）。 */
export const SIDEBAR_DOC_ID = 'dsh-chat-plus/sidebar-document'

/**
 * 接管的扩展名。
 *
 * 三组：
 *  1. **坏掉的那一族**：pdf（pdf.js 的 toHex 崩溃）与 doc/docx/ppt/pptx（转出的
 *     PDF 走同一条 pdf.js，一起坏）；
 *  2. **官方没有、但引擎能转的**：odt / odp / ods（官方把这三个都列进 UNVIEWABLE，
 *     而 host 的 LibreOffice 引擎支持它们）；
 *  3. **不该被抢的**：xls / xlsx 留给官方 Excel 渲染器（浏览器内表格，能选中复制）。
 *
 * 这份清单必须与 `client/sidebar-display.ts` 的 PLUGIN_RENDERED_EXT 同源 ——
 * 判据说"能在侧栏看"而渲染器没接管，用户点开就是官方空态。冒烟断言钉住。
 */
const CLAIMED_EXTENSIONS = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'odt', 'odp', 'ods'] as const

/**
 * 这些扩展名的字节不是可读文本（官方据此去掉「纯文本」备选视图）。
 *
 * `ods` 是 2026-10-22 补进来的：host 的 LibreOffice 引擎本来就支持它
 * （src/office/index.ts 的 RENDERABLE_EXT 含 .ods），但官方 Excel 渲染器只认
 * xlsx/xls/csv/tsv，官方又把 ods 列进 UNVIEWABLE —— 结果"引擎能转、侧栏不认"，
 * 点开只有一句「该格式文件暂时无法预览」。接管后它与 xls/xlsx 走不同的路
 * （转 PDF 看，而非浏览器内表格），但至少能看。
 */
const BINARY_EXTENSIONS = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'odt', 'odp', 'ods'] as const

/** 官方文档正文槽位的 owner 面（只用到本渲染器需要的字段）。 */
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

/**
 * 正文组件：一个占满格子的 iframe + 加载态 + 失败态。
 *
 * props 是 owner 面**平铺**（resourceAddress / content / scrollportRef 直接在顶层，
 * 官方另附 useTabInfo / useResource 两个 hook，本渲染器用不到）。
 *
 * 加载判定不靠 iframe 的 load 事件（跨文档事件在 PDF 插件下不可靠），而是**先
 * GET 探测插件的 /office/info**：renderable 才挂 iframe 并报 loaded，否则报
 * failed 让官方头部显示重试。这样「引擎没装 / 文件越权 / 转换失败」都有明确
 * 出口，而不是一片永远转圈的白。
 */
function SidebarDocumentBody(props: DocumentBodyOwner): JSX.Element {
  const owner = props
  const address = owner.resourceAddress
  const revision = owner.content.revision
  const [state, setState] = useState<'probing' | 'ready' | 'failed'>('probing')
  const [detail, setDetail] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const aliveRef = useRef(true)

  // 官方要求：renderer 自己管滚动区时把 ref 报上去（卸载恢复共享正文的滚动职责）。
  useEffect(() => {
    owner.scrollportRef(scrollRef.current)
    return () => { owner.scrollportRef(null) }
  }, [owner])

  useEffect(() => {
    aliveRef.current = true
    setState('probing')
    setDetail('')
    const parsed = parseFileAddress(address)
    if (parsed === null) {
      // 不是 Session 文件地址（官方 canOpen 只放 Session 地址，理论上到不了这里）。
      owner.content.failed()
      setState('failed')
      setDetail('地址无法解析')
      return () => { aliveRef.current = false }
    }
    /*
     * 探测走 /office/info（只判引擎与扩展名，不触发转换）；真正的内容交给
     * iframe 的 /office/pdf（Office 文档由 host 转 PDF，pdf 原样转发）。
     *
     * ⚠ 路径先折成绝对（2026-10-19）：官方文件地址里工作区内的路径是**相对**的
     * （`deliverables/x/report.pdf`），而 /office/* 的准入把索引里的绝对路径
     * 与会话 cwd 折出的绝对路径比对 —— 相对路径那条路会被判 403。侧栏接管
     * pdf/Office 之后这条链路是唯一出口，折错等于「点开就是一片空白」。
     */
    const absolute = resolveWorkspacePath(workspaceCwdOf(parsed.sessionId), parsed.path)
    const probeUrl = `/api/chat-flow/office/info?path=${encodeURIComponent(absolute)}&session=${encodeURIComponent(parsed.sessionId)}`
    const controller = new AbortController()
    void fetch(probeUrl, { method: 'GET', cache: 'no-store', signal: controller.signal })
      .then(async (res) => {
        if (!aliveRef.current) return
        if (!res.ok) {
          owner.content.failed()
          setState('failed')
          setDetail(`读取失败（HTTP ${res.status}）`)
          return
        }
        // 显式标类型而不是 `typeof payload`：后者在赋值 null 之后被收窄成 never，
        // 再读 payload.renderable 就是类型错误（既有写法，顺手修掉）。
        let payload: { renderable?: boolean } | null = null
        try { payload = await res.json() as { renderable?: boolean } } catch { payload = null }
        if (payload?.renderable === true) {
          setState('ready')
          // 版本串官方只用来做「源文件变了就提示重载」；这里用 revision + 探测时刻
          // 足够（文件变化时官方 resources 会推新的 observedVersion 触发 reload）。
          owner.content.loaded(`rev-${revision}-${Date.now()}`)
        } else {
          owner.content.failed()
          setState('failed')
          setDetail('文档渲染引擎不可用')
        }
      })
      .catch(() => {
        if (!aliveRef.current) return
        owner.content.failed()
        setState('failed')
        setDetail('网络或服务不可达')
      })
    return () => { aliveRef.current = false; controller.abort() }
    // revision 变化 = 官方要求重载：重新探测。
  }, [address, revision, owner])

  const parsed = parseFileAddress(address)
  const src = parsed === null
    ? ''
    : officePdfUrl(resolveWorkspacePath(workspaceCwdOf(parsed.sessionId), parsed.path), parsed.sessionId)

  const wrapStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  }

  return (
    <div style={wrapStyle} data-dsh-sidebar-doc={state}>
      {state === 'probing' && (
        <div style={centerStyle}>
          <span style={spinStyle} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M12 3a9 9 0 1 0 9 9" />
            </svg>
          </span>
          <span style={hintStyle}>正在准备文档预览…</span>
        </div>
      )}
      {state === 'failed' && (
        <div style={centerStyle}>
          <span style={hintStyle}>{detail === '' ? '这份文档暂时预览不了' : detail}</span>
          <button type="button" style={retryStyle} onClick={() => { owner.content.reload() }}>重试</button>
        </div>
      )}
      {state === 'ready' && (
        <div ref={scrollRef} style={scrollStyle}>
          {/* 浏览器内置 PDF 查看器：翻页 / 缩放 / 文字选择全原生，不碰 pdf.js。
              Office 文档由 host 先转成 PDF 再交给它 —— 同一条链路，同一个查看器。 */}
          <iframe
            src={src}
            title="文档预览"
            style={frameStyle}
          />
        </div>
      )}
    </div>
  )
}

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
const scrollStyle: CSSProperties = { flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }
const frameStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  border: 'none',
  background: '#525659',
}

/**
 * 挂载渲染器：注册元数据（extension 档，赢过官方 builtin）+ keyed 正文槽位。
 *
 * 两段都包在 `ctx.effect` 里并各自 try/catch：注册失败（老宿主没有
 * documentPreviews 服务）只让这一块不挂，官方渲染器原样兜底 —— 用户看到的
 * 是「还是原来那个报错」，而不是整个侧边栏文档预览消失。
 *
 * @param ctx - client 根上下文。
 */
export function applySidebarDocument(ctx: Record<string, any>): void {
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

  const mark = (val: string): void => {
    if (typeof document !== 'undefined') document.documentElement.dataset.dshSdpRegistry = val
  }
  /*
   * 取服务必须走 `getService`（根 ctx 的 `get()`）：官方包是用
   * `ctx.reflect.provide("documentPreviews", …)` 把 registry 挂成**服务**的，
   * 而 cordis 的 ctx Proxy 对「属性直读」要求 inject 白名单声明 —— 直读
   * `ctx.documentPreviews` 会抛 `cannot get property … without inject`，
   * 表现就是整块静默不挂（2026-10-06 实机踩过：样式注入了、注册水痕没有）。
   *
   * **必须等它出现**（2026-10-19 实机定位）：本插件的 client apply 跑在官方
   * `ui-sidebar-documentpreview` provide 之前，同步取一次拿到的是 undefined ——
   * 实测 `dataset.dshSdpRegistry === 'no-registry'`，两个渲染器一次都没注册。
   * 轮询到它就绪为止（上限见 sidebar/document-registry.ts）。
   */
  whenDocumentPreviews(
    () => getService<DocumentPreviewsLike>('documentPreviews'),
    (registry) => {
      mark('registry-ok')
      let disposeMeta: (() => void) | null = null
      try {
        disposeMeta = registry.register({
          id: SIDEBAR_DOC_ID,
          extensions: [...CLAIMED_EXTENSIONS],
          binaryExtensions: [...BINARY_EXTENSIONS],
          // extension 档：排在官方 builtin 之前被自动选中（官方契约：external 赢）。
          priority: 'extension',
          title: () => '文档预览（插件）',
          // renderer 模式：正文自己负责加载（HEAD 探测 + iframe），owner 不读字节。
          loading: 'renderer',
          wrap: false,
        })
        // 诊断标记：注册成功与否在 DOM 上留痕（实机排查「接管没生效」时唯一可靠的
        // 观测点 —— 控制台日志在 headless 下拿不到，registry 也不对外暴露）。
        if (typeof document !== 'undefined') document.documentElement.dataset.dshSdp = 'registered'
      } catch {
        if (typeof document !== 'undefined') document.documentElement.dataset.dshSdp = 'failed'
        return
      }

      try {
        ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({
          name: 'sidebar.right.tab.document',
          key: SIDEBAR_DOC_ID,
        }, (props: Record<string, any>) => (
          <SidebarDocumentBody {...(props as unknown as DocumentBodyOwner)} />
        )))
      } catch {
        // 槽位注入失败：元数据已注册但没有正文 → 官方会回落到下一个候选实现。
        disposeMeta?.()
      }
    },
    () => { mark('no-registry') },
  )
}
