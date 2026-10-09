/**
 * dsh-chat-plus — iu kind 注册表（**纯逻辑半边**，host 与 client 均可 import）。
 *
 * 老结构里加一个 kind 要改四处：parse.ts（校验）、IuCard.tsx（渲染）、
 * shot/card.ts（截图静态镜像）、inject.ts（注入文档）。四处只要漏一处就出
 * 「静默降级」类 bug——真实事故：钢琴卡在截图里被标成「对比」，因为截图侧
 * 用三元链取角标、新 kind 掉进兜底。
 *
 * 现在收敛成一处：每个 kind 自带 label / parse / snapshot / css / doc /
 * fillText，这里只列**注册顺序**。四个消费方全部读本表：
 *   · 对话流 → parse.ts 的 asSpec 遍历本表 + bodies.ts 取 React 体；
 *   · 截图   → shot/card.ts 遍历本表取 label / snapshot / css；
 *   · 注入   → inject.ts 遍历本表取 doc；
 *   · 冒烟   → 断言本表与 bodies.ts 的 kind 集合完全一致。
 *
 * ⚠ 本文件**不得 import React 或任何 .tsx**：它在 host 半身的依赖链上
 * （shot/card.ts → 这里）。React 体一律走 bodies.ts（client 专用）。
 */

import type { IuKind, IuSpecBase, IuState } from './contract.ts'
import { sliderKind } from './slider.ts'
import { chartKind } from './chart.ts'
import { checklistKind } from './checklist.ts'
import { tabsKind } from './tabs.ts'
import { pianoKind } from './piano.ts'
import { tableKind } from './table.ts'
import { kanbanKind } from './kanban.ts'
import { formKind } from './form.ts'
import { diffKind } from './diff.ts'
import { timelineKind } from './timeline.ts'
import { treeKind } from './tree.ts'
import { gaugeKind } from './gauge.ts'
import { quizKind } from './quiz.ts'

/**
 * 已注册的全部 kind（顺序即注入文档里的出现顺序）。
 *
 * 排在前面的是高频 kind：模型看到文档时先看到最常用的，选择更准。
 *
 * 类型上是**异构集合**：每个 kind 各自带精确的 `<State, Spec>` 泛型（kind 文件
 * 内部享受完整类型检查），收进数组后统一擦除成 AnyKind。擦除是安全的——运行期
 * parse 产出的 spec 只会流回同一个 kind 的 initState / fillText / snapshot，
 * 不会跨 kind 串门（路由按 spec.kind 查表，见 parseIuSpec）。
 */
export const IU_KINDS = [
  sliderKind,
  chartKind,
  tableKind,
  checklistKind,
  tabsKind,
  kanbanKind,
  formKind,
  timelineKind,
  diffKind,
  treeKind,
  gaugeKind,
  quizKind,
  pianoKind,
] as const

/** 擦除泛型后的 kind 模块类型（注册表与四个消费方共用）。 */
export type AnyKind = IuKind<IuState, IuSpecBase>

/** kind 名 → 纯逻辑模块。 */
export const IU_KIND_MAP: ReadonlyMap<string, AnyKind> = new Map(
  IU_KINDS.map((k) => [k.kind, k as unknown as AnyKind]),
)

/** 全部 kind 名（注入文档与冒烟断言共用）。 */
export const IU_KIND_NAMES: readonly string[] = IU_KINDS.map(k => k.kind)

/** kind 名 → 角标文案（老 IU_KIND_LABELS 的等价物，两处渲染共用）。 */
export const IU_KIND_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  IU_KINDS.map(k => [k.kind, k.label]),
)

/** 全部 kind 的专属 CSS 拼接（基座 IU_CSS 之后注入）。 */
export function iuKindsCss(): string {
  return IU_KINDS.map(k => k.css).filter(c => c !== '').join('\n')
}

/** 全部 kind 的注入文档行（inject.ts 直接消费，不再手写示例）。 */
export function iuKindsDoc(): string {
  return IU_KINDS.map(k => k.doc).join('\n')
}

/**
 * 解析任意围栏 JSON：按 kind 字段路由到对应模块，不合格一律返回 undefined。
 *
 * 未注册的 kind → undefined（整条围栏回退成代码块，与老实现一致）。
 */
export function parseIuSpec(raw: unknown): IuSpecBase | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const obj = raw as Record<string, unknown>
  const kind = typeof obj.kind === 'string' ? obj.kind : ''
  const mod = IU_KIND_MAP.get(kind)
  if (mod === undefined) return undefined
  return mod.parse(obj) as IuSpecBase | undefined
}

/** 按 kind 取纯逻辑模块（截图与状态层用）。 */
export function iuKindOf(kind: string): IuKind<IuState, IuSpecBase> | undefined {
  return IU_KIND_MAP.get(kind)
}
