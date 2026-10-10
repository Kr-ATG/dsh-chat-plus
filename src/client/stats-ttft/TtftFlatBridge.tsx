/**
 * dsh-chat-plus — 首 token 平均平铺桥（渲染空壳，只做 DOM 追认）。
 *
 * 为什么是 DOM 追认而不是重写官方座位：
 * 底部那行是官方 StatsPills（conversation.composer.dock / id stats），整行
 * 含两个 pill 与两张点开卡片。shadow 同 id 会把官方整行吃掉，之后官方每次
 * 改文案都得跟着抄；用不同 id 另起一行又会多出一行。本桥与官方同槽共存，
 * 只把算好的读数塞进官方 TimePill 的 label 末尾，官方重渲染把它洗掉时由
 * MutationObserver 补回去。官方卡片里的那行原样保留，两处读数同一口径。
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

/** 读数在官方行里的 CG：找到 TimePill 的 pill 与 label。 */
function findTimePill(root: Element): { pill: HTMLElement; label: HTMLElement } | null {
  const anchor = root.firstElementChild
  if (anchor === null || !(anchor instanceof HTMLElement)) return null
  const pill = anchor.firstElementChild
  if (pill === null || !(pill instanceof HTMLElement)) return null
  let label: HTMLElement | null = null
  const kids = pill.children
  for (let i = 0; i < kids.length; i++) {
    const child = kids[i]
    if (child instanceof HTMLElement && child.tagName.toLowerCase() === 'span' && (child.textContent ?? '').length > 0) {
      label = child
      break
    }
  }
  if (label === null) label = pill
  return { pill, label }
}

function removeFlat(root: Element): void {
  const flat = root.querySelector('[' + FLAT_ATTR + ']')
  if (flat !== null) flat.remove()
  const buttons = root.querySelectorAll('button[data-dsh-ttft-orig-aria]')
  buttons.forEach((btn) => {
    const orig = btn.getAttribute('data-dsh-ttft-orig-aria') ?? ''
    if (orig === '') btn.removeAttribute('aria-label')
    else btn.setAttribute('aria-label', orig)
    btn.removeAttribute('data-dsh-ttft-orig-aria')
  })
}

/**
 * 把读数塞进官方 TimePill。幂等：已存在且文本一致时不碰 DOM，
 * 避免自己的写入又触发 observer 造成循环。
 */
export function syncTtftFlat(text: string | null): void {
  if (typeof document === 'undefined') return
  const root = document.querySelector('[data-composer-stats]')
  if (root === null) return
  if (text === null) {
    removeFlat(root)
    return
  }
  const found = findTimePill(root)
  if (found === null) return
  const { pill, label } = found
  let flat = label.querySelector('[' + FLAT_ATTR + ']')
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
    label.appendChild(flat)
  } else {
    if (flat.parentElement !== label) label.appendChild(flat)
    const txt = flat.querySelector('[' + TEXT_ATTR + ']') ?? flat
    if (txt.textContent !== text) txt.textContent = text
  }
  if (pill.tagName.toLowerCase() === 'button') {
    if (pill.getAttribute('data-dsh-ttft-orig-aria') === null) {
      pill.setAttribute('data-dsh-ttft-orig-aria', pill.getAttribute('aria-label') ?? '')
    }
    const visual = (label.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (visual !== '' && pill.getAttribute('aria-label') !== visual) {
      pill.setAttribute('aria-label', visual)
    }
  }
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
