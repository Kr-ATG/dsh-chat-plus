/**
 * dsh-chat-plus — 对话截图面板（client 端，自 dsh-webui 移植）。
 *
 * 打开即渲染；改选项（范围 / 主题 / 设备 / 画质）或改完文案（标题 / 徽章）
 * 即重渲染。预览在面板中央按容器缩放展示。渲染结果先留在 host 内存，点
 * 「保存」才落盘——不保存就不会在 storages 里堆垃圾。
 *
 * 文案可编辑：
 *  - 标题：默认取会话标题，可改成任意文字（卡片大标题）；
 *  - 徽章：默认「Kr」，可改成任意文字；不随范围切换自动变化。
 * 输入框 blur 或 Enter 提交（不逐键重渲染，避免打字期间反复起渲染）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { render, reveal, save, type RenderResult, type ShotTheme } from './api.ts'
import type { ShotMessage, ShotRange } from './collect.ts'
// 宽度预设/画质档位表与 host 端 presets.ts 共用（纯数据，client 打包时内联）。
import {
  DEFAULT_WIDTH, QUALITY_LABEL, WIDTH_LABELS, WIDTH_PRESETS, qualityScale,
  type ShotQuality, type WidthPreset,
} from '../../shot/presets.ts'
import { canvasPad } from '../../shot/theme.ts'
// 截图要跟随对话流里选的缩放档位（与 iu / html 卡片同源，同一份 localStorage）。
import { readIuZoom } from '../iu/prefs.ts'
import { cls } from './styles.ts'

const RANGE_LABEL: Record<ShotRange, string> = {
  reply: '本条回复',
  turn: '这一轮问答',
  all: '整段会话',
}

const THEME_LABEL: Record<ShotTheme, string> = {
  light: '浅色',
  reader: '阅读版',
  dark: '深色',
  glass: '玻璃',
  'glass-dark': '玻璃深色',
}

/** 当前界面主题：跟随深浅色 + 玻璃质感开关（键与 glass.ts 一致）。 */
export function currentTheme(): ShotTheme {
  const dark = document.body.hasAttribute('data-ds-dark-theme')
  let glass = false
  try { glass = localStorage.getItem('dsh-webui.appearance.glass') === '1' } catch { /* 忽略 */ }
  return glass ? (dark ? 'glass-dark' : 'glass') : (dark ? 'dark' : 'light')
}

/** 字节数人类可读。 */
function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 面板属性。 */
export interface ShotPanelProps {
  /** 关闭动画中（父组件控制卸载时机）。 */
  closing: boolean
  onClose: () => void
  /** 按范围抽取消息（面板改范围时重新调用）。 */
  collect: (range: ShotRange) => ShotMessage[]
  /** 初始标题（优先为本次对话标题，留空则由 host 从正文推导）。 */
  title: string
  /** 本次对话标题（单条回复 / 本轮问答）。 */
  dialogueTitle?: string
  /** 会话标题（整段会话截取时的备选）。 */
  sessionTitle?: string
  /** 会话工作目录（host 解析正文里的相对 HTML 路径）。 */
  cwd?: string
  /** 初始范围，默认 reply */
  initialRange?: ShotRange
}

/** 可编辑文案输入框：blur / Enter 提交，Esc 还原。 */
function EditableText(props: {
  label: string
  value: string
  placeholder: string
  onCommit: (value: string) => void
}): JSX.Element {
  const [draft, setDraft] = useState(props.value)
  useEffect(() => { setDraft(props.value) }, [props.value])
  const commit = (): void => {
    const next = draft.trim()
    if (next !== props.value.trim()) props.onCommit(next)
  }
  return (
    <div className={cls.group}>
      <span className={cls.label}>{props.label}</span>
      <input
        className={cls.input}
        value={draft}
        placeholder={props.placeholder}
        maxLength={80}
        onChange={(event) => { setDraft(event.target.value) }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.currentTarget.blur() }
          if (event.key === 'Escape') { setDraft(props.value); event.currentTarget.blur() }
        }}
      />
    </div>
  )
}

/** 面板主体：选项条 + 预览台 + 底栏操作。 */
export function ShotPanel({ closing, onClose, collect, title, dialogueTitle, sessionTitle, cwd = '', initialRange }: ShotPanelProps): JSX.Element {
  const [range, setRange] = useState<ShotRange>(() => initialRange ?? 'reply')
  const [theme, setTheme] = useState<ShotTheme>(() => currentTheme())
  const [cardWidth, setCardWidth] = useState<number>(DEFAULT_WIDTH)
  const [widthDraft, setWidthDraft] = useState<string>(String(DEFAULT_WIDTH))
  const [quality, setQuality] = useState<ShotQuality>('2k')
  const [titleText, setTitleText] = useState(title)
  // 用户是否手动编辑过标题：未改动时允许切换范围时在「本次对话」与「会话标题」间自动跟随
  const userEditedTitleRef = useRef(false)
  // 徽章固定默认「Kr」（用户要求）；仍可在输入框里随手改。
  const [labelText, setLabelText] = useState('Kr')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<RenderResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  // ── 元素删除编辑模式 ──────────────────────────────────────────────────────
  /** 编辑模式开关（iframe 里点选元素 → 应用删除 → 重渲染 PNG）。 */
  const [editing, setEditing] = useState(false)
  /** 进入编辑时的原始 HTML（重置编辑回这份）。 */
  const [baseHtml, setBaseHtml] = useState<string | null>(null)
  /** 当前 iframe 里展示的 HTML（编辑中随「应用删除」更新）。 */
  const [editHtml, setEditHtml] = useState<string | null>(null)
  /** 已标记待删除的元素数（iframe 内点击后同步）。 */
  const [marked, setMarked] = useState(0)
  /** 编辑预览 iframe 的高度（随内容高度自适应）。 */
  const [frameHeight, setFrameHeight] = useState<number | null>(null)
  /** 递增令牌：只接受最后一次渲染的结果（快速改选项时防串图）。 */
  const tokenRef = useRef(0)
  const editorRef = useRef<HTMLIFrameElement | null>(null)

  const scale = qualityScale(quality, cardWidth)
  const viewportWidth = cardWidth + canvasPad(cardWidth) * 2
  const displayWidth = result ? Math.round(result.width / scale) : viewportWidth

  const messages = useMemo(() => collect(range), [collect, range])

  /*
   * 截图要跟着对话流里选的缩放档位走（与 iu/html 卡片同源，都读 prefs）。
   *
   * 为什么必须带上：用户在 150% 下看着正好，截出来却是 100% 的小字 ——
   * 「所见即所得」是截图功能的基本预期。编辑模式（传完整 html）不需要它，
   * 因为那时缩放已经烘焙进 HTML 里了。
   */
  const zoom = useMemo(() => readIuZoom(), [])

  const run = useCallback((): void => {
    const token = tokenRef.current + 1
    tokenRef.current = token
    if (messages.length === 0) {
      // 收口必须完整：这条分支已经把 tokenRef 推进了，在途的那个旧请求在
      // .finally 里必然因 token 不匹配而跳过 setBusy(false)。若这里也不置
      // false，busy 就永久停在 true —— 面板一直转「正在渲染…」、error 被
      // `!busy &&` 挡住看不见、保存/复制/重新渲染/下载全部 disabled，用户
      // 只能关掉重开。触发路径：打开即自动渲染时点范围/宽度/画质，而新范围
      // 的 collect() 返回空（纯 steering 轮次、reply 命中不到 tail 等）。
      setBusy(false)
      setResult(null)
      setError('这个范围里没有可截图的文本内容')
      setToast(null)
      return
    }
    setBusy(true)
    setError(null)
    setSavedPath(null)
    setToast(null)
    render({ messages, theme, width: cardWidth, quality, title: titleText, label: labelText, cwd, zoom })
      .then((next) => {
        if (tokenRef.current !== token) return
        setResult(next)
      })
      .catch((cause: unknown) => {
        if (tokenRef.current !== token) return
        setResult(null)
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (tokenRef.current !== token) return
        setBusy(false)
      })
  }, [messages, theme, cardWidth, quality, titleText, labelText, cwd, zoom])

  // 打开时渲染一次，之后任一选项变化都重渲染。
  useEffect(() => { run() }, [run])

  // Esc 关闭。
  useEffect(() => {
    if (closing) return undefined
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [closing, onClose])

  // ── 元素删除编辑模式：进入 / 重置 / 应用删除 / 退出 ───────────────────────

  /** 进入编辑：预览切片为可点击的 HTML 页面（iframe 内点选元素标记删除）。 */
  const startEdit = useCallback((): void => {
    const html = result?.html
    if (typeof html !== 'string' || html === '') return
    // mermaid 占位需要 host 侧引擎渲染，编辑页里既画不了也不该重放，禁用编辑。
    if (html.includes('class="mermaid"') || html.includes("class='mermaid'")) {
      setError('该截图包含流程图（mermaid），暂不支持元素删除')
      return
    }
    setBaseHtml(html)
    setEditHtml(html)
    if (result !== null) {
      setFrameHeight(Math.round(result.height / scale))
    }
    setMarked(0)
    setEditing(true)
    setError(null)
  }, [result, scale])

  /** 重置编辑：回到进入编辑时的原始 HTML（撤销全部标记与删除）。 */
  const resetEdit = useCallback((): void => {
    if (baseHtml === null) return
    setEditHtml(baseHtml)
    setMarked(0)
    if (result !== null && typeof result.html === 'string' && result.html !== baseHtml) {
      const token = tokenRef.current + 1
      tokenRef.current = token
      setBusy(true)
      setError(null)
      render({
        messages,
        theme,
        width: cardWidth,
        quality,
        title: titleText,
        label: labelText,
        html: baseHtml,
        cwd,
      })
        .then((nextResult) => {
          if (tokenRef.current !== token) return
          setResult(nextResult)
          setFrameHeight(Math.round(nextResult.height / scale))
        })
        .catch((cause: unknown) => {
          if (tokenRef.current !== token) return
          setError(cause instanceof Error ? cause.message : String(cause))
        })
        .finally(() => {
          if (tokenRef.current !== token) return
          setBusy(false)
        })
    }
  }, [baseHtml, result, messages, theme, cardWidth, quality, titleText, labelText, scale, cwd])

  /** 退出编辑：切回 PNG 预览（未应用删除时预览仍是最初渲染图）。 */
  const stopEdit = useCallback((): void => {
    setEditing(false)
    setBaseHtml(null)
    setEditHtml(null)
    setMarked(0)
  }, [])

  // 编辑 iframe：注入高亮/标记交互脚本（悬停红虚线、点击加删除标记、再点取消）。
  useEffect(() => {
    if (!editing || editHtml === null) return undefined
    const frame = editorRef.current
    if (frame === null) return undefined
    let disposed = false

    const syncHeight = (doc: Document): void => {
      if (disposed) return
      const body = doc.body
      const root = doc.documentElement
      if (body === null || root === null) return
      const h = Math.max(body.scrollHeight, root.scrollHeight)
      if (h > 0) setFrameHeight(h)
    }

    const attach = (): void => {
      if (disposed) return
      const doc = frame.contentDocument
      if (doc === null || doc.body === null) return
      if (doc.getElementById('webui-shot-editor-style') !== null) return

      const style = doc.createElement('style')
      style.id = 'webui-shot-editor-style'
      style.textContent = [
        'html, body { overflow: hidden !important; }',
        '.webui-shot-hover{outline:2px dashed var(--dsw-alias-state-error-primary, #e5484d) !important;outline-offset:2px !important;cursor:crosshair !important}',
        '.webui-shot-mark{outline:2px solid var(--dsw-alias-state-error-primary, #e5484d) !important;outline-offset:2px !important;position:relative !important;opacity:0.45 !important;overflow:visible !important;cursor:pointer !important}',
        '.webui-shot-mark::after{content:"已选 · 点击取消";position:absolute;top:-20px;left:0;z-index:9999;padding:1px 6px;border-radius:4px;background:var(--dsw-alias-state-error-primary, #e5484d);color:#fff;font:11px/16px sans-serif;pointer-events:none;white-space:nowrap;opacity:1 !important}',
      ].join('\n')
      doc.head.appendChild(style)

      syncHeight(doc)

      let ro: ResizeObserver | null = null
      if (typeof ResizeObserver !== 'undefined' && doc.body !== null) {
        ro = new ResizeObserver(() => { syncHeight(doc) })
        ro.observe(doc.body)
      }

      const onOver = (event: MouseEvent): void => {
        const target = event.target as Element | null
        if (target === null || target === doc.body || target === doc.documentElement || target.classList.contains('card')) return
        doc.querySelectorAll('.webui-shot-hover').forEach(el => el.classList.remove('webui-shot-hover'))
        if (!target.closest('.webui-shot-mark')) target.classList.add('webui-shot-hover')
      }

      const onOut = (): void => {
        doc.querySelectorAll('.webui-shot-hover').forEach(el => el.classList.remove('webui-shot-hover'))
      }

      const onClick = (event: MouseEvent): void => {
        const target = event.target as Element | null
        if (target === null || target === doc.body || target === doc.documentElement || target.classList.contains('card')) return
        event.preventDefault()
        event.stopPropagation()
        const existingMark = target.closest('.webui-shot-mark')
        if (existingMark !== null) {
          existingMark.classList.remove('webui-shot-mark')
        } else {
          target.classList.remove('webui-shot-hover')
          target.classList.add('webui-shot-mark')
        }
        setMarked(doc.querySelectorAll('.webui-shot-mark').length)
      }

      doc.addEventListener('mouseover', onOver)
      doc.addEventListener('mouseout', onOut)
      doc.addEventListener('click', onClick, true)
      setMarked(doc.querySelectorAll('.webui-shot-mark').length)
    }

    frame.addEventListener('load', attach)

    let tries = 0
    const timer = window.setInterval(() => {
      tries += 1
      if (frame.contentDocument?.body != null) {
        window.clearInterval(timer)
        attach()
      } else if (tries > 100) {
        window.clearInterval(timer)
      }
    }, 10)

    return () => {
      disposed = true
      frame.removeEventListener('load', attach)
      window.clearInterval(timer)
    }
  }, [editing, editHtml])

  /** 应用删除：把已标记元素从 iframe DOM 移除 → 序列化 → 重新渲染 PNG。 */
  const applyDelete = useCallback((): void => {
    const frame = editorRef.current
    const doc = frame?.contentDocument
    if (doc == null || doc.body === null) return
    const marks = doc.querySelectorAll('.webui-shot-mark')
    if (marks.length === 0) {
      setError('还没有标记任何元素——先点击想删除的部分')
      return
    }
    // 先清掉悬停类与临时注入的编辑交互样式，再移除标记元素，避免序列化残留。
    doc.querySelectorAll('.webui-shot-hover').forEach(el => el.classList.remove('webui-shot-hover'))
    doc.getElementById('webui-shot-editor-style')?.remove()
    marks.forEach(el => el.remove())
    const next = `<!DOCTYPE html>${doc.documentElement.outerHTML}`
    const token = tokenRef.current + 1
    tokenRef.current = token
    setBusy(true)
    setError(null)
    render({
      messages,
      theme,
      width: cardWidth,
      quality,
      title: titleText,
      label: labelText,
      html: next,
      cwd,
    })
      .then((nextResult) => {
        if (tokenRef.current !== token) return
        setResult(nextResult)
        // 编辑后的 HTML 回传（宿主原样返回）；iframe 换成删完的版本继续编辑。
        if (typeof nextResult.html === 'string') {
          setEditHtml(nextResult.html)
          setFrameHeight(Math.round(nextResult.height / scale))
          setMarked(0)
        }
      })
      .catch((cause: unknown) => {
        if (tokenRef.current !== token) return
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (tokenRef.current !== token) return
        setBusy(false)
      })
  }, [messages, theme, cardWidth, quality, titleText, labelText, scale, cwd])

  const switchRange = useCallback((next: ShotRange): void => {
    setRange(next)
    // 用户未手动编辑过标题时，切换范围在「本次对话标题」与「会话标题」间自动跟随
    if (!userEditedTitleRef.current) {
      if (next === 'all') {
        if (sessionTitle && sessionTitle.trim() !== '') {
          setTitleText(sessionTitle)
        }
      } else {
        if (dialogueTitle && dialogueTitle.trim() !== '') {
          setTitleText(dialogueTitle)
        }
      }
    }
  }, [dialogueTitle, sessionTitle])

  const onSave = useCallback((): void => {
    if (result === null) return
    save(result.id)
      .then((saved) => { setSavedPath(saved.path); setToast('已保存到本地') })
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)) })
  }, [result])

  const onCopy = useCallback((): void => {
    if (result === null) return
    const write = async (): Promise<void> => {
      const blob = await (await fetch(result.imageUrl, { cache: 'no-store' })).blob()
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    }
    write()
      .then(() => { setToast('图片已复制到剪贴板') })
      .catch(() => { setError('复制失败：浏览器拒绝了剪贴板写入，请改用「下载 PNG」') })
  }, [result])

  const onCopyPath = useCallback((): void => {
    if (savedPath === null) return
    navigator.clipboard?.writeText(savedPath)
      .then(() => { setToast('路径已复制') })
      .catch(() => { /* 忽略：路径本身已显示在底栏 */ })
  }, [savedPath])

  const anim = closing ? 'out' : 'in'
  const meta = savedPath !== null
    ? savedPath
    : result !== null
      ? `${result.width} × ${result.height} px · ${humanBytes(result.bytes)} · ${messages.length} 条消息`
      : ''

  return createPortal(
    <>
      <div className={cls.mask} aria-hidden="true" onClick={onClose} />
      <div className={cls.panel} data-anim={anim} data-editing={editing || undefined} role="dialog" aria-modal="true" aria-label="对话截图">
        <div className={cls.head}>
          <span className={cls.title}>对话截图</span>
          <button type="button" className={cls.close} aria-label="关闭" onClick={onClose}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className={cls.bar}>
          <div className={cls.group}>
            <span className={cls.label}>范围</span>
            <div className={cls.seg} role="group" aria-label="截图范围">
              {(['reply', 'turn', 'all'] as const).map(item => (
                <button
                  key={item}
                  type="button"
                  className={item === range ? `${cls.segItem} ${cls.segItemOn}` : cls.segItem}
                  aria-pressed={item === range}
                  onClick={() => { switchRange(item) }}
                >
                  {RANGE_LABEL[item]}
                </button>
              ))}
            </div>
          </div>
          <div className={cls.group}>
            <span className={cls.label}>宽度</span>
            <div className={cls.seg} role="group" aria-label="卡片宽度">
              {WIDTH_PRESETS.map(w => (
                <button
                  key={w}
                  type="button"
                  className={cardWidth === w ? `${cls.segItem} ${cls.segItemOn}` : cls.segItem}
                  aria-pressed={cardWidth === w}
                  onClick={() => {
                    setCardWidth(w)
                    setWidthDraft(String(w))
                  }}
                >
                  {WIDTH_LABELS[w]}
                </button>
              ))}
            </div>
            <div className={cls.widthBox} title="自定义宽度 (360~2560 px)">
              <input
                type="number"
                className={cls.widthInput}
                value={widthDraft}
                min={360}
                max={2560}
                step={10}
                aria-label="自定义卡片宽度"
                onChange={(event) => { setWidthDraft(event.target.value) }}
                onBlur={() => {
                  const parsed = parseInt(widthDraft, 10)
                  if (!Number.isNaN(parsed)) {
                    const clamped = Math.max(360, Math.min(2560, parsed))
                    setCardWidth(clamped)
                    setWidthDraft(String(clamped))
                  } else {
                    setWidthDraft(String(cardWidth))
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur()
                  } else if (event.key === 'Escape') {
                    setWidthDraft(String(cardWidth))
                    event.currentTarget.blur()
                  }
                }}
              />
              <span className={cls.unit}>px</span>
            </div>
          </div>
          <div className={cls.group}>
            <span className={cls.label}>画质</span>
            <div className={cls.seg} role="group" aria-label="输出画质">
              {(Object.keys(QUALITY_LABEL) as ShotQuality[]).map(item => (
                <button
                  key={item}
                  type="button"
                  className={item === quality ? `${cls.segItem} ${cls.segItemOn}` : cls.segItem}
                  aria-pressed={item === quality}
                  onClick={() => { setQuality(item) }}
                >
                  {QUALITY_LABEL[item]}
                </button>
              ))}
            </div>
          </div>
          <div className={cls.group}>
            <span className={cls.label}>主题</span>
            <select
              className={cls.select}
              value={theme}
              aria-label="截图主题"
              disabled={editing}
              onChange={(event) => { setTheme(event.target.value as ShotTheme) }}
            >
              {(Object.keys(THEME_LABEL) as ShotTheme[]).map(item => (
                <option key={item} value={item}>{THEME_LABEL[item]}</option>
              ))}
            </select>
          </div>
        </div>

        <div className={cls.bar}>
          <EditableText
            label="标题"
            value={titleText}
            placeholder="留空则从消息正文自动推导"
            onCommit={(val) => {
              userEditedTitleRef.current = true
              setTitleText(val)
            }}
          />
          <EditableText
            label="徽章"
            value={labelText}
            placeholder="如：Kr"
            onCommit={setLabelText}
          />
          <span className={cls.meta}>输出宽约 {cardWidth * scale} px</span>
        </div>

        {editing && editHtml !== null && (
          <div className={cls.editBar}>
            <span className={cls.editHint}>点击页面上的元素进行删除；点击已标记的元素取消标记</span>
            <span className={cls.editCount} data-n={marked > 0 ? '' : undefined}>已标记 {marked} 个</span>
            <span className={cls.editSpacer} />
            <button
              type="button"
              className={cls.action}
              disabled={busy}
              onClick={resetEdit}
            >
              重置
            </button>
            <button
              type="button"
              className={cls.action}
              disabled={busy}
              onClick={stopEdit}
            >
              退出编辑
            </button>
            <button
              type="button"
              className={cls.primary}
              disabled={busy || marked === 0}
              onClick={applyDelete}
            >
              删除 {marked > 0 ? `${marked} 个` : ''}并重新生成
            </button>
          </div>
        )}

        <div className={cls.stage}>
          <div className={cls.canvas}>
            {busy && (
              <div className={cls.hint}>
                <span className={cls.spinner} />
                <span>正在渲染…</span>
              </div>
            )}
            {!busy && error !== null && <div className={cls.error}>{error}</div>}
            {!busy && error === null && (
              editing && editHtml !== null ? (
                <iframe
                  ref={editorRef}
                  className={cls.frame}
                  srcDoc={editHtml}
                  sandbox="allow-same-origin"
                  title="截图编辑预览"
                  style={{
                    width: `${displayWidth}px`,
                    maxWidth: '100%',
                    height: frameHeight ? `${frameHeight}px` : undefined,
                  }}
                />
              ) : (
                result !== null && (
                  <img
                    className={cls.img}
                    src={result.imageUrl}
                    alt="截图预览"
                    style={{
                      width: `${displayWidth}px`,
                      maxWidth: '100%',
                    }}
                  />
                )
              )
            )}
          </div>
        </div>

        <div className={cls.foot}>
          <span className={toast !== null ? `${cls.meta} ${cls.toast}` : cls.meta}>
            {toast !== null ? toast : meta}
          </span>
          <div className={cls.actions}>
            <button type="button" className={cls.action} disabled={busy} onClick={() => { if (editing) stopEdit(); run() }}>重新渲染</button>
            {result !== null && typeof result.html === 'string' && !editing && (
              <button type="button" className={cls.action} disabled={busy} onClick={startEdit}>元素删除</button>
            )}
            {savedPath !== null && (
              <button type="button" className={cls.action} onClick={onCopyPath}>复制路径</button>
            )}
            <button type="button" className={cls.action} disabled={result === null} onClick={onCopy}>复制图片</button>
            <a
              className={cls.action}
              href={result?.imageUrl ?? '#'}
              download="dsh-screenshot.png"
              aria-disabled={result === null}
              onClick={(event) => { if (result === null) event.preventDefault() }}
            >
              下载 PNG
            </a>
            <button type="button" className={cls.action} onClick={() => { void reveal() }}>打开目录</button>
            <button type="button" className={cls.primary} disabled={result === null} onClick={onSave}>保存</button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}
