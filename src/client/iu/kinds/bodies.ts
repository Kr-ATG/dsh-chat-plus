/**
 * dsh-chat-plus — iu kind 的 **React 半边**（client 专用聚合）。
 *
 * 与 registry.ts 的关系：registry.ts 是纯逻辑（host 可用），这里只收拢每个
 * kind 的 React Body 组件（只有 client 的 IuCard 会 import）。两份注册表的
 * kind 集合必须**完全一致**——冒烟里有一条断言专门钉它（漏一个就是「卡片能
 * 解析但渲染不出」或反之）。
 *
 * ## Body 的渲染契约（所有 kind 必须遵守）
 *
 * 外壳 IuCard 统一渲染 `<Head>`（标题 + 角标）与 `<FillRow>`（填入输入框），
 * **Body 只渲染中间那段正文**。这条约定让 `snapshot()`（纯逻辑侧）与 `Body`
 * （React 侧）的 DOM 范围严格对齐：两者都只描述「Head 之后、FillRow 之前」
 * 的那部分，class 与层级一一对应，截图就不会长歪。
 *
 * ⚠ 因此 Body 里**不要**再自己渲染 Head / FillRow，也不要包一层 `<div>` 外壳
 *   （外壳由 IuCard 提供）——直接返回正文片段即可。
 */

import type { ReactNode } from 'react'
import type { IuSetState, IuSpecBase, IuState } from './contract.ts'
import { SliderBody } from './slider.body.tsx'
import { ChartBody } from './chart.body.tsx'
import { ChecklistBody } from './checklist.body.tsx'
import { TabsBody } from './tabs.body.tsx'
import { PianoBody } from './piano.body.tsx'
import { TableBody } from './table.body.tsx'
import { KanbanBody } from './kanban.body.tsx'
import { FormBody } from './form.body.tsx'
import { DiffBody } from './diff.body.tsx'
import { TimelineBody } from './timeline.body.tsx'
import { TreeBody } from './tree.body.tsx'
import { GaugeBody } from './gauge.body.tsx'
import { QuizBody } from './quiz.body.tsx'

/** Body 组件的统一 props。 */
export interface IuBodyProps<S extends IuState, Spec extends IuSpecBase> {
  readonly spec: Spec
  readonly state: S
  readonly setState: IuSetState<S>
  /** 「填入输入框」回调（外壳注入；Body 一般用不到，FillRow 在外壳）。 */
  readonly onFill?: ((text: string) => boolean) | undefined
}

/** React 体模块。 */
export interface IuKindBody {
  readonly kind: string
  /**
   * Body 组件。返回类型用 ReactNode 而不是 ReactElement | null：各 Body 都是
   * memo(...) 包出来的 NamedExoticComponent，其调用签名在 React 18 类型下返回
   * ReactNode（更宽），窄化到 ReactElement 会让 Map 字面量的重载匹配失败
   * （实测 TS2769）。运行期 React 渲染 ReactNode 完全合法。
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 异构集合，运行期按 spec.kind 路由，类型在各自 Body 内部精确
  readonly Body: (props: IuBodyProps<any, any>) => ReactNode
}

/**
 * kind 名 → React Body。
 *
 * 用 Map 而不是对象字面量：kind 名来自模型输出，Map.get 天然处理未知 key
 * （返回 undefined → IuCard 回退到「不认识就不渲染」，与老实现一致）。
 */
export const IU_BODIES: ReadonlyMap<string, IuKindBody> = new Map<string, IuKindBody>([
  ['slider', { kind: 'slider', Body: SliderBody }],
  ['chart', { kind: 'chart', Body: ChartBody }],
  ['checklist', { kind: 'checklist', Body: ChecklistBody }],
  ['tabs', { kind: 'tabs', Body: TabsBody }],
  ['piano', { kind: 'piano', Body: PianoBody }],
  ['table', { kind: 'table', Body: TableBody }],
  ['kanban', { kind: 'kanban', Body: KanbanBody }],
  ['form', { kind: 'form', Body: FormBody }],
  ['diff', { kind: 'diff', Body: DiffBody }],
  ['timeline', { kind: 'timeline', Body: TimelineBody }],
  ['tree', { kind: 'tree', Body: TreeBody }],
  ['gauge', { kind: 'gauge', Body: GaugeBody }],
  ['quiz', { kind: 'quiz', Body: QuizBody }],
])
