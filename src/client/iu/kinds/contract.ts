/**
 * dsh-chat-plus — iu kind 模块的契约（纯逻辑半边）。
 *
 * ## 为什么 kind 要拆成「两个文件、两份注册表」
 *
 * 一张卡片有四个消费方，各自能看到的东西不一样：
 *
 *   | 消费方 | 位置 | 能用 React？ |
 *   | --- | --- | --- |
 *   | 对话流渲染 IuCard | client 半身 | 能 |
 *   | 截图静态快照 src/shot/card.ts | **host 半身** | **不能** |
 *   | 能力规范注入 triad/memory/engine/inject.ts | host 半身 | 不能 |
 *   | 冒烟断言 scripts/smoke-client.mjs | 源码文本 | — |
 *
 * host 半身一旦 import 到 React，产物就会内联第二份 React（体积爆炸，且
 * build.mjs 的 assertHostExternals 会当场失败）。所以每个 kind 必须拆两半：
 *
 *   · `kinds/<kind>.ts`      —— **纯逻辑**：label / parse / snapshot / css / doc /
 *                               fillText / initState。零 React、零 DOM，
 *                               host 与 client 都能 import，通过 registerKind 自注册。
 *   · `kinds/<kind>.body.tsx`—— **React 体**：只被 `kinds/bodies.ts` 收拢，
 *                               只有 client 半身的 IuCard 会碰到它。
 *
 * 于是注册表也是两份：`kinds/registry.ts`（纯逻辑，host 可用）与
 * `kinds/bodies.ts`（React，client 专用）。**新增一个 kind 只动这两个聚合文件
 * 各一行 + 自己那两个新文件**，不需要再改 shot/card.ts、inject.ts、IuCard.tsx
 * 或 parse.ts —— 那正是老结构「一个 kind 改四处」的债。
 *
 * ## 为什么 snapshot 返回 HTML 字符串而不是组件
 *
 * 截图页在无头 Chrome 里打开，没有 React 运行时，只能拼静态 HTML。让它和
 * 对话流「长得一样」的唯一办法是**共用同一份 CSS**（`css` 字段）＋**共用同一套
 * class 名**。因此 snapshot 必须严格按 Body 的 DOM 结构拼：class 对齐、层级对齐。
 *
 * 这条纪律是有血的教训的：钢琴卡早先在截图侧省掉了 `.dtt-iu__pwhite` /
 * `.dtt-iu__pblack` 两层容器，白键的百分比定位全落回静态流，截图里的琴键变成
 * 一级级往下掉的阶梯（对话流里正常）。**共用样式表就必须共用结构。**
 */

/** 卡片本地状态的最小形状（各 kind 自己窄化；持久化层按 Record 存取）。 */
export type IuState = Record<string, unknown>

/** 解析后的 spec 的最小形状（各 kind 自己窄化）。 */
export type IuSpecBase = { readonly kind: string; readonly title: string }

/** Body 组件拿到的 setState：支持补丁对象或函数式补丁。 */
export type IuSetState<S> = (patch: Partial<S> | ((prev: S) => Partial<S>)) => void

/**
 * 纯逻辑半边的 kind 模块（host 与 client 均可 import）。
 *
 * ⚠ 本接口**不得引用 React 类型**（连 `import type` 都不要）：它在 host 半身
 * 的依赖链上。React 体契约见 bodies.ts 的 IuKindBody。
 */
export interface IuKind<S extends IuState = IuState, Spec extends IuSpecBase = IuSpecBase> {
  /** kind 标识（围栏 JSON 里的那个字符串）。 */
  readonly kind: string
  /** 卡片右上角的角标文案（对话流与截图共用）。 */
  readonly label: string
  /**
   * 解析并校验围栏 JSON。返回 undefined = 这张卡不合格，整条围栏回退成
   * 代码块（绝不抛错）。校验必须**钳位**而不是拒绝：模型写 `octave: 99` 时
   * 钳到 7 比整卡消失好。
   */
  readonly parse: (raw: Record<string, unknown>) => Spec | undefined
  /** 初始本地状态（刷新后由持久化层覆盖，见 state.ts）。 */
  readonly initState: (spec: Spec) => S
  /** 把当前状态拼成「填入输入框」的一句话（必须含真实数值，见 fillText 纪律）。 */
  readonly fillText: (spec: Spec, state: S) => string
  /**
   * 静态快照 HTML（截图管线用；无 JS、无交互，按初始状态定格）。
   *
   * **所有模型文本必须走 esc / escAttr**：截图页跑在 --disable-web-security
   * 的无头 Chrome 里，模型文本逃出标签上下文就等于任意脚本。
   */
  readonly snapshot: (spec: Spec) => string
  /** 本 kind 专属 CSS（与基座 IU_CSS 一起注入；截图页也内联同一份）。 */
  readonly css: string
  /**
   * 能力规范注入文档（一行示例 + 括号里的约束）。
   *
   * 为什么要 kind 自己带：注入文本写在 host 半身的 inject.ts 里，而 kind 的
   * 字段是这里定义的。分开写必然漂移——piano 的 `showNotes` 字段实现了但注入
   * 文档从没提过，模型永远不知道能用它。**文档跟着实现走，就不会漏。**
   */
  readonly doc: string
}
