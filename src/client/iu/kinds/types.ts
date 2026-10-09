/**
 * dsh-chat-plus — iu 全部 kind 的 spec 联合类型（纯类型模块）。
 *
 * 单独一个文件而不是塞进 registry.ts：registry.ts 带运行时代码（注册表数组），
 * 而很多消费方只需要类型（IuCard 的 props、shot/card.ts 的窄化）。类型与
 * 运行时分离，避免「只想要个类型却把整张注册表拖进依赖链」。
 *
 * ⚠ 新增 kind 时在这里补一行联合即可（漏了会编译不过，挡得住）。
 */

import type { IuSliderSpec } from './slider.ts'
import type { IuChartSpec } from './chart.ts'
import type { IuChecklistSpec } from './checklist.ts'
import type { IuTabsSpec } from './tabs.ts'
import type { IuPianoSpec } from './piano.ts'
import type { IuTableSpec } from './table.ts'
import type { IuKanbanSpec } from './kanban.ts'
import type { IuFormSpec } from './form.ts'
import type { IuDiffSpec } from './diff.ts'
import type { IuTimelineSpec } from './timeline.ts'
import type { IuTreeSpec } from './tree.ts'
import type { IuGaugeSpec } from './gauge.ts'
import type { IuQuizSpec } from './quiz.ts'

/** 全部合法 spec 的判别联合（判别式是 kind 字段）。 */
export type IuSpec =
  | IuSliderSpec
  | IuChartSpec
  | IuChecklistSpec
  | IuTabsSpec
  | IuPianoSpec
  | IuTableSpec
  | IuKanbanSpec
  | IuFormSpec
  | IuDiffSpec
  | IuTimelineSpec
  | IuTreeSpec
  | IuGaugeSpec
  | IuQuizSpec
