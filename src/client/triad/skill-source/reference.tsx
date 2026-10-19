/**
 * 技能引用着色(自内核 ui-skill 的 SkillReference + skillReferenceRule 转写)。
 *
 * ── 为什么需要这个模块 ────────────────────────────────────────────────
 *
 * 内核 `@deepseek-ai/dsh-client-ui-skill` 在 web profile 里被整块禁用
 * (cordis.patch.yml 的 `id: ui-skill disabled: true`),因为技能 slash 菜单由
 * 本插件接管。但那个包除了菜单,**还负责两件事**:
 *
 *  1. `uiConversation.userText.register(skillReferenceRule)` —— 把用户消息里
 *     的 `/skill-name` token 识别成一个业务节点;
 *  2. `conversation.user.text.node` key='skill' 的渲染组件 —— 把那个节点画成
 *     带图标的彩色 chip。
 *
 * 两件事一起被禁用后,发出的消息里 `/ego-browser 查看X平台今日ego相关的内容`
 * 就退化成纯文本,**指令没有颜色了**(用户 2026-10-19 反馈)。
 *
 * 所以这里把这两块补回来。逻辑与内核逐条对齐(匹配正则、order、节点 id),
 * 唯一区别是样式走官方 `ReferenceChip`,不自己造视觉。
 *
 * ── 依赖的事实 ────────────────────────────────────────────────────────
 *
 * `skillNames` 这个 UserText Facts **不是**本模块提供的:它由 ui-chat 的
 * SkillNameProjector 从宿主 `skill-invocation` 注入推导出来,挂在消息节点的
 * `data.skillNames` 上,渲染气泡时并进 facts。所以只要宿主还在注入技能正文,
 * 这里就能拿到名单——与 ui-skill 是否启用无关。
 */

import type { ReactNode } from 'react'
import { ReferenceChip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UserTextNode, UserTextRule, UserTextTransformContext } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { Context as ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * 声明本插件往 UserText 词汇表里加的条目。
 *
 * 与内核 ui-skill 的声明**完全一致**(同样的 id `skill`、同样的 fact 名
 * `skillNames`):类型层是纯声明、不产生运行期代码,两边同时存在也不冲突。
 */
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface UserTextDataMap {
    /** A skill name confirmed for this message, without the leading slash. */
    skill: {
      readonly name: string
    }
  }
  interface UserTextFacts {
    /** Resolved skill names; absence supplies no skill references. */
    readonly skillNames: readonly string[]
  }
}

/** 渲染组件拿到的 props(keyed 槽位:node + 原文 + 交互开关)。 */
interface SkillReferenceProps {
  readonly node: UserTextNode<'skill'>
  readonly raw: string
  readonly interactive: boolean
}

/**
 * 画一个技能 chip。
 *
 * 三个容易踩的点(都按官方实现对齐,别"顺手优化"):
 *  · `invalid` 是**必填**的:漏传会让 `clsx(css.chip, undefined && …)` 那样
 *    丢掉无效态判断,现在传 `false`(技能名一定来自本步真实注入,不存在失效)。
 *  · `appearance` 传 `'skill'` 是**故意的**:`ReferenceIconKind` 只有
 *    session/file/folder,`ReferenceIcon` 对未知 kind 返回 undefined ——
 *    结果就是「只有 chip 底色 + 文字、没有图标」,这正是内核 ui-skill 的视觉。
 *    改成 `undefined` 反而会渲染出一个 '@' 标记(session 引用专用)。
 *  · 不接 `onActivate`:点开技能文件需要 sidebarRight + 技能目录(另一个模块
 *    的职责)。传了却打不开,比不可点更糟。
 *
 * @param props - 业务节点、原文、交互开关。
 * @returns 带 chip 外观的技能引用。
 */
function SkillReference({ node }: SkillReferenceProps): ReactNode {
  return (
    <ReferenceChip
      appearance={'skill' as never}
      label={`/${node.data.name}`}
      invalid={false}
    />
  )
}

/**
 * 把用户消息里的 `/skill-name` 认成一个节点。
 *
 * 与内核逐字一致的三处纪律:
 *  · 正则 `(?<!\S)\/([\w-]+)(?!\S)` —— 前后都必须是空白/边界,所以
 *    `http://a/b` 里的斜杠、`/iu做个钢琴`(中文紧贴)都不会被误认成技能引用;
 *  · `order: 20` —— 与内核同值,和 session 引用等其它规则的自然顺序一致;
 *  · **只有当 token 真的在 skillNames 名单里**才认 —— 名单来自本步实际加载的
 *    技能注入,不经确认的 `/随便什么` 保持普通文本。
 */
export const skillReferenceRule: UserTextRule<'skill'> = {
  id: 'skill',
  order: 20,
  match(text: string, from: number, context: UserTextTransformContext) {
    const tokens = /(?<!\S)\/([\w-]+)(?!\S)/gu
    tokens.lastIndex = from
    let names: readonly string[] | undefined
    for (let token = tokens.exec(text); token !== null; token = tokens.exec(text)) {
      if (names === undefined) {
        names = context.read('skillNames')
        if (names === undefined || names.length === 0) return undefined
      }
      const name = token[1]!
      if (names.includes(name)) {
        return { id: 'skill', start: token.index, end: token.index + token[0].length, data: { name } }
      }
    }
    return undefined
  },
}

/**
 * 本模块依赖的 client 服务。
 *
 * `uiConversation` **必须走 ctx.inject 延迟注入**,不能 `ctx.get()` 读一次:
 * 实测(2026-10-19)本模块与 ui-conversation 的装配顺序没保证,直接 get 会
 * 拿到 undefined —— 日志只有一行 warn,颜色悄悄没了,查起来极费劲。
 * 延迟注入会在服务出现后才跑回调,顺序问题自动消失。
 */
const REFERENCE_SERVICES = ['uiConversation'] as const

/** uiConversation 服务里本模块用到的唯一能力。 */
interface UserTextRegistryFace {
  register(rule: UserTextRule): () => void
}

/**
 * 注册技能引用的匹配规则与渲染座位。
 *
 * @param ctx - client root context。
 */
export function applySkillReference(ctx: ClientContext): void {
  ;(ctx as unknown as { inject(names: readonly string[], fn: (scope: ClientContext) => void): void })
    .inject(REFERENCE_SERVICES, (scope: ClientContext) => {
      const uiConversation = (scope as unknown as { get?(name: string): unknown }).get?.('uiConversation') as
        | { userText?: UserTextRegistryFace }
        | undefined
      const userText = uiConversation?.userText

      if (userText?.register === undefined) {
        console.warn('[skill-reference] uiConversation.userText 不可用,技能引用着色未注册')
        return
      }

      /*
       * 规则注册**允许失败**:内核 ui-skill 若哪天重新启用,同 id 的规则会抛
       * `user-text rule "skill" is already registered`。那种情况下内核的实现
       * 已经在岗,本模块静默退让即可,不该拖垮整个插件。
       */
      scope.effect(() => {
        try {
          return userText.register(skillReferenceRule)
        } catch (error) {
          console.warn('[skill-reference] 技能引用规则注册失败(内核 ui-skill 可能已启用):', error)
          return () => {}
        }
      }, 'skill-reference: user-text rule')

      /*
       * 座位注册：`slots.inject` 自己就吃一个 effect（它内部对声明生命周期做
       * 重放），返回的是「取消等待 + 卸载活跃贡献」的幂等 disposer。所以
       * **不要**再套一层 `ctx.effect`：嵌套 effect 里的 disposer 语义会被
       * 重放打乱，而 inject 已经把生命周期绑到调用方 fiber 上了。
       */
      try {
        scope.slots.inject('conversation.user.text.node', () => scope.slots.register(
          { name: 'conversation.user.text.node', key: 'skill', priority: 100 },
          SkillReference as never,
        ))
      } catch (error) {
        console.warn('[skill-reference] 技能 chip 座位注册失败(内核 ui-skill 可能已启用):', error)
      }
    })
}

/** 服务依赖清单(供冒烟断言,值为契约常量)。 */
export const SKILL_REFERENCE_SERVICES = REFERENCE_SERVICES
