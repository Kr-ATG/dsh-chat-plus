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
 * ## 数据新鲜度：每次候选请求都真发，不做客户端缓存
 *
 * 用户实测反馈过「@ 的时候不是实时获取的」——当时为了抢菜单高亮，客户端
 * 缓存了 30 秒。现在改成每次 candidates 都真发一次请求：
 *
 *  · host 侧是常驻 PowerShell 子进程，一次真采集 **2~4ms**（实测，图标与
 *    Get-Process 都有进程内缓存），比一次 HTTP 往返还便宜；
 *  · 所以「关掉一个程序 → 立刻打 @」看到的必然是关掉之后的状态。
 *
 * 只保留两层不算缓存的机制：
 *  1. **并发去重**（inFlight）：同一时刻只允许一个请求在飞，后来的等它。
 *     等的也是「最新那一次」，不是旧值；
 *  2. **失败兜底**（lastKnown）：请求失败（host 没挂 / 网络断）时用上一次
 *     成功的结果，避免菜单突然整组消失。
 *
 * ## 高亮归属（为什么 order 之外还要预热）
 *
 * 官方菜单把高亮落在**第一个 settle 完成的源**上（menuReduce 的 firstHighlight）。
 * 程序源要走一次本地 HTTP（几毫秒），官方的文件源是本地的（也几毫秒）——
 * 两者本来就接近，谁先 settle 取决于当次负载。预热的意义是让程序源首次
 * 也走「已完成的请求」路径，把差距压到最小；万一真被文件源抢先，用户仍能
 * 用上下键选到程序（组在菜单最上面，第一下 ↑ 就是最后一条文件）。
 */
export function applyRunningAppsSource(ctx: ClientContext): void {
  injectRunningAppsStyles()

  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract | undefined
  if (inputTriggers === undefined) {
    console.warn('[running-apps] inputTriggers 服务不可用，@ 程序源未注册')
    return
  }

  /** 上一次成功拿到的窗口列表（只用于请求失败时兜底，不参与正常路径）。 */
  let lastKnown: RunningAppWindow[] | null = null
  /** 正在飞的请求（并发去重：等的是最新那一次，不是缓存）。 */
  let inFlight: Promise<RunningAppWindow[] | null> | null = null

  /**
   * 取窗口列表（每次都是真请求）。
   *
   * @param signal - 候选请求的 abort 信号；已中止时立刻返回，不再发新请求。
   */
  async function load(signal: AbortSignal): Promise<RunningAppWindow[]> {
    if (signal.aborted) return lastKnown ?? []
    if (inFlight === null) {
      inFlight = fetchRunningApps().finally(() => { inFlight = null })
    }
    const list = await inFlight
    if (list !== null) lastKnown = list
    return list ?? lastKnown ?? []
  }

  const source: InputTriggerSource = {
    trigger: '@',
    name: RUNNING_APPS_SOURCE,
    // 排在官方文件/会话源（order 0）之前：打 @ 时最想找的是此刻开着的东西。
    order: -10,
    /*
     * 会话作用域出生时预热一次：把 host 侧的采集器拉起来（冷启动 600~700ms），
     * 之后每次候选请求就都是 2~4ms 的真采集，不必等冷启动。
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

  // 插件装配完就预热一次：把 host 侧的常驻采集器拉起来（冷启动 600~700ms），
  // 这样用户第一次打 @ 时就是 2~4ms 的真采集。失败无所谓（采集器不可用时
  // 只是候选为空，官方文件/会话候选照常）。
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
