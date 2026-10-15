/**
 * dsh-chat-plus — 首 token 平均平铺桥（渲染空壳，只做 DOM 追认）。
 *
 * 为什么是 DOM 追认而不是重写官方座位：
 * 底部那行是官方 StatsPills（conversation.composer.dock，占位者 id activity
 * 与 usage），整行含两颗 pill 与两张点开卡片。shadow 同 id 会把官方整行吃掉，
 * 之后官方每次改文案都得跟着抄；用不同 id 另起一行又会多出一行。本桥与官方
 * 同槽共存，只把算好的读数作为 flex item 追加进官方活动 pill，官方重渲染把它
 * 洗掉时由 MutationObserver 补回去。官方点开卡片里的那行原样保留，同一口径。
 *
 * 锚点（0.2.1-alpha.4 起）：官方给每颗 pill 打了 `data-composer-stat`
 * （activity / usage），外面套 `[data-composer-dock]`。这里认 activity 那颗；
 * 它缺席（steps 为 0 或 Compact 模式无速度）时退到第一颗存在的 pill，
 * 再退到旧版的整行容器 `[data-composer-stats]`（复数，0.1.x 结构）。
 *
 * 数据：sessionStats 投影优先（整场会话），缺席时用窗口内 assistant 节点
 * 现算（与官方回退同源）。无数据时不渲染、不留空位。
 */

import { useEffect, useRef } from 'react'
import { foldWindowTtft, ttftFlatText } from './ttft-flat.ts'
import { injectTtftFlatStyles } from './styles.ts'

const FLAT_ATTR = 'data-dsh-ttft-flat'
const TEXT_ATTR = 'data-dsh-ttft-text'
const SEP_ATTR = 'data-dsh-ttft-sep'
const ARIA_SEP = ' · '

/**
 * 读屏文本的账本：pill → 官方原文 + 我们写进去的全文。
 *
 * 为什么不把「官方原文」存在 pill 的 data-* 属性上：官方每次重渲染都会重设
 * aria-label，属性里那份会变陈旧，下次同步就会拿旧值把新步数覆盖回去。存在
 * 内存里则每次同步都能判定「当前 aria-label 还是不是我写的」——不是就说明
 * 官方已经换过一轮，直接以它为新基准，旧账作废。
 */
const ariaLedger = new WeakMap<HTMLElement, { base: string; written: string }>()

/**
 * 找到要塞读数的那颗 pill（pill = anchor 内的 button，或 PlainPill 的 span）。
 *
 * 三条锚点按新旧依次回退：activity pill → 任意 pill → 旧版整行容器。
 * 全部拿不到就返回 null（调用方静默跳过，不影响对话其它功能）。
 */
function findStatsPill(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const anchor =
    document.querySelector('[data-composer-stat="activity"]') ??
    document.querySelector('[data-composer-stat]') ??
    document.querySelector('[data-composer-stats]')
  if (!(anchor instanceof HTMLElement)) return null
  const first = anchor.firstElementChild
  if (first instanceof HTMLElement) return first
  return anchor
}

/** 还原 aria-label：把我们追加的那段剥掉，回到官方原文。 */
function restoreAria(pill: HTMLElement): void {
  if (pill.tagName.toLowerCase() !== 'button') return
  const ledger = ariaLedger.get(pill)
  if (ledger === undefined) return
  if (pill.getAttribute('aria-label') === ledger.written) {
    if (ledger.base === '') pill.removeAttribute('aria-label')
    else pill.setAttribute('aria-label', ledger.base)
  }
  ariaLedger.delete(pill)
}

/** 清掉这颗 pill 上的读数节点（含 aria 还原）。 */
function removeFlat(pill: HTMLElement): void {
  const flat = pill.querySelector('[' + FLAT_ATTR + ']')
  if (flat !== null) flat.remove()
  restoreAria(pill)
}

/**
 * 读屏文本：在官方 aria-label 后追加读数。
 *
 * 不拿 label 的 textContent 重拼——label 内的分隔点是独立 span，textContent
 * 拼起来会丢空格。基准取「当前 aria-label 若仍是我们写的，则剥掉尾巴」。
 */
function syncAria(pill: HTMLElement, text: string): void {
  if (pill.tagName.toLowerCase() !== 'button') return
  const current = pill.getAttribute('aria-label') ?? ''
  const ledger = ariaLedger.get(pill)
  const base = ledger !== undefined && current === ledger.written ? ledger.base : current
  const next = base === '' ? text : base + ARIA_SEP + text
  ariaLedger.set(pill, { base, written: next })
  if (current !== next) pill.setAttribute('aria-label', next)
}

/**
 * 把读数塞进官方活动 pill。幂等：已存在且文本一致时不碰 DOM，
 * 避免自己的写入又触发 observer 造成循环。
 *
 * 读数作为 pill 的直接子元素追加，**不进 label** —— 官方 label 带
 * `text-overflow:ellipsis; overflow:hidden`，塞进去会被省略号吃掉；
 * pill 本身是 `inline-flex; gap:6px`，多一个 flex item 自然对齐。
 */
export function syncTtftFlat(text: string | null): void {
  if (typeof document === 'undefined') return
  const pill = findStatsPill()
  // 目标 pill 换了（如官方 activity 消失退到 usage）：先把旧 pill 的残留清干净，
  // 否则同一行会同时挂着两条读数。
  document.querySelectorAll('[' + FLAT_ATTR + ']').forEach((node) => {
    const host = node.parentElement
    if (host instanceof HTMLElement && host !== pill) removeFlat(host)
  })
  if (pill === null) return
  if (text === null) {
    removeFlat(pill)
    return
  }
  let flat = pill.querySelector('[' + FLAT_ATTR + ']')
  if (flat === null || !(flat instanceof HTMLElement)) {
    flat = document.createElement('span')
    flat.setAttribute(FLAT_ATTR, '')
    const sep = document.createElement('span')
    sep.setAttribute(SEP_ATTR, '')
    sep.setAttribute('aria-hidden', 'true')
    sep.textContent = '·'
    const txt = document.createElement('span')
    txt.setAttribute(TEXT_ATTR, '')
    txt.textContent = text
    flat.appendChild(sep)
    flat.appendChild(txt)
    pill.appendChild(flat)
  } else {
    if (flat.parentElement !== pill) pill.appendChild(flat)
    const txt = flat.querySelector('[' + TEXT_ATTR + ']') ?? flat
    if (txt.textContent !== text) txt.textContent = text
  }
  syncAria(pill, text)
}

export function TtftFlatBridge(props: any) {
  const useProjection = props?.useProjection
  const useChat = props?.useChat
  const t = typeof props?.t === 'function' ? props.t : undefined
  const projected = typeof useProjection === 'function' ? useProjection('sessionStats') : undefined
  const nodes = (typeof useChat === 'function'
    ? useChat((s: any) => s?.legacy?.nodes)
    : undefined) as readonly unknown[] | undefined
  const stats = projected !== undefined && projected !== null
    ? projected
    : foldWindowTtft(nodes)
  const text = ttftFlatText(stats as any, t)
  const textRef = useRef<string | null>(text)
  textRef.current = text

  useEffect(() => {
    injectTtftFlatStyles()
  }, [])

  useEffect(() => {
    syncTtftFlat(text)
  }, [text])

  useEffect(() => {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return
    let scheduled = false
    const apply = (): void => {
      scheduled = false
      try {
        syncTtftFlat(textRef.current)
      } catch {
        // DOM 追认失败不影响对话其它功能
      }
    }
    const observer = new MutationObserver(() => {
      if (scheduled) return
      scheduled = true
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply)
      else apply()
    })
    try {
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    } catch {
      return
    }
    return () => {
      observer.disconnect()
    }
  }, [])

  return null
}
