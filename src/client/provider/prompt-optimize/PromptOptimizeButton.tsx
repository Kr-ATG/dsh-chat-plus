/**
 * PromptOptimizeButton — 对话框「优化提示词」入口（移植自 dsh-webui 同模块 v2）。
 *
 * 注册在 `conversation.input.right`（order 4，位于供应商标签 order 10 左侧）。
 *
 * 交互（旧版三宗罪的针对性修复）：
 *  1. **点击开面板，不再 hover 抖动**：hover 面板会在鼠标经过输入区时乱弹，
 *     且开关点不中；现在点击图标开/关面板，Esc 与点击外部关闭。
 *  2. **结果先预览、点「应用」才写回草稿**：旧版流式直接改草稿，用户既看不清
 *     改了什么，中途失败还得靠代码回滚原文；现在原文始终留在输入框，面板里
 *     并列展示原文与优化结果。
 *  3. **风格三档取代「多轮候选」**：均衡 / 精简 / 详尽，换档即重试（自动中止
 *     上一次），不再一次并行烧 3~5 倍 token。
 *
 * 结果正文由 host 用共享的 `cleanOptimized` 清洗（去围栏 / 去「优化后的提示词」
 * 小标题 / 去结尾「主要改动」段落），client 收到的 done 帧即可直接写回。
 *
 * 草稿读写都走 session 槽位的标准套件：读 `useInput`（快照 hook，随 skeleton
 * 重渲染实时更新）、写 `inputActions.setDraft`（唯一公开写入路径），不碰 DOM。
 * 注意：`conversation.input.right` 是 list 槽位且**没有 owner 共享**（只有
 * `conversation.input.dock` 带 InputZone），早先按 owner 取 `input` 会拿到
 * undefined，渲染期抛错被槽位错误边界吞掉，表现为「按钮静默不出现」。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SessionId, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
// Type-only 席位契约：标准套件（useInput hook / inputActions 动作面）在
// ui-conversation/client 的 SessionStandardProps 里声明，构建期整句擦除。
import type { InputActions, InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import {
  IconCloseOutlineRegular, IconLoadingOutlineRegular, IconRefreshOutlineRegular, IconSparkleRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { cleanOptimized, previewOptimized } from '../../../provider/modules/prompt-optimize-clean.ts'
import { css, ensureStyles } from './styles'

/** 极简 cx 替代（上游 webui 用 clsx；本插件不引入第三方运行时依赖）。 */
function cx(...parts: ReadonlyArray<string | false | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' ')
}

/** 优化入口的注入面（inject 返回）。 */
export interface PromptOptimizeInjected {
  /** 本会话是否支持模型选择（addressed subagent 会话为 false）。 */
  available: boolean
  /** 会话共享的模型目录 store（读当前选中 provider/model）。 */
  directory: SnapshotStore<ModelDirectoryState>
  /** 所属会话 id：POST 时回传，供 host 端「显式停止」定位本次优化。 */
  sessionId: SessionId
}

/** 组件完整 props：注入面 + 标准套件（读草稿 / 写回）。 */
export interface PromptOptimizeProps extends PromptOptimizeInjected {
  /** 会话输入机快照 hook（标准套件；读当前草稿）。 */
  useInput: SnapshotSelectorHook<InputState>
  /** 输入动作面（标准套件子集：写回优化后的草稿）。 */
  inputActions: InputActions
}

/** 优化风格（与 host 的 STYLE_RULES 对应）。 */
type Style = 'balanced' | 'concise' | 'detailed'

/** 风格 chips 文案。 */
const STYLES: ReadonlyArray<{ id: Style; label: string; hint: string }> = [
  { id: 'balanced', label: '均衡', hint: '补齐目标、约束与输出格式，长度大致不变' },
  { id: 'concise', label: '精简', hint: '压到最短，只保留必要要求' },
  { id: 'detailed', label: '详尽', hint: '补充上下文、输入输出格式与验收标准' },
]

/** SSE 帧负载（host 端发送）。 */
interface StreamFrame {
  type?: 'delta' | 'done' | 'error'
  text?: string
  elapsedMs?: number
  partial?: boolean
  /** 输出顶到 maxTokens 被截断：正文可能不完整，不能当完整结果直接发送。 */
  truncated?: boolean
  message?: string
}

/** localStorage 键：上次选择的风格 / 「设为目标」开关。 */
const STYLE_KEY = 'dsh-prompt-optimize:style'
const TARGET_KEY = 'dsh-prompt-optimize:set-target'
/**
 * 「上次优化结果」缓存键前缀（按会话）。
 *
 * 之前面板一关结果就没了：用户点了优化、按 Esc 或点到外面，辛苦生成的正文
 * 直接蒸发，既不能对比两档风格、也不能稍后再用。现在按会话留一份，重开面板
 * 即可恢复（草稿没变时直接展示，不重复烧 token）。
 */
const CACHE_KEY_PREFIX = 'dsh-prompt-optimize:last:'

/** 面板与图标之间的间距（px）。 */
const PANEL_GAP = 10

/** 读上次选择的风格（默认均衡）。 */
function readStyle(): Style {
  try {
    const raw = window.localStorage.getItem(STYLE_KEY)
    return raw === 'concise' || raw === 'detailed' ? raw : 'balanced'
  } catch {
    return 'balanced'
  }
}

/** 读「设为目标」开关（默认关：/goal 会创建长任务目标，不该是默认行为）。 */
function readTarget(): boolean {
  try { return window.localStorage.getItem(TARGET_KEY) === '1' } catch { return false }
}

/** 一份可恢复的上次结果（原文 + 正文 + 风格）。 */
interface CachedResult {
  source: string
  result: string
  style: Style
}

/** 读某会话上次的结果；没有/损坏返回 null。 */
function readCache(sessionId: string): CachedResult | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY_PREFIX + sessionId)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const record = parsed as Record<string, unknown>
    if (typeof record.source !== 'string' || typeof record.result !== 'string') return null
    if (record.result === '') return null
    const style = record.style === 'concise' || record.style === 'detailed' ? record.style : 'balanced'
    return { source: record.source, result: record.result, style }
  } catch {
    return null
  }
}

/** 写某会话上次的结果（正文过长不缓存：localStorage 有配额，宁可丢缓存不能抛错）。 */
function writeCache(sessionId: string, value: CachedResult | null): void {
  try {
    if (value === null) { window.localStorage.removeItem(CACHE_KEY_PREFIX + sessionId); return }
    if (value.result.length > 20000) return
    window.localStorage.setItem(CACHE_KEY_PREFIX + sessionId, JSON.stringify(value))
  } catch { /* 配额满 / 隐私模式：缓存失效不影响主流程 */ }
}

/** 写 localStorage（失败静默：隐私模式下仍按内存值工作）。 */
function store(key: string, value: string): void {
  try { window.localStorage.setItem(key, value) } catch { /* ignore */ }
}

/** 把毫秒格式化为可读耗时。 */
function formatMs(ms: number | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return ''
  return ms < 1000 ? `${String(Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}s`
}

/** 面板定位样式（贴图标上方、右对齐，夹在视口内）。 */
function panelStyle(anchor: DOMRect | null): { left: number; bottom: number } | undefined {
  if (anchor === null) return undefined
  const width = Math.min(560, window.innerWidth - 24)
  const left = Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12))
  return { left, bottom: Math.max(12, window.innerHeight - anchor.top + PANEL_GAP) }
}

/**
 * 渲染「优化提示词」入口（图标 + 面板）。
 * @param props - injected face + owner + standard kit。
 * @returns 图标按钮，或 null（subagent 会话不渲染）。
 */
export function PromptOptimizeButton({ available, directory, useInput, inputActions, sessionId }: PromptOptimizeProps) {
  ensureStyles()
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [style, setStyle] = useState<Style>(readStyle)
  const [setTarget, setSetTarget] = useState<boolean>(readTarget)
  /** 本次优化的原文（打开面板时快照，重试期间保持不变）。 */
  const [source, setSource] = useState('')
  /** 流式累积的原始输出（仅用于预览；最终以 done 帧的清洗文本为准）。 */
  const [streamed, setStreamed] = useState('')
  /** 清洗后的最终结果（可应用）。 */
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** 非致命提示（截断 / 被中断）：正文仍可用，不是失败，别用红字吓人。 */
  const [warn, setWarn] = useState('')
  const [elapsed, setElapsed] = useState('')
  const [anchor, setAnchor] = useState<DOMRect | null>(null)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const closeTimer = useRef<number | null>(null)
  /** 最新草稿（供异步回调读取，避免闭包陈旧）。 */
  const draft = useInput((state): string => state.draft)
  const draftRef = useRef(draft)
  draftRef.current = draft
  /** 组件是否仍挂载：abort 之后 catch/finally 还会跑一遍，那时不能再 setState。 */
  const mountedRef = useRef(true)

  /** 中止进行中的优化，并显式通知 host 停止模型调用。 */
  const stop = useCallback((): void => {
    // 刻意**不清** abortRef：run() 的 catch 用 `abortRef.current === controller`
    // 判断「我还是当前这次吗」。这里置 null 会让用户主动停止后 catch 提前
    // return，已生成的部分反而不再交付——那正是 stop 想给的东西。
    // 被换风格重试取代时，run() 会立刻把 abortRef 指向新 controller，旧请求
    // 自然被判为过期而静默退出。
    abortRef.current?.abort()
    void fetch('/api/dsh-prompt-optimize/stop', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    }).catch(() => { /* 停止通知失败不影响本地中止 */ })
  }, [sessionId])

  /** 发起一次优化（换风格重试走同一入口）。 */
  const run = useCallback(async (text: string, nextStyle: Style): Promise<void> => {
    const provider = directory.getSnapshot().current?.provider
    const model = directory.getSnapshot().current?.model
    if (provider === undefined || model === undefined) {
      setError('请先在右侧选择模型')
      return
    }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true)
    setError('')
    setWarn('')
    setElapsed('')
    setStreamed('')
    setResult('')

    // 本次流式的累积输出降为 run() 的局部变量。此前它是跨请求共享的
    // accRef，于是「换风格重试」时：旧请求的 abort 异常在 catch 里读到的
    // 可能是**新请求**刚写入的文本，把新结果覆盖成旧片段；新请求的 delta 又
    // 往旧请求的 streamed 上叠加。局部变量 + 下方 isCurrent 守卫一并解决。
    let acc = ''
    /**
     * 我还是当前这次优化吗？换风格重试会 abort 上一次，旧请求的 catch/finally
     * 若不加这道守卫，会用过期内容 setResult / setError / setBusy(false)。
     */
    const isCurrent = (): boolean => abortRef.current === controller && mountedRef.current

    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    try {
      const response = await fetch('/api/dsh-prompt-optimize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider, model, text, style: nextStyle, sessionId }),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`优化请求失败（HTTP ${String(response.status)}）`)
      if (response.body === null) throw new Error('无响应流')
      reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let terminal = false

      const onFrame = (frame: StreamFrame): void => {
        if (frame.type === 'delta' && typeof frame.text === 'string') {
          acc += frame.text
          setStreamed(prev => prev + frame.text)
          return
        }
        if (frame.type === 'done') {
          terminal = true
          // host 已用共享清洗器处理过；缺 text（旧 host / 空帧）时本地兜底清洗，
          // 保证「装了新 client 但 host 还没重启」也能正常出结果。
          const done = typeof frame.text === 'string' && frame.text !== ''
            ? frame.text
            : cleanOptimized(acc)
          setResult(done)
          setElapsed(formatMs(frame.elapsedMs))
          writeCache(sessionId, { source: text, result: done, style: nextStyle })
          if (frame.partial === true) setWarn('生成被中断，下面是已完成的部分')
          else if (frame.truncated === true) setWarn('输出达到长度上限，结果可能不完整，建议换「精简」风格或再点一次')
          return
        }
        if (frame.type === 'error') {
          terminal = true
          throw new Error(frame.message ?? '优化失败')
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let index: number
        while ((index = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, index)
          buffer = buffer.slice(index + 2)
          for (const line of block.split('\n')) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6)
            if (data === '') continue
            let payload: unknown
            try { payload = JSON.parse(data) } catch { continue }
            onFrame(payload as StreamFrame)
          }
        }
      }
      if (!terminal) throw new Error(controller.signal.aborted ? 'stopped' : '响应流意外结束')
    } catch (caught) {
      if (!isCurrent()) return
      const message = caught instanceof Error ? caught.message : String(caught)
      if (controller.signal.aborted || message === 'stopped') {
        // 用户停止（本地已 abort，收不到 host 的 partial done 帧）：把已生成的
        // 部分就地清洗后交付，仍然可「应用」，不白烧 token。
        const partial = cleanOptimized(acc)
        if (partial === '') setError('已停止优化')
        else {
          setResult(partial)
          writeCache(sessionId, { source: text, result: partial, style: nextStyle })
          setWarn('已停止 · 下面是已完成的部分')
        }
      } else setError(message)
    } finally {
      if (isCurrent()) {
        abortRef.current = null
        setBusy(false)
      }
      if (reader !== null) void reader.cancel().catch(() => {})
    }
  }, [directory, sessionId])

  /**
   * 打开面板：快照草稿并立即开始优化。
   *
   * 若上次关面板时留了结果、且草稿没变，就直接恢复它（不重复烧 token）；
   * 草稿变了才重跑——此时旧结果对新草稿没有意义。
   */
  const openPanel = useCallback((): void => {
    const draft = draftRef.current.trim()
    const rect = rootRef.current?.getBoundingClientRect() ?? null
    setAnchor(rect)
    setSource(draft)
    setStreamed('')
    setElapsed('')
    setError('')
    setWarn('')
    setOpen(true)
    if (draft === '') {
      setResult('')
      setError('输入框是空的，先写点什么再优化')
      return
    }
    const cached = readCache(sessionId)
    if (cached !== null && cached.source === draft) {
      setResult(cached.result)
      setStyle(cached.style)
      return
    }
    setResult('')
    void run(draft, style)
  }, [run, style, sessionId])

  /** 关闭面板（播完收起动画再卸载）。 */
  const closePanel = useCallback((): void => {
    if (busy) stop()
    setClosing(true)
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      setClosing(false)
      setOpen(false)
    }, 140)
  }, [busy, stop])

  // Esc 关闭 + 点击面板外关闭 + 视口变化时重算锚点。
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closePanel()
    }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (target === null) return
      if (panelRef.current?.contains(target) === true) return
      if (rootRef.current?.contains(target) === true) return
      closePanel()
    }
    const onViewport = (): void => { setAnchor(rootRef.current?.getBoundingClientRect() ?? null) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('resize', onViewport)
    window.addEventListener('scroll', onViewport, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('resize', onViewport)
      window.removeEventListener('scroll', onViewport, true)
    }
  }, [open, closePanel])

  // 卸载：中止请求与定时器（会话切换时组件会被卸载）。
  // mountedRef 也要断：abort 之后 catch/finally 仍会跑一遍，此时组件已不存在，
  // setState 是对已卸载组件的写。
  useEffect(() => () => {
    mountedRef.current = false
    abortRef.current?.abort()
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
  }, [])

  // 面板挂载后按锚点定位（内容高度变化不影响 bottom 定位）。
  useLayoutEffect(() => {
    if (!open) return
    if (anchor === null) setAnchor(rootRef.current?.getBoundingClientRect() ?? null)
  }, [open, anchor])

  if (!available) return null

  /** 切换风格：立即用新风格重跑（原文不变）。 */
  const pickStyle = (next: Style): void => {
    setStyle(next)
    store(STYLE_KEY, next)
    if (source !== '') void run(source, next)
  }

  /**
   * 应用结果：写回草稿（可选包成 /goal 命令）并关闭面板。
   *
   * `/goal` 的 objective 只要求「非空字符串」，多行完全合法（parseCommand 保留
   * rawInput 原文、Goal 域只做 trim）。所以这里**不再压平成单行**：压平会把
   * 代码块围栏压成裸反引号混进句子、把列表并成一行，等于把刚优化好的提示词
   * 再破坏一遍。目标是长任务时保留原有换行与结构，才是用户想要的东西。
   */
  const apply = (): void => {
    if (result === '') return
    inputActions.setDraft(setTarget ? `/goal ${result}` : result)
    // 已落到草稿，缓存没有价值了（否则下次重开面板会误以为「还是旧结果」）。
    writeCache(sessionId, null)
    closePanel()
  }

  const toggleTarget = (): void => {
    setSetTarget(prev => {
      const next = !prev
      store(TARGET_KEY, next ? '1' : '0')
      return next
    })
  }

  const snapshot = directory.getSnapshot()
  const current = snapshot.current
  const modelName = snapshot.groups.flatMap(group => group.models).find(model => model.id === current?.model)?.name
    ?? current?.model
    ?? '未选模型'
  // 生成中按「流式预览」规则清洗（半截围栏也能剥掉开场白），最终以 result 为准。
  const preview = result !== '' ? result : (streamed === '' ? '' : (previewOptimized(streamed) || streamed))
  const position = panelStyle(anchor)

  return (
    <div className={css.root} ref={rootRef}>
      <button
        type="button"
        className={cx(css.trigger, open && css.triggerActive)}
        aria-label="优化提示词"
        aria-expanded={open}
        title="优化提示词"
        onClick={() => { if (open) closePanel(); else openPanel() }}
      >
        {busy ? <IconLoadingOutlineRegular size={16} className={css.spin} /> : <IconSparkleRegular size={16} />}
      </button>

      {open && createPortal(
        <div
          className={css.panel}
          data-closing={closing ? '1' : undefined}
          style={position}
          ref={panelRef}
          role="dialog"
          aria-label="优化提示词"
        >
          <div className={css.head}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className={css.title}>优化提示词</div>
              <div className={css.sub}>{`用 ${modelName} 改写当前草稿`}</div>
            </div>
            <button type="button" className={css.close} aria-label="关闭" onClick={closePanel}>
              <IconCloseOutlineRegular size={16} />
            </button>
          </div>

          <div className={css.section}>
            <div className={css.chips} role="group" aria-label="优化风格">
              {STYLES.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className={cx(css.chip, style === item.id && css.chipOn)}
                  aria-pressed={style === item.id}
                  title={item.hint}
                  disabled={source === ''}
                  onClick={() => { pickStyle(item.id) }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {source !== '' && (
            <div className={css.section}>
              <div className={css.sectionLabel}>原文</div>
              <div className={css.source}>{source}</div>
            </div>
          )}

          <div className={css.section}>
            <div className={css.sectionLabel}>优化结果</div>
            <div className={cx(css.result, preview === '' && css.empty)}>
              {preview === ''
                ? (busy ? '正在生成…' : '暂无结果')
                : <>{preview}{busy && <span className={css.caret} />}</>}
            </div>
          </div>

          <div className={cx(css.status, busy && css.statusBusy, error !== '' && css.statusError, warn !== '' && css.statusWarn)}>
            {busy && <IconLoadingOutlineRegular size={16} className={css.spin} />}
            <span>
              {error !== ''
                ? error
                : warn !== ''
                  ? warn
                  : busy
                    ? '正在优化…'
                    : result !== ''
                      ? `已生成 ${String(result.length)} 字${elapsed === '' ? '' : ` · ${elapsed}`}`
                      : '选择风格后点「重新优化」'}
            </span>
          </div>

          <div className={css.optionRow}>
            <span className={css.optionLabel}>应用时设为长任务目标（/goal）</span>
            <button
              type="button"
              role="switch"
              aria-checked={setTarget}
              aria-label="应用时设为长任务目标"
              className={cx(css.switch, setTarget && css.switchOn)}
              onClick={toggleTarget}
            >
              <span className={cx(css.knob, setTarget && css.knobOn)} />
            </button>
          </div>

          <div className={css.actions}>
            {busy ? (
              <button type="button" className={cx(css.btn, css.btnDanger)} onClick={stop}>
                停止
              </button>
            ) : (
              <button
                type="button"
                className={cx(css.btn, css.btnGhost)}
                disabled={source === ''}
                onClick={() => { void run(source, style) }}
              >
                <IconRefreshOutlineRegular size={14} />
                重新优化
              </button>
            )}
            <button
              type="button"
              className={cx(css.btn, css.btnPrimary)}
              disabled={result === '' || busy}
              onClick={apply}
            >
              应用到输入框
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
