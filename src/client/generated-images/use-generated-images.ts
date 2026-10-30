/**
 * dsh-chat-plus — 本回合生图结果收集 hook（客户端）。
 *
 * 两级取数：
 *  1. **内联**：工具结果 JSON 未超 DSH spill 阈值时，文本即完整 JSON，
 *     `parseGeneratedImageText` 直接提取（b64_json → data URL）。
 *  2. **spill 外取**：结果超过阈值时文本只剩「preview + locator」，完整
 *     JSON 存在 host 侧 spill 文件里——从文本提取 locator，请求
 *     `/api/chat-flow/generated-images`（host 半身路由，仅 root 内、只回
 *     图片 URL），拿到图片数据。
 *
 * 缓存：内联结果按 block 对象（WeakMap），spill 结果按 callId（Map），
 * 同一结果只解析/请求一次；模块级缓存跨渲染复用。
 *
 * 2026-10-30 起额外导出「实时状态」与「按调用分组」：
 *  · running / prompt / startedAt / loading / error —— 对话流里的生图实时卡
 *    靠它决定是显示点阵动画还是已经到手的图片，不必等回合收口后的总结卡。
 *  · calls[] —— 每一次 generate_image 调用单独一条，带该次声明的张数 n 与
 *    尺寸 size（解析成宽高比）。实时卡按「这次要生成几张就画几个点阵、每个
 *    点阵按这张图的比例」渲染；多次并行调用也不会被合并成一个巨大的占位。
 */
import { useEffect, useMemo, useState } from 'react'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import { callName, isRunning, resultText } from '../tool-summary/tool-stats.ts'
import { findSpillLocator, parseGeneratedImageText } from './parse'
import type { GeneratedImageEntry } from './parse'
import { parseImageRequest } from './layout'

/** 一次 generate_image 调用在界面上的完整状态。 */
export interface GeneratedImageCall {
  readonly callId: string
  readonly running: boolean
  /** 结果已在、正在从 spill 读回（图片马上到）。 */
  readonly loading: boolean
  readonly error: string | null
  readonly prompt: string | null
  readonly startedAt: number | null
  readonly model: string | null
  readonly urls: readonly string[]
  /** 本次调用声明的生成张数（n，默认 1，夹在 1–4）。 */
  readonly count: number
  /** 本次调用声明的图片宽高比（size / aspect_ratio；默认 1）。 */
  readonly ratio: number
}

export interface GeneratedImagesState {
  readonly urls: readonly string[]
  readonly model: string | null
  /** 是否还有 generate_image 调用正在执行（含 PTC 子调用）。 */
  readonly running: boolean
  /** 最近一次 generate_image 的提示词原文（未截断；展示层自己收口）。 */
  readonly prompt: string | null
  /** 最近一次 generate_image 的发起时间（ms）；没有调用时 null。 */
  readonly startedAt: number | null
  /** 有 spill 结果正在异步读回（图片马上到）。 */
  readonly loading: boolean
  /** 最近一次 generate_image 失败且没有可显示图片时的错误文案。 */
  readonly error: string | null
  /** 按调用分组的明细（实时卡用；总结卡仍只消费上面的聚合字段）。 */
  readonly calls: readonly GeneratedImageCall[]
}

const EMPTY: GeneratedImagesState = {
  urls: [],
  model: null,
  running: false,
  prompt: null,
  startedAt: null,
  loading: false,
  error: null,
  calls: [],
}

/** 只有图片载荷需要按 callId 缓存；运行态每次从工具节点现算。 */
interface ImagePayload {
  readonly urls: readonly string[]
  readonly model: string | null
}

const EMPTY_PAYLOAD: ImagePayload = { urls: [], model: null }

/** 内联结果缓存：按 tool-call 块对象（引用稳定，跨渲染复用）。 */
const inlineCache = new WeakMap<ToolCallBlock, readonly GeneratedImageEntry[]>()

/** spill 结果缓存：按 callId（含失败占位，避免反复请求）。 */
const spillCache = new Map<string, ImagePayload>()
const spillPending = new Map<string, Promise<void>>()

/** 递归收集一个工具树的全部调用（root + subCalls），生图可能出现在子调用。 */
function collectBlocks(root: ToolCallBlock): ToolCallBlock[] {
  const out = [root]
  for (const child of root.subCalls) out.push(...collectBlocks(child))
  return out
}

/** 解析一个调用的内联结果（缓存）。 */
function inlineOf(block: ToolCallBlock): readonly GeneratedImageEntry[] {
  const hit = inlineCache.get(block)
  if (hit !== undefined) return hit
  const entries = parseGeneratedImageText(resultText(block))
  inlineCache.set(block, entries)
  return entries
}

/** 取一次调用的原始入参文本（运行中摊平在自身，定型后在 call 包装里）。 */
function argsRawOf(block: ToolCallBlock): string {
  try {
    return 'kind' in block ? (block.call?.argsRaw ?? '') : block.argsRaw
  } catch {
    return ''
  }
}

/** 从 generate_image 入参里取 prompt（流式半截 JSON 容错）。 */
function promptOf(block: ToolCallBlock): string | null {
  const raw = argsRawOf(block)
  if (typeof raw !== 'string' || raw.trim() === '') return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null) {
      const prompt = (parsed as { prompt?: unknown }).prompt
      if (typeof prompt === 'string' && prompt.trim() !== '') return prompt.trim()
    }
  } catch {
    /* JSON 还没写完（流式），这一拍拿不到提示词 */
  }
  return null
}

/** 定型调用失败时尽量取一句人话错误；取不到就返回通用文案。 */
function errorOf(block: ToolCallBlock): string | null {
  if (isRunning(block)) return null
  try {
    const parsed: unknown = JSON.parse(resultText(block))
    if (typeof parsed === 'object' && parsed !== null && (parsed as { ok?: unknown }).ok === false) {
      const message = (parsed as { error?: unknown }).error
      if (typeof message === 'string' && message.trim() !== '') return message.trim()
    }
  } catch {
    /* 非 JSON 结果继续按下面的 isError 判 */
  }
  return block.isError ? '图片生成失败' : null
}

/** 通过 host 路由读 spill 文件，取回图片 URL（去重、缓存、失败占位）。 */
async function loadSpill(callId: string, locator: string): Promise<ImagePayload> {
  const hit = spillCache.get(callId)
  if (hit !== undefined) return hit
  const running = spillPending.get(callId)
  if (running !== undefined) {
    await running
    return spillCache.get(callId) ?? EMPTY_PAYLOAD
  }
  const pending = (async (): Promise<void> => {
    let payload: ImagePayload = EMPTY_PAYLOAD
    let cacheable = true
    try {
      // 超时必须给：host 路由卡住时不能让实时卡永远停在「正在读取图片」。
      const timeout = (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout
      const signal = typeof timeout === 'function' ? timeout.call(AbortSignal, 15_000) : undefined
      const response = await fetch(
        `/api/chat-flow/generated-images?file=${encodeURIComponent(locator)}`,
        signal === undefined ? undefined : { signal },
      )
      const data: unknown = response.ok ? await response.json() : null
      cacheable = response.ok
      if (typeof data === 'object' && data !== null) {
        const record = data as { urls?: unknown; model?: unknown }
        const urls = Array.isArray(record.urls)
          ? record.urls.filter((url): url is string => typeof url === 'string' && url !== '')
          : []
        payload = {
          urls,
          model: typeof record.model === 'string' && record.model !== '' ? record.model : null,
        }
      }
    } catch {
      payload = EMPTY_PAYLOAD
      cacheable = false
    }
    // 失败不写缓存：一次临时网络 / 路由故障若被永久记成「没有图」，实时卡与
    // 总结卡都再也拿不到；不缓存则下次扫描或重挂时可以重试。
    if (cacheable) spillCache.set(callId, payload)
  })()
  spillPending.set(callId, pending)
  await pending
  spillPending.delete(callId)
  return spillCache.get(callId) ?? EMPTY_PAYLOAD
}

/** 合并多张来源的图片载荷（去重、保留首个非空 model）。 */
function mergePayloads(payloads: readonly ImagePayload[]): ImagePayload {
  const urls: string[] = []
  let model: string | null = null
  for (const payload of payloads) {
    for (const url of payload.urls) if (!urls.includes(url)) urls.push(url)
    if (model === null && payload.model !== null) model = payload.model
  }
  return { urls, model }
}

/** 一次扫描出来的单调用明细（未含 spill 异步结果）。 */
interface CallScan {
  readonly callId: string
  readonly running: boolean
  readonly prompt: string | null
  readonly startedAt: number | null
  readonly error: string | null
  readonly count: number
  readonly ratio: number
  readonly inline: readonly GeneratedImageEntry[]
  readonly locator?: string
}

/**
 * 订阅本回合 generate_image 的结果图片（内联 + spill 异步），
 * toolNodes 变化时重新扫描；spill 到达后触发一次更新。
 */
export function useGeneratedImages(toolNodes: readonly unknown[]): GeneratedImagesState {
  const scan = useMemo(() => {
    const calls: CallScan[] = []
    for (const tool of toolNodes) {
      const root = (tool as { data?: { root?: ToolCallBlock } }).data?.root
      if (root === undefined) continue
      for (const block of collectBlocks(root)) {
        if (callName(block) !== 'generate_image') continue
        const callRunning = isRunning(block)
        const request = parseImageRequest(argsRawOf(block))
        const entries = callRunning || ('kind' in block && block.isError) ? [] : inlineOf(block)
        const locator = entries.length === 0 && !callRunning && !('kind' in block && block.isError)
          ? findSpillLocator(resultText(block))
          : undefined
        calls.push({
          callId: block.callId,
          running: callRunning,
          prompt: promptOf(block),
          startedAt: callRunning ? block.time : (block.callTime ?? block.time),
          error: errorOf(block),
          count: request.count,
          ratio: request.ratio,
          inline: entries,
          ...(locator === undefined ? {} : { locator }),
        })
      }
    }
    return {
      calls,
      key: calls.map(call => `${call.callId}:${call.locator ?? ''}`).join('|'),
    }
  }, [toolNodes])

  const [spillByCall, setSpillByCall] = useState<Record<string, ImagePayload>>({})
  const [loadingCalls, setLoadingCalls] = useState<readonly string[]>([])

  useEffect(() => {
    const locators = scan.calls.flatMap(call => call.locator === undefined
      ? []
      : [{ callId: call.callId, locator: call.locator }])
    if (locators.length === 0) {
      setSpillByCall({})
      setLoadingCalls([])
      return undefined
    }
    const cached: Record<string, ImagePayload> = {}
    const miss: { callId: string; locator: string }[] = []
    for (const item of locators) {
      const hit = spillCache.get(item.callId)
      if (hit !== undefined) cached[item.callId] = hit
      else miss.push(item)
    }
    setSpillByCall(cached)
    setLoadingCalls(miss.map(item => item.callId))
    if (miss.length === 0) return undefined
    let cancelled = false
    void (async (): Promise<void> => {
      const loaded = await Promise.all(miss.map(item => loadSpill(item.callId, item.locator)))
      if (cancelled) return
      const next = { ...cached }
      miss.forEach((item, index) => {
        next[item.callId] = loaded[index] ?? EMPTY_PAYLOAD
      })
      setSpillByCall(next)
      setLoadingCalls([])
    })()
    return () => { cancelled = true }
  }, [scan.key])

  return useMemo(() => {
    const calls: GeneratedImageCall[] = scan.calls.map(call => {
      const spill = spillByCall[call.callId]
      const urls = call.inline.length > 0
        ? call.inline.map(entry => entry.url)
        : (spill?.urls ?? [])
      return {
        callId: call.callId,
        running: call.running,
        loading: !call.running && call.locator !== undefined && loadingCalls.includes(call.callId),
        error: urls.length === 0 ? call.error : null,
        prompt: call.prompt,
        startedAt: call.startedAt,
        model: call.inline[0]?.model ?? spill?.model ?? null,
        urls,
        count: call.count,
        ratio: call.ratio,
      }
    })

    const payloads: ImagePayload[] = calls.map(call => ({ urls: call.urls, model: call.model }))
    const merged = mergePayloads(payloads)
    let prompt: string | null = null
    let startedAt: number | null = null
    let error: string | null = null
    for (const call of calls) {
      if (call.prompt !== null) prompt = call.prompt
      if (call.startedAt !== null) startedAt = call.startedAt
      if (error === null && call.error !== null) error = call.error
    }
    return {
      urls: merged.urls,
      model: merged.model,
      running: calls.some(call => call.running),
      prompt,
      startedAt,
      loading: calls.some(call => call.loading),
      error: merged.urls.length === 0 ? error : null,
      calls,
    }
  }, [scan, spillByCall, loadingCalls])
}
