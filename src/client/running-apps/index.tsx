/**
 * dsh-chat-plus — 「@ 运行中的程序」图标组件 + 触发源装配。
 *
 * ## 怎么接进官方管线
 *
 * 官方 ui-input-trigger 的 @ 触发源契约允许每个源给候选配一个 React 图标组件
 * （`InputTriggerCandidate.icon` 接受 `ComponentType<IconProps>`）。菜单会把
 * 它渲染进 14px 的图标位。于是：
 *
 *  · **候选列表、键盘上下、回车、点选、hover 高亮**全部沿用官方实现，
 *    我们不重写菜单（重写就是抄官方一份，官方改版就跟着坏）；
 *  · 只把「图标」这一个座位换成真实进程图标（PNG data URL），外观由
 *    styles.ts 接管。
 *
 * ## 为什么 order 排在最前
 *
 * 官方的文件/会话源 order 是 0（默认）。程序候选是「此刻开着的窗口」，
 * 用户打 @ 时最想找的通常就是它（他刚刚还在看那个窗口）；文件与会话
 * 排在后面仍然可达，只是要多打几个字过滤。所以这里给 order -10。
 *
 * ## 为什么 query 为空时也出候选
 *
 * 打 @ 的瞬间，用户心里想的就是「把那个东西弄进来」，此刻**最该看到的是
 * 现在开着什么**，而不是一堆历史文件。所以空查询直接列前 N 个窗口
 * （前台窗口排第一），带查询再按匹配度过滤。
 *
 * @module
 */

import type { ComponentType } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only：拉入 inputTriggers 服务声明与 InputTriggerSource 契约。
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {
  InputTriggerSource, InputTriggerServiceContract, InputTriggerCandidate,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import {
  appLabel,
  appRef,
  appSubtitle,
  fetchRunningApps,
  rankApps,
  RUNNING_APPS_SOURCE,
  serializeAppRef,
  type RunningAppWindow,
} from './data.ts'
import { injectRunningAppsStyles } from './styles.ts'

/** 菜单里这一组的标题（官方菜单对未登记的 source 名会原样显示，这里给中文）。 */
const SECTION_TITLE = '运行中的程序'

/** 官方菜单传进图标组件的 props（只用到 size）。 */
interface IconPropsLike {
  size?: number
}

/**
 * 候选行的图标：真实进程图标。
 *
 * 官方菜单的图标位是 14x14 的 inline-flex，直接塞 img 会溢出，
 * 所以外面套一层带 data 属性的 span，尺寸与圆角交给样式表。
 *
 * 取不到图标（权限受限 / 无 exe）时退化成首字母色块 —— **不能留空**：
 * 空图标位会让这一行比别的行短一截，看起来像渲染坏了。
 */
function renderAppIcon(url: string | null, letter: string, size: number | undefined): JSX.Element {
  const dimension = typeof size === 'number' && size > 0 ? size : 14
  if (url === null) {
    return (
      <span data-dsh-ra-icon data-dsh-ra-fallback aria-hidden="true">{letter}</span>
    )
  }
  return (
    <span data-dsh-ra-icon aria-hidden="true">
      <img src={url} alt="" width={dimension} height={dimension} draggable={false} />
    </span>
  )
}

/**
 * 图标组件缓存：pid + 标题 → 组件。
 *
 * ⚠ 这条缓存是**必须**的，不是优化。candidates() 在打字过程中每敲一个键就被
 * 调一次，每次都返回一批新对象。如果每次现造一个新的函数组件，React 会认为
 * 元素类型变了，把整行卸载重挂——图标入场动画于是每键重播一次，看起来就是
 * 「图标一直在闪」。同一窗口复用同一个组件引用，React 就只做 props diff。
 *
 * 缓存按 pid + 标题做键（与引用 id 同一口径）；窗口关了再开同名窗口会拿到
 * 同一个组件，图标内容也跟着更新（见下方 __url 覆盖）。
 */
const iconCache = new Map<string, ComponentType<IconPropsLike>>()

/** 为一条候选取（或建）一个图标组件。 */
function makeIconComponent(app: RunningAppWindow): ComponentType<IconPropsLike> {
  const letter = (app.process || app.title || '?').trim().charAt(0).toUpperCase() || '?'
  const url = app.icon
  const key = app.pid + '\u0001' + app.title + '\u0001' + (url === null ? '' : url.length.toString())
  const cached = iconCache.get(key)
  if (cached !== undefined) return cached
  const component = (props: IconPropsLike) => renderAppIcon(url, letter, props.size)
  // 缓存上限：窗口数量级是几十，但用户可能开开关关一整天。超了清空重建，
  // 代价只是一次重挂（而且那时列表早就变了）。
  if (iconCache.size > 256) iconCache.clear()
  iconCache.set(key, component)
  return component
}

/** 把一条窗口投影成菜单候选。 */
function toCandidate(app: RunningAppWindow): InputTriggerCandidate {
  const subtitle = appSubtitle(app)
  return {
    name: appLabel(app, 48),
    ...(subtitle === '' ? {} : { description: subtitle }),
    icon: makeIconComponent(app),
    section: SECTION_TITLE,
    value: appRef(app),
  }
}

/**
 * 注册 @ 源。
 *
 * 数据缓存：`cached` 与 `cachedAt` 是模块级闭包变量 —— 菜单在打字过程中会
 * 反复调用 candidates（每个键一次），每次都打一次路由就等于每敲一个字发一次
 * 请求。缓存 2 秒，且**请求进行中不重复发起**（inFlight 复用同一个 Promise）。
 */
export function applyRunningAppsSource(ctx: ClientContext): void {
  injectRunningAppsStyles()

  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract | undefined
  if (inputTriggers === undefined) {
    console.warn('[running-apps] inputTriggers 服务不可用，@ 程序源未注册')
    return
  }

  let cached: RunningAppWindow[] | null = null
  let cachedAt = 0
  let inFlight: Promise<RunningAppWindow[] | null> | null = null
  /**
   * 客户端缓存时长。
   *
   * 30 秒而不是 2 秒，理由是**高亮归属**：官方菜单把高亮落在第一个 settle
   * 完成的源上（menuReduce 的 firstHighlight）。程序源若能**同步**返回
   * （microtask 级），就一定排在异步的文件/会话源之前；一旦缓存过期要走网络，
   * 高亮就会被文件源抢走——实测表现为「打 @ 后回车选中了一个文件夹」。
   *
   * 数据新鲜度不靠这个值：host 侧有自己的 3s TTL，每次请求都会现采（或命中
   * 它自己的短缓存）。这里 30s 只决定「要不要发这次 HTTP」。
   */
  const CACHE_MS = 30_000

  /** 后台刷新（不阻塞调用方）。 */
  function refreshInBackground(): void {
    if (inFlight !== null) return
    inFlight = fetchRunningApps().then((list) => {
      if (list !== null) {
        cached = list
        cachedAt = Date.now()
      }
      return list
    }).catch(() => null).finally(() => { inFlight = null })
  }

  /**
   * 取窗口列表。
   *
   * 策略：**有缓存立刻返回缓存**（同步返回，microtask 级 settle），同时后台
   * 刷新。只有完全没有缓存时才等网络——那时也只能等。
   */
  async function load(signal: AbortSignal): Promise<RunningAppWindow[]> {
    if (cached !== null) {
      // 缓存超过 CACHE_MS 就在后台刷一份新的，但不阻塞本次返回。
      if (Date.now() - cachedAt >= CACHE_MS) refreshInBackground()
      return cached
    }
    if (inFlight === null) {
      inFlight = fetchRunningApps().finally(() => { inFlight = null })
    }
    const list = await inFlight
    if (signal.aborted) return cached ?? []
    if (list === null) return cached ?? []
    cached = list
    cachedAt = Date.now()
    return list
  }

  const source: InputTriggerSource = {
    trigger: '@',
    name: RUNNING_APPS_SOURCE,
    // 排在官方文件/会话源（order 0）之前：打 @ 时最想找的是此刻开着的东西。
    order: -10,
    /*
     * 会话作用域出生时预热一次。
     *
     * 为什么必须预热：官方菜单的高亮落在**第一个 settle 完成的源**上。程序源
     * 首次要等 host 冷启动（600~700ms），而官方的文件源是本地的、毫秒级返回——
     * 不预热的话，用户打 @ 后高亮会先落在某个文件夹上，按回车选中文件夹而不是
     * 他刚看的那个窗口。预热让程序源也变成毫秒级，高亮自然落在第一条。
     */
    warm() {
      void load(new AbortController().signal)
    },
    async candidates(_session, req) {
      if (req.signal.aborted) return []
      const apps = await load(req.signal)
      if (req.signal.aborted || apps.length === 0) return []
      return rankApps(apps, req.query, 8).map(toCandidate)
    },
    onPick(pick) {
      // 落成引用芯片：草稿里显示 @app:<标题>，模型收到的是结构化描述
      // （serializeAppRef 在 codec.serialize 里执行）。
      return {
        insert: {
          source: RUNNING_APPS_SOURCE,
          ref: pick.candidate.value ?? '',
          label: pick.candidate.name,
          clipboardText: '@app:' + pick.candidate.name,
        },
      }
    },
    codec: {
      clipboardText: (ref: string) => '@app:' + (ref.split(':').slice(1).join(':') || ref),
      serialize: async (ref: string) => {
        const apps = cached ?? (await fetchRunningApps()) ?? []
        return serializeAppRef(ref, apps)
      },
    },
  }

  // 插件装配完就预热一次：不等 session scope 建立，先把数据与图标拿回来。
  // 失败无所谓（采集器不可用时只是候选为空，官方文件/会话候选照常）。
  void load(new AbortController().signal)

  ctx.effect(() => {
    let unregister: (() => void) | undefined
    try {
      unregister = inputTriggers.registerSource(source)
    } catch (error) {
      // 同名源已被别的插件占用时只降级，不影响其它候选。
      console.warn('[running-apps] @ 源注册失败：', error)
    }
    return () => { if (unregister !== undefined) unregister() }
  }, 'running-apps: @ source')
}

export const __test = { toCandidate, makeIconComponent, renderAppIcon, SECTION_TITLE }
