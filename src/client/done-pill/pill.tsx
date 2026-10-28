/**
 * dsh-chat-plus — 对话胶囊（移植自 dsh-companion）— 对话完成胶囊（client 半身）。
 *
 * 移植自 dsh-webui 的 done-pill（_tmp-webui/src/client/done-pill.tsx），拆分
 * 为独立插件。与 webui 版的差异：
 *  - 轮询路由改为 /api/dsh-done-pill（不复用 webui 的 /api/webui-done-pill，
 *    避免与 webui 同时安装时两个宿主模块争抢同一条路由）；
 *  - 槽位 id 改为 dsh-done-pill 前缀（不与 webui 的 done-pill 座位冲突）；
 *  - 移除胶囊右侧「文件」按钮（依赖 webui fileExplorer 的跨模块事件桥，
 *    独立插件里没有监听者，去掉避免无效入口；主体/提醒/运行中区块不变）；
 *  - 主题令牌、localStorage 键（dsh.donePill.*）、CSS 类名与样式表 id 保持
 *    原样——与 webui 共享同一套持久化，卸载 webui 后配置无缝延续。
 *
 * shell.overlay 顶部悬浮胶囊（常驻、可拖拽、位置持久化）：
 *  - 轮询 host 端 /api/dsh-done-pill，任一会话（含后台会话）回合完成时
 *    显示「N 个对话完成 · 「会话」摘要」；
 *  - 点击胶囊主体直接跳进最新完成的会话；鼠标悬停时记录面板从下方滑出，
 *    展示每条的用户问题 + 助手回复全文；
 *  - 极简外观（v0.6.0）：纯白底 + 墨色文字 + 发丝描边，配色随主题
 *    （--dpl-* 变量）；按住拖拽可移动位置（pointer 拖拽，4px 阈值区分
 *    点击），位置存 localStorage（dsh.donePill.pos）；
 *  - 基础设置「对话完成胶囊」开关可整体隐藏（dsh.donePill.enabled）。
 *  - 两种形态（dsh.donePill.mode，设置「胶囊形态」切换，互斥显示）：
 *    卡片 = 挂在 sidebar.footer.action 的左下角小横条（设置行上方，悬停
 *    弹出进行中 + 最近完成，见 ./sidebar-card.tsx）；悬浮 = 本文件的顶部
 *    可拖拽浮窗。缩放/字体/显隐三套设置两种形态共用（见 ./stores.ts）。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { Menu, IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  appearanceStore, enabledStore, fontRatioStore, fontStackOf, modeStore, recStore, FONT_OPTIONS,
  REC_FPS_MIN, REC_FPS_MAX, REC_FPS_DEFAULT, REC_WIDTH_OPTIONS, recWidthLabel,
  type AppearanceConfig, type PillMode, type RecConfig,
} from './stores'
import { SidebarBarCard, ensureCardLayoutCss } from './sidebar-card'
import { IdleRobot } from './idle-robot'
import { RunningArc } from './status-orbit'
import { RecButton } from './rec-button'
import { recorder } from './recorder'
import { RecPickerPanel } from './rec-picker-panel'
import { RecRegionOverlay } from './rec-region-overlay'
import { NavToast } from './nav-toast'
import { NotifyCards } from './notify-card'
import {
  consumeDoneEntries, consumeOpenRequest, notifyStore, activeChannel, inEmbeddedFrame,
  requestNativePermission, type NotifyChannel,
} from './notify-center'
import { openSessionById, setSessionNavContext } from './session-nav'
import { FeatureGate, featureEnabledNow } from '../features/gate.tsx'

/** shell.overlay 槽位无 owner props（见 DSH slot-catalog），此处仅占位。 */
export type DonePillProps = Record<string, never>

/** 手机断点（px）：视口宽度 <768 视为移动端（webui responsive 同款规则）。 */
const MOBILE_BREAKPOINT = 768

/** 同步判断当前是否移动端（无 matchMedia 时返回 false）。 */
function isMobileViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 0.02}px)`).matches
}

interface DoneEntry {
  seq: number
  id: string
  sessionId: string
  title: string
  question: string
  answer: string
  endedAt: number
  /** 本回合耗时（ms）：host 拿不到开始时间时为 0。 */
  durationMs?: number
  turn: number
  reasonKind: string
}

/** 轮询间隔（ms）。 */
const POLL_MS = 3000
/**
 * 后台（窗口失焦/隐藏）时的轮询间隔（ms）。
 *
 * 为什么后台还要轮询：完成提醒（桌面浮窗 + 音效）依赖客户端拿到新完成条目。
 * 早先这里是「`document.hidden` 就跳过整轮」，于是窗口一失焦就再也不会提醒——
 * 用户报的「必须在前台才能弹出通知与音效」就是这个。后台降频而不是停掉。
 */
const POLL_MS_BACKGROUND = 10000
/** 形变共同节奏：外壳宽度伸缩、位置滑动、主文案淡入三者同速，
 *  对称拉伸才严丝合缝；偏慢一档显得从容不抢眼。 */
const MORPH_DUR = '.65s'
/** 内存保留条目上限。 */
const MAX_ENTRIES = 100
/** localStorage 已读 id 上限。 */
const MAX_READ_IDS = 300

const READ_KEY = 'dsh.donePill.read'
const POS_KEY = 'dsh.donePill.pos'

// 运行时会话跳转见 ./session-nav（两种胶囊形态共用）。那里按
// 「官方 uiWorkspace.openSession → 历史 sessions.open」探测入口：
// DSH 0.2 的 sessions 服务（ISessions）根本没有 open()，旧实现直接调
// `ctx.get('sessions').open(...)` 会抛 TypeError 并被 catch 吞掉，
// 表现为「点击胶囊没反应」——根因与修复见 session-nav.ts 顶部注释。

// ---- localStorage 工具 ----
// 持久化：已读 id 集合、胶囊位置、显隐开关；完成记录每次页面加载从 host
// 全量拉取恢复（host 保留最近 MAX_ITEMS 条），增量水位仅存内存。

function loadReadIds(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_KEY)
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) return new Set(parsed.filter((v): v is string => typeof v === 'string'))
    }
  } catch { /* 忽略 */ }
  return new Set()
}

function saveReadIds(ids: Set<string>): void {
  try {
    const arr = [...ids]
    localStorage.setItem(READ_KEY, JSON.stringify(arr.length > MAX_READ_IDS ? arr.slice(-MAX_READ_IDS) : arr))
  } catch { /* 忽略 */ }
}

interface PillPos { x: number; y: number }

/** 持久化的位置锚点：胶囊**中心点**的视口比率（0~1）。以中心为锚，
 *  内容扩宽/收窄、窗口缩放/最大化时都向两侧对称伸缩，不会只往一边跑。 */
interface PillAnchor { xc: number; yc: number }

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/**
 * 未拖拽时胶囊的默认纵向位置：移动端避让左上角菜单按钮（44px 浮钮，
 * top 8 + 高 44 → 底缘 52），胶囊从 60 起（间隔 8px）；桌面维持 40。
 */
function defaultShellTop(): number {
  return isMobileViewport() ? 60 : 40
}

/** 把位置夹回视口内并取整（非整数像素会让文字发糊）。
 *  w/h = 胶囊**实际渲染尺寸**：旧实现固定按 160×56 估算，600px 宽的胶囊
 *  能被拖出屏幕大半（右缘算不进去）；缩放到 160% 时高度同理。
 *  margin = 0（v0.6.2）：允许贴边——旧 8px 安全边距让顶部永远差一条缝，
 *  用户反馈「放最上面时还有间隙、不能继续往上」。只保证不出屏即可。 */
function clampPos(x: number, y: number, w = 160, h = PILL_H): PillPos {
  const margin = 0
  const maxX = Math.max(margin, window.innerWidth - w - margin)
  const maxY = Math.max(margin, window.innerHeight - h - margin)
  return {
    x: Math.round(Math.min(Math.max(x, margin), maxX)),
    y: Math.round(Math.min(Math.max(y, margin), maxY)),
  }
}

/** localStorage 里可能出现过的全部历史格式字段。 */
type ParsedAnchor = Partial<PillAnchor & PillPos & { xr: number; yr: number }>

function loadAnchor(): PillAnchor | null {
  try {
    const raw = localStorage.getItem(POS_KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as ParsedAnchor
      // 新格式：中心点视口比率。
      if (typeof parsed?.xc === 'number' && Number.isFinite(parsed.xc)
        && typeof parsed?.yc === 'number' && Number.isFinite(parsed.yc)) {
        return { xc: clamp01(parsed.xc), yc: clamp01(parsed.yc) }
      }
      // 更旧格式（左上角比率）：一次性迁移为中心点比率（按估宽 160 补正）。
      if (typeof parsed?.xr === 'number' && typeof parsed?.yr === 'number'
        && Number.isFinite(parsed.xr) && Number.isFinite(parsed.yr)) {
        return { xc: clamp01((parsed.xr * window.innerWidth + 80) / window.innerWidth), yc: clamp01(parsed.yr) }
      }
      // 最旧格式（绝对像素）：迁移为中心点比率。
      if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number'
        && Number.isFinite(parsed.x) && Number.isFinite(parsed.y)
        && window.innerWidth > 0 && window.innerHeight > 0) {
        return {
          xc: clamp01((parsed.x + 80) / window.innerWidth),
          yc: clamp01((parsed.y + 15) / window.innerHeight),
        }
      }
    }
  } catch { /* 忽略 */ }
  return null
}

function saveAnchor(anchor: PillAnchor): void {
  try { localStorage.setItem(POS_KEY, JSON.stringify(anchor)) } catch { /* 忽略 */ }
}

/** 胶囊外壳基准高度（px）：与 pillShellStyle 的 height 同源。v0.2.1 起
 *  按用户反馈收矮（54→46）；v0.6.1 再收矮到 40、圆角 14px。
 *
 *  2026-10-09 起**还要乘官方字号比例**：外壳高度是内联的
 *  `calc(40px * var(--dps))`，而字号已经乘上了 `--dpt`（字号调大后文字不再
 *  被 40px 的高度夹住）；如果 JS 侧的高度换算不跟着放大，拖拽钳制与中心锚点
 *  就会按偏小的高度算，胶囊被拖到贴近视口边缘时位置会漂、贴边判定也会错。 */
const PILL_H = 40

/**
 * 胶囊实际高度 = 基准 × 胶囊大小 × 官方字号比例。
 * @param scale - 用户自设的「胶囊大小」系数。
 * @param ratio - 官方字号比例（缺省 1 = 不随字号放大，向后兼容既有调用）。
 */
function pillHeight(scale: number, ratio = 1): number {
  return Math.max(1, Math.round(PILL_H * scale * ratio))
}

/**
 * 胶囊内图标的像素尺寸 = 基准 × 胶囊大小 × 官方字号比例，并保底一个下限。
 *
 * 图标在胶囊里是与文字**并排**的元素，字号放大而图标不动，就会出现
 * 「大字的旁边挂着一枚小图标」，视觉重量对不上；所以它与字号走同一份比例。
 * 下限（`min`）保住最小档：字号 10px 时图标不至于缩成一颗看不清的点。
 *
 * @param base - 基准尺寸（px，= 改造前 `Math.round(base * scale)` 里的那个数）。
 * @param min - 下限（px）。
 * @param scale - 「胶囊大小」系数。
 * @param ratio - 官方字号比例。
 */
function iconSize(base: number, min: number, scale: number, ratio: number): number {
  return Math.max(min, Math.round(base * scale * ratio))
}

/** 中心锚点 → 当前视口下的左上角坐标（shellWidth/shellHeight 为当前渲染尺寸）。
 *  高度必须参与换算：缩放到 160% 时半高是 24px 而非 15px，写死会让垂直位置漂移。 */
function anchorToPos(anchor: PillAnchor, shellWidth: number, shellHeight = PILL_H): PillPos {
  return clampPos(
    Math.round(anchor.xc * window.innerWidth - shellWidth / 2),
    Math.round(anchor.yc * window.innerHeight - shellHeight / 2),
    shellWidth,
    shellHeight,
  )
}

// ---- 健康提醒（休息时间段 / 凌晨提示）----

const REST_KEY = 'dsh.donePill.rest'
const LATE_KEY = 'dsh.donePill.late'

interface ReminderConfig {
  /** 是否启用该提醒。 */
  enabled: boolean
  /** 开始 "HH:mm"。 */
  start: string
  /** 结束 "HH:mm"（早于 start 表示跨午夜，如 22:00-07:00）。 */
  end: string
}

/** 提醒配置 store（localStorage 持久化）。 */
interface ReminderStore {
  get: () => ReminderConfig
  set: (next: ReminderConfig) => void
  subscribe: (fn: (next: ReminderConfig) => void) => () => void
}

function createReminderStore(key: string, defaults: ReminderConfig): ReminderStore {
  let value: ReminderConfig = { ...defaults }
  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<ReminderConfig>
      value = {
        enabled: parsed?.enabled === true,
        start: typeof parsed?.start === 'string' && /^\d{2}:\d{2}$/.test(parsed.start) ? parsed.start : defaults.start,
        end: typeof parsed?.end === 'string' && /^\d{2}:\d{2}$/.test(parsed.end) ? parsed.end : defaults.end,
      }
    }
  } catch { /* 忽略 */ }
  const listeners = new Set<(next: ReminderConfig) => void>()
  return {
    get: () => value,
    set(next) {
      value = next
      try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* 忽略 */ }
      for (const fn of [...listeners]) fn(next)
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
  }
}

const restStore = createReminderStore(REST_KEY, { enabled: false, start: '13:00', end: '14:00' })
const lateStore = createReminderStore(LATE_KEY, { enabled: true, start: '00:00', end: '07:00' })

/** "HH:mm" → 当日分钟数；非法返回 null。 */
function parseHM(hm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hm)
  if (match === null) return null
  const hh = Number(match[1])
  const mm = Number(match[2])
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
  return hh * 60 + mm
}

/** 当前时刻是否落在 [start, end) 内；start === end 视为永不；跨午夜（start > end）取并集。 */
function inTimeRange(nowMinutes: number, config: ReminderConfig): boolean {
  const s = parseHM(config.start)
  const e = parseHM(config.end)
  if (s === null || e === null || s === e) return false
  return s < e ? nowMinutes >= s && nowMinutes < e : nowMinutes >= s || nowMinutes < e
}

// ---- 平时轮播：开心话术 + AI 名词小知识 ----

type FunIconKind = 'sparkle' | 'bulb'

interface FunLine {
  icon: FunIconKind
  text: string
}

const FUN_LINES: FunLine[] = [
  // 开心话术（13 条）
  { icon: 'sparkle', text: '今天也是充满可能的一天！' },
  { icon: 'sparkle', text: '你解决问题的样子真的很酷' },
  { icon: 'sparkle', text: '每一行代码都在靠近目标' },
  { icon: 'sparkle', text: '休息一下，灵感往往在放松时出现' },
  { icon: 'sparkle', text: '已完成的每一个任务都算数' },
  { icon: 'sparkle', text: '保持好奇，世界会给你答案' },
  { icon: 'sparkle', text: '进步不必巨大，持续就很了不起' },
  { icon: 'sparkle', text: '深呼吸，一切都会顺利的' },
  { icon: 'sparkle', text: '记得喝水，身体是革命的本钱' },
  { icon: 'sparkle', text: '星光不问赶路人，时光不负有心人' },
  { icon: 'sparkle', text: '小步前进也是一种抵达' },
  { icon: 'sparkle', text: '你的努力，时间看得见' },
  { icon: 'sparkle', text: '笑一笑，bug 都会少一点' },
  // AI 名词小知识（100+ 条）
  { icon: 'bulb', text: 'LLM 大语言模型：通过海量文本训练、能理解并生成自然语言的 AI 模型' },
  { icon: 'bulb', text: 'Token 词元：模型处理文本的最小单位，一个汉字通常是 1~2 个' },
  { icon: 'bulb', text: 'Transformer：2017 年提出的注意力架构，现代大模型的基石' },
  { icon: 'bulb', text: 'Prompt 提示词：你发给 AI 的指令，写得越清晰回答越靠谱' },
  { icon: 'bulb', text: '微调 Fine-tuning：用特定数据继续训练，让它更擅长某个领域' },
  { icon: 'bulb', text: 'RAG 检索增强生成：先查资料再回答，让答案有据可依' },
  { icon: 'bulb', text: '幻觉 Hallucination：AI 一本正经编造不存在的事实，记得核实' },
  { icon: 'bulb', text: '多模态 Multimodal：能同时理解文字、图片、音频等信息的模型' },
  { icon: 'bulb', text: 'Agent 智能体：能自主规划步骤、调用工具、完成任务的 AI' },
  { icon: 'bulb', text: '上下文窗口 Context Window：模型一次能「看到」的最大文本长度' },
  { icon: 'bulb', text: '温度 Temperature：控制回答随机性的参数，越低越严谨' },
  { icon: 'bulb', text: 'Embedding 向量嵌入：把文字变成数字向量，可计算语义相似度' },
  { icon: 'bulb', text: '思维链 Chain-of-Thought：让 AI 一步步推理，复杂题正确率大增' },
  { icon: 'bulb', text: '蒸馏 Distillation：用大模型教小模型，更快更便宜' },
  { icon: 'bulb', text: '对齐 Alignment：让 AI 行为符合人类意图与价值观' },
  { icon: 'bulb', text: 'RLHF 人类反馈强化学习：用人类偏好训练，回答更合意' },
  { icon: 'bulb', text: '机器学习 ML：让计算机从数据中自动学规律，无需显式编程' },
  { icon: 'bulb', text: '深度学习 DL：用多层神经网络自动抽取特征的分支' },
  { icon: 'bulb', text: '神经网络：模拟人脑神经元连接的计算模型，深度学习的基石' },
  { icon: 'bulb', text: '参数 Parameter：模型内部可学习的数值，决定「记忆」与能力' },
  { icon: 'bulb', text: '权重 Weight：神经网络连接的强度数值，训练时不断被调整' },
  { icon: 'bulb', text: '训练 Training：用海量数据反复调整参数、让模型学会任务' },
  { icon: 'bulb', text: '推理 Inference：训练好的模型对输入计算并输出结果' },
  { icon: 'bulb', text: '数据集 Dataset：用于训练与评估模型的样本集合' },
  { icon: 'bulb', text: '语料库 Corpus：大规模文本集合，大模型训练的主要原料' },
  { icon: 'bulb', text: '注意力机制 Attention：让模型聚焦输入中关键部分的技术' },
  { icon: 'bulb', text: '自注意力 Self-Attention：让每个词关联上下文中的所有词' },
  { icon: 'bulb', text: '多头注意力 Multi-Head：并行多组注意力，捕捉不同关系' },
  { icon: 'bulb', text: '编码器 Encoder：把输入编码成向量表示的模块' },
  { icon: 'bulb', text: '解码器 Decoder：根据编码信息逐字生成的模块' },
  { icon: 'bulb', text: '位置编码 Positional Encoding：让模型感知词序的方法' },
  { icon: 'bulb', text: '残差连接 Residual：跨层直连通道，缓解深层网络退化' },
  { icon: 'bulb', text: '归一化 Normalization：稳定数值分布，加速训练的技巧' },
  { icon: 'bulb', text: '激活函数 Activation：引入非线性，让网络能学复杂关系' },
  { icon: 'bulb', text: '预训练 Pre-training：在大规模语料上无监督学习通用知识' },
  { icon: 'bulb', text: '监督微调 SFT：用问答范例教模型按指令作答' },
  { icon: 'bulb', text: '损失函数 Loss：衡量预测与目标的差距，指导参数更新' },
  { icon: 'bulb', text: '梯度下降 Gradient Descent：沿梯度方向迭代减小误差' },
  { icon: 'bulb', text: '学习率 Learning Rate：每步参数更新的步幅' },
  { icon: 'bulb', text: '批大小 Batch Size：一次训练喂给模型的样本数' },
  { icon: 'bulb', text: '轮次 Epoch：完整过一遍训练数据的次数' },
  { icon: 'bulb', text: '过拟合 Overfitting：模型死记训练数据、泛化能力差' },
  { icon: 'bulb', text: '欠拟合 Underfitting：模型没学到足够规律，训练集都做不好' },
  { icon: 'bulb', text: '正则化 Regularization：抑制过拟合的一系列手段' },
  { icon: 'bulb', text: '早停 Early Stopping：验证集不再提升就提前结束训练' },
  { icon: 'bulb', text: '量化 Quantization：压缩数值精度，减小体积加速推理' },
  { icon: 'bulb', text: '剪枝 Pruning：移除冗余参数，给模型瘦身' },
  { icon: 'bulb', text: '迁移学习 Transfer Learning：把已学知识迁移到新任务' },
  { icon: 'bulb', text: '分词器 Tokenizer：把文本切分成词元序列的工具' },
  { icon: 'bulb', text: '生成 Generation：模型逐字预测下一个词元的过程' },
  { icon: 'bulb', text: '自回归 Autoregressive：用已生成的词预测下一个词' },
  { icon: 'bulb', text: '采样 Sampling：按概率分布随机选择下一个词' },
  { icon: 'bulb', text: 'Top-p 核采样：只在累计概率达 p 的候选词中采样' },
  { icon: 'bulb', text: 'Top-k 采样：只在概率最高的 k 个词中采样' },
  { icon: 'bulb', text: '贪心解码 Greedy：每步都选概率最高的词，稳定但易重复' },
  { icon: 'bulb', text: '束搜索 Beam Search：保留多条候选路径，兼顾质量与多样' },
  { icon: 'bulb', text: '停止词 Stop Token：标记生成结束的特殊词元' },
  { icon: 'bulb', text: '长度惩罚 Length Penalty：调节输出长短倾向的参数' },
  { icon: 'bulb', text: '推理 Reasoning：模型推导、计算、多步思考的能力' },
  { icon: 'bulb', text: '提示工程 Prompt Engineering：设计输入让模型表现更好' },
  { icon: 'bulb', text: '少样本提示 Few-shot：给几个范例，模型照着格式做' },
  { icon: 'bulb', text: '零样本 Zero-shot：不给范例，直接提问' },
  { icon: 'bulb', text: '上下文学习 In-Context Learning：靠提示词临时学会任务' },
  { icon: 'bulb', text: '自一致性 Self-Consistency：多次采样投票，取多数答案' },
  { icon: 'bulb', text: '思维树 Tree-of-Thoughts：多分支探索推理路径并回溯' },
  { icon: 'bulb', text: '规划 Planning：把复杂任务拆解成可执行步骤' },
  { icon: 'bulb', text: '向量数据库 Vector DB：存储并检索高维向量的数据库' },
  { icon: 'bulb', text: '相似度检索 Similarity Search：按向量距离找最相关内容' },
  { icon: 'bulb', text: '余弦相似度 Cosine：衡量两向量方向接近程度的指标' },
  { icon: 'bulb', text: '知识库 Knowledge Base：供检索引用的结构化资料集合' },
  { icon: 'bulb', text: '分块 Chunking：把长文档切成便于检索的小段' },
  { icon: 'bulb', text: '重排序 Rerank：对召回结果二次排序，提升相关性' },
  { icon: 'bulb', text: '语义搜索 Semantic Search：按含义而非关键词匹配' },
  { icon: 'bulb', text: '混合检索 Hybrid：关键词 + 向量两种方式结合' },
  { icon: 'bulb', text: '工具调用 Function Calling：模型按需调用外部函数或 API' },
  { icon: 'bulb', text: '多智能体 Multi-Agent：多个智能体分工协作完成目标' },
  { icon: 'bulb', text: '记忆 Memory：智能体跨轮次保留上下文与事实' },
  { icon: 'bulb', text: '反思 Reflection：让智能体自我审查并改进输出' },
  { icon: 'bulb', text: '自主性 Autonomy：智能体不依赖人逐步指挥的能力' },
  { icon: 'bulb', text: '视觉语言模型 VLM：能看图识图、图文推理的模型' },
  { icon: 'bulb', text: '文生图 Text-to-Image：根据文字描述生成图片' },
  { icon: 'bulb', text: '扩散模型 Diffusion：逐步去噪生成图像的主流方法' },
  { icon: 'bulb', text: '文生视频 Text-to-Video：根据文字生成视频' },
  { icon: 'bulb', text: '语音识别 ASR：把语音转成文字' },
  { icon: 'bulb', text: '语音合成 TTS：把文字转成语音' },
  { icon: 'bulb', text: 'OCR 文字识别：从图片中提取文字' },
  { icon: 'bulb', text: '基准 Benchmark：标准化测试集，用来衡量模型能力' },
  { icon: 'bulb', text: '困惑度 Perplexity：衡量语言模型预测能力的指标' },
  { icon: 'bulb', text: 'BLEU：机器翻译质量的自动评分指标' },
  { icon: 'bulb', text: 'ROUGE：摘要质量的自动评分指标' },
  { icon: 'bulb', text: '安全性 Safety：防止模型输出有害、违规内容' },
  { icon: 'bulb', text: '越狱 Jailbreak：用诱导话术突破模型安全限制' },
  { icon: 'bulb', text: '红队测试 Red Teaming：主动攻击模型找漏洞' },
  { icon: 'bulb', text: '偏见 Bias：模型放大训练数据中的刻板印象' },
  { icon: 'bulb', text: '可解释性 Interpretability：理解模型为何如此决策' },
  { icon: 'bulb', text: '数据污染 Data Contamination：测试题混进训练数据、分数虚高' },
  { icon: 'bulb', text: '小模型 SLM：参数少、可本地运行的高效模型' },
  { icon: 'bulb', text: '开源模型 Open-source：权重公开，可自由使用与微调' },
  { icon: 'bulb', text: '流式输出 Streaming：边生成边返回，体验更顺滑' },
  { icon: 'bulb', text: '系统提示词 System Prompt：设定角色与规则的顶层指令' },
  { icon: 'bulb', text: '多轮对话 Multi-turn：带历史上下文的连续问答' },
  { icon: 'bulb', text: '缓存 Cache：缓存重复请求，省钱又提速' },
]

/** 轮播间隔（ms）：30 秒换一条。 */
const FUN_INTERVAL_MS = 30000

// ---- 胶囊外观（大小缩放 + 字体风格）：store 定义见 ./stores（与左下角
// 小横条卡片共用同一套缩放/字体设置，切换实时联动）----

// ---- 展示工具 ----

function formatTime(ts: number): string {
  if (ts <= 0) return ''
  const d = new Date(ts)
  const now = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (d.toDateString() === now.toDateString()) return `${hh}:${mm}`
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${mo}-${day} ${hh}:${mm}`
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`
}

/** 执行时长（实时跳动）：mm:ss，超过 1 小时 h:mm:ss。 */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hh = Math.floor(total / 3600)
  const mm = Math.floor((total % 3600) / 60)
  const ss = total % 60
  if (hh > 0) return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
  return `${mm}:${String(ss).padStart(2, '0')}`
}

/**
 * 胶囊自带样式表（一次性注入）：keyframes + 全部配色规则。
 *
 * ⚠ 必须由胶囊自己注入，不能塞进 client/styles.ts 的 dsh-webui-styles 表——
 * 那张表由 Webui.tsx 在**会话视图内**挂载时才注入，而胶囊挂在 shell.overlay
 * 上全局常驻：打开首页/无会话时胶囊拿不到任何样式（透明无底无描边，浅色
 * 主题下彻底看不见）。实测就是「浅色主题看不出胶囊」的根因之一。
 *
 * 配色跟随主题：旧实现把「黑底白字 + 蓝辉光」写死在内联样式里，浅色主题下
 * 白字落在白底上直接隐形。这里收敛成一组 --dpl-* 变量（深/浅各一套），
 * 组件内联样式只负责几何，颜色全部引用变量。
 */
function ensurePillKeyframes(): void {
  // 升级安全：早退会造成「旧样式表还在、新规则永远进不来」。
  // 插件更新后（bundle 换了新代码，但页面里那张 <style> 还是旧的），
  // 动画/新类名全部失效——运行中笔画会渲染成静态圆环，且控制台零报错。
  // 先比对内容指纹：不一样就删掉重注入；一样才早退。
  const existing = document.getElementById(PILL_STYLE_ID)
  if (existing !== null) {
    // 惰性计算：CSS_REV 依赖 PILL_CSS，而 PILL_CSS 声明在本函数之后，
    // 在模块顶层求值会撞上 TDZ（ReferenceError）。
    if (existing.getAttribute('data-css-rev') === cssRevision()) return
    existing.remove()
  }
  const style = document.createElement('style')
  style.id = PILL_STYLE_ID
  style.dataset.plugin = 'dsh-done-pill'
  style.dataset.pluginCss = 'webui/done-pill'
  // 内容指纹：直接由样式表文本算出，改样式必然改指纹，不会忘记同步。
  style.setAttribute('data-css-rev', cssRevision())
  style.textContent = PILL_CSS
  document.head.appendChild(style)
}

/**
 * 样式表内容指纹（djb2 + 长度）。
 *
 * 不用手写版本号（容易忘记同步），直接对 PILL_CSS 哈希：任何规则改动都会
 * 改变指纹，旧样式表因此会被识别并替换。
 *
 * 惰性求值 + 缓存：PILL_CSS 声明在本文件靠后位置，顶层求值会撞 TDZ。
 */
let cssRevCache: string | undefined
function cssRevision(): string {
  if (cssRevCache !== undefined) return cssRevCache
  let hash = 5381
  for (let i = 0; i < PILL_CSS.length; i += 1) {
    hash = ((hash << 5) + hash + PILL_CSS.charCodeAt(i)) >>> 0
  }
  cssRevCache = PILL_CSS.length.toString(36) + '-' + hash.toString(36)
  return cssRevCache
}

const PILL_STYLE_ID = 'dsh-done-pill-css'

const PILL_CSS = `
@keyframes dpLineIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
@keyframes dpMount{from{opacity:0;transform:translateY(-10px) scale(.96)}to{opacity:1;transform:none}}
@keyframes dpFadeIn{from{opacity:0}to{opacity:1}}
/* 设置行下拉触发钮：复刻官方 EnterBehaviorRow 的 selector（36px 圆角模块底 +
   hover 反馈 + chevron），与「繁忙时的发送行为」那行视觉一致。 */
.dpl-settings-select{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);height:36px;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;border:none;align-items:center;gap:12px;padding:0 14px;font-size:14px;line-height:22px;display:inline-flex;flex:none;transition:background-color .15s ease}
.dpl-settings-select:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dpl-settings-select:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:2px}
.dpl-settings-select .dpl-settings-chev{flex:none}
@keyframes dpPop{0%{transform:scale(.5);opacity:0}100%{transform:scale(1);opacity:1}}
@keyframes dpRowIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
/* 跳转失败提示条（nav-toast.tsx）：从下方滑入 + 微缩放，收起时反向淡出。
   与胶囊同一套节奏（.32,.72,0,1），保持整插件的动效语言一致。 */
@keyframes dplToastIn{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}
@keyframes dplToastOut{from{opacity:1;transform:none}to{opacity:0;transform:translateY(6px) scale(.98)}}
/* 页内完成提醒卡（notify-card.tsx）：右下角堆叠，从右侧滑入 + 轻微缩放，
   收起时向右缩回。比提示条多一个 x 位移——它从屏幕边缘进来，方向感更强。 */
@keyframes dplNoticeIn{from{opacity:0;transform:translateX(24px) scale(.96)}to{opacity:1;transform:none}}
@keyframes dplNoticeOut{from{opacity:1;transform:none}to{opacity:0;transform:translateX(18px) scale(.96)}}
/* 卡片 hover：微抬 + 描边加深（与胶囊同款微交互，点击进会话前先给反馈）。 */
[data-dpl-notice]{transition:transform .22s cubic-bezier(.32,.72,0,1),box-shadow .22s ease,border-color .22s ease}
[data-dpl-notice]:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--dpl-fg) 20%,transparent)}
[data-dpl-notice]:focus-visible{outline:2px solid var(--dpl-fg);outline-offset:2px}
/* 出错卡的语义条/图标定色（正常完成走 --dpl-ok，定义见组件内联）。 */
[data-dpl-notice="error"]{box-shadow:var(--dpl-panel-shadow),inset 0 0 0 1px color-mix(in srgb,var(--dpl-warn) 18%,transparent)}
/* ── 对话胶囊（极简风 v0.6.0）：纯白纸面 + 墨色文字 + 发丝描边 ──
   无渐变、无辉光、无扫描光带；颜色只做层级，动效只留淡入/位移/缩放。 */
.dsh-done-pill{
  --dpl-fg:#2f3437;
  --dpl-fg-dim:#787774;
  --dpl-fg-weak:#9b9a97;
  --dpl-accent:#2f3437;
  --dpl-accent-soft:rgba(47,52,55,.06);
  --dpl-accent-ring:rgba(47,52,55,.35);
  --dpl-warn:#9a6b15;
  --dpl-ok:#448361;
  /* 外壳无描边，用双层弥散阴影定边（v0.6.3：边条整体撤掉换阴影）。 */
  --dpl-shell-shadow:0 1px 2px rgba(47,52,55,.10),0 6px 20px rgba(47,52,55,.09);
  --dpl-shell-shadow-hover:0 2px 6px rgba(47,52,55,.14),0 10px 28px rgba(47,52,55,.13);
  --dpl-shell-shadow-unread:0 2px 10px rgba(47,52,55,.20),0 10px 30px rgba(47,52,55,.17);
  --dpl-divider:rgba(47,52,55,.10);
  --dpl-panel-bg:#ffffff;
  --dpl-panel-border:rgba(47,52,55,.12);
  --dpl-panel-shadow:0 12px 32px rgba(47,52,55,.08),0 2px 8px rgba(47,52,55,.04);
  --dpl-row-bg:rgba(47,52,55,.04);
  --dpl-row-hover:rgba(47,52,55,.08);
  --dpl-caption-bg:rgba(47,52,55,.05);
  --dpl-caption-fg:#787774;
}
/* 深色主题：暖炭底 + 暖白文字，同一套几何与动画。 */
body[data-ds-dark-theme] .dsh-done-pill{
  --dpl-fg:#d6d3cd;
  --dpl-fg-dim:#a3a09a;
  --dpl-fg-weak:#7d7a73;
  --dpl-accent:#d6d3cd;
  --dpl-accent-soft:rgba(214,211,205,.08);
  --dpl-accent-ring:rgba(214,211,205,.40);
  --dpl-warn:#d9a05b;
  --dpl-ok:#7ab894;
  --dpl-shell-shadow:0 1px 2px rgba(0,0,0,.35),0 6px 20px rgba(0,0,0,.45);
  --dpl-shell-shadow-hover:0 2px 6px rgba(0,0,0,.40),0 10px 28px rgba(0,0,0,.50);
  --dpl-shell-shadow-unread:0 2px 10px rgba(0,0,0,.50),0 10px 30px rgba(0,0,0,.55);
  --dpl-divider:rgba(214,211,205,.12);
  --dpl-panel-bg:#202020;
  --dpl-panel-border:rgba(214,211,205,.10);
  --dpl-panel-shadow:0 14px 36px rgba(0,0,0,.5);
  --dpl-row-bg:rgba(214,211,205,.06);
  --dpl-row-hover:rgba(214,211,205,.11);
  --dpl-caption-bg:rgba(214,211,205,.07);
  --dpl-caption-fg:#a3a09a;
}
/* 外壳：半透明纯白底 + 发丝描边；hover 加深描边并微抬（保留轻反馈）。
   ⚠ 底色必须中性白：暖纸白（253,253,250）叠在纯白页面上会泛黄（实测翻车）。 */
.dsh-done-pill-shell{
  background:rgba(255,255,255,.94);
  backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px);
  color:var(--dpl-fg);
  box-shadow:var(--dpl-shell-shadow);
  animation:dpMount .5s cubic-bezier(.32,.72,0,1) backwards;
}
body[data-ds-dark-theme] .dsh-done-pill-shell{
  background:rgba(32,32,32,.92);
}
.dsh-done-pill-shell:hover{box-shadow:var(--dpl-shell-shadow-hover);transform:translateY(-1px)}
.dsh-done-pill-shell:active{transform:translateY(0) scale(.99)}
/* 未读态：主文字加重 + 阴影加重（无描边，不发光）。 */
.dsh-done-pill-shell[data-unread="1"]{
  font-weight:550;letter-spacing:-.005em;
  box-shadow:var(--dpl-shell-shadow-unread);
}
/* 提醒芯片：弱化的暖赭色语义点（极简里仅存的少量彩色）。 */
.dpl-reminder-pill{
  display:inline-flex;align-items:center;
  background:color-mix(in srgb,var(--dpl-warn) 8%,transparent);
  box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dpl-warn) 22%,transparent);
  border-radius:999px;padding:2px 9px;
}
/* 待机机器人（OpenBotMotion）：容器由 CSS 定尺寸，引擎把 SVG 按 100% 铺进去。
   引擎自带 viewBox 留白过大，idle-robot.tsx 会把它收窄到实测姿态边界。

   ⚠ 机器人的**视觉尺寸由这个容器决定**，不是 IdleRobot 的 size prop
   （那个 prop 只传进引擎当内部画布参数，见 idle-robot.tsx 的
   「the container's CSS box wins for layout」）。所以要它跟着官方字号轴
   放大，必须改这里——只改 size prop 是看不见效果的。 */
.dpl-idle-bot{flex:none;position:relative;width:calc(22px * var(--dps) * var(--dpt,1));height:calc(22px * var(--dps) * var(--dpt,1));display:inline-flex;align-items:center;justify-content:center;overflow:visible}
.dpl-idle-bot svg{display:block;width:100%;height:100%;overflow:visible}
/* 卡片形态的机器人：小横条用 16px、rail 图标钮用 20px（容器尺寸显式给足，
   否则引擎的 SVG 没有盒子可铺）。同样乘 --dpt。 */
.dpp-idle-bot{width:calc(16px * var(--dpt,1));height:calc(16px * var(--dpt,1))}
.dpp-idle-bot svg{display:block;width:100%;height:100%;overflow:visible}
[data-dpp-card="rail"] .dpp-idle-bot{width:calc(20px * var(--dpt,1));height:calc(20px * var(--dpt,1))}
/* 小横条上的三枚固定图标（运行笔画 / 灯泡 / 箭头）：svg 的 width/height 是
   组件里写死的呈现属性，与旁边已经跟随字号的文字并排就会显得缩了一号。
   用 CSS 的 calc 覆盖呈现属性（CSS 声明优先于呈现属性），一处规则管三枚，
   不必把 ratio 一路透传进每个小组件。 */
.dpp-orb svg,.dpp-bulb,.dpp-bar .dpp-chev svg{
  width:calc(15px * var(--dpt,1)) !important;height:calc(15px * var(--dpt,1)) !important;
}
.dpp-bar .dpp-chev svg{width:calc(12px * var(--dpt,1)) !important;height:calc(12px * var(--dpt,1)) !important}
/* 录屏选择面板的四个小图标：同样用 CSS 覆盖呈现属性，跟随字号轴。 */
.dpl-rec-icon{width:calc(13px * var(--dpt,1)) !important;height:calc(13px * var(--dpt,1)) !important}
.dpl-rec-icon--sm{width:calc(12px * var(--dpt,1)) !important;height:calc(12px * var(--dpt,1)) !important}
/* 运行中笔画（移植自 dsh-notch 的 StatusOrbit）：一段 70% 圆周的蓝色实色笔画，
   圆头线帽，匀速自转。角速度 2π/3 rad/s = 一圈 3 秒（上游 DecisionSpin.runningVelocity）。
   ⚠ 用 SVG 圆弧而不是 conic-gradient：上游是「一笔」的观感，需要 stroke-linecap:round
   的圆头端点，渐变环画不出来。 */
.dpl-run-arc-wrap{position:relative;flex:none;display:inline-flex;align-items:center;justify-content:center}
.dpl-run-arc{display:block;animation:dpOrbitSpin 3s linear infinite;transform-origin:50% 50%}
@keyframes dpOrbitSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
/* 灯泡徽章：无底无环的单色线稿，hover 轻微放大（微交互）。 */
.dpl-bulb-badge{color:var(--dpl-fg-dim);transition:transform .25s cubic-bezier(.32,.72,0,1)}
.dsh-done-pill-main:hover .dpl-bulb-badge{transform:scale(1.08)}
/* 信息分层：核心词淡墨小签（视觉锚点），释义次级色、优先截断。
   字号乘 --dpt：这是主文案的一部分（「N 条完成」/术语 Tag），字号设置调大时
   释义在长、Tag 却钉在 12px，同一个按钮里两种字级。 */
.dpl-info-tag{flex:none;font-weight:600;font-size:calc(12px * var(--dps) * var(--dpt,1));line-height:calc(20px * var(--dps) * var(--dpt,1));padding:0 8px;border-radius:4px;background:var(--dpl-accent-soft);color:var(--dpl-fg);white-space:nowrap}
.dpl-main-desc{flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dpl-fg-dim)}
.dpl-main-desc--plain{color:inherit}
/* 主体按钮：箭头 hover 右移 2px（微交互）。 */
.dsh-done-pill-main .dpl-chev{
  /* 容器必须与里面的 svg 同步（svg 走 iconSize() 会随 --dpt 放大）：
     容器只跟 --dps 而图标跟 --dps × --dpt 的话，字号最大档图标会顶出圆形容器。 */
  width:calc(18px * var(--dps) * var(--dpt,1));height:calc(18px * var(--dps) * var(--dpt,1));border-radius:50%;
  display:inline-flex;align-items:center;justify-content:center;
  color:var(--dpl-fg-weak);background:transparent;
  transition:transform .22s cubic-bezier(.32,.72,0,1),color .2s ease;
}
.dsh-done-pill-main:hover .dpl-chev{transform:translateX(2px);color:var(--dpl-fg)}
.dsh-done-pill-row{animation:dpRowIn .32s cubic-bezier(.32,.72,0,1) backwards}
@media (prefers-reduced-motion:reduce){
  .dsh-done-pill-shell,.dpl-run-arc,.dsh-done-pill-row{animation:none !important}
  .dsh-done-pill-shell,.dsh-done-pill-main .dpl-chev,.dsh-done-pill-row{transition:none !important}
  [data-dpp-card],.dpp-bar,.dpp-bar .dpp-chev,.dpp-bar .dpp-bulb,.dpp-bar-label,.dpp-icon-swap,.dpp-badge-pop{animation:none !important;transition:none !important}
  [data-dpl-toast]{animation:none !important}
  [data-dpl-notice]{animation:none !important;transition:none !important}
}
/* 面板内可点行（任务行 / 完成记录卡）：hover 浅墨底 + 左侧 2px 墨条。 */
.dsh-done-pill-row{transition:background .12s ease,box-shadow .12s ease}
.dsh-done-pill-row:hover{background:var(--dpl-row-hover);box-shadow:inset 2px 0 0 var(--dpl-fg)}
.dsh-done-pill-row:focus-visible{outline:2px solid var(--dpl-fg);outline-offset:-2px}
.dsh-done-pill-close{transition:background .12s ease,color .12s ease}
.dsh-done-pill-close:hover{background:var(--dpl-accent-soft);color:var(--dpl-fg)}
/* 头部「点击卡片进入会话」链接：hover 下划线。 */
.dsh-done-pill-link{transition:color .12s ease}
.dsh-done-pill-link:hover{text-decoration:underline}
.dsh-done-pill-link:disabled{color:var(--dpl-fg-weak);cursor:default;text-decoration:none}
/* ── 左下角小横条（卡片形态 .dpp-bar，见 sidebar-card.tsx）：
   hover 进出 + 任务开始/完成的状态过渡动效。
   ⚠ 表面属性（底色/描边/投影/文字色）必须留在类上而不是内联：
   内联样式优先级高于 :hover 规则，写内联会让 hover 反馈整个失效。
   hover 移出不需要单独规则——transition 自动反向播放。 ── */
.dpp-bar{
  border:1px solid var(--dpl-panel-border);
  background:var(--dpl-panel-bg);
  color:var(--dpl-fg);
  box-shadow:var(--dpl-shell-shadow);
  transition:transform .28s cubic-bezier(.32,.72,0,1),box-shadow .28s cubic-bezier(.32,.72,0,1),
    border-color .28s ease,background-color .28s ease;
}
.dpp-bar:hover{
  transform:translateY(-2px);
  box-shadow:var(--dpl-shell-shadow-hover);
  border-color:color-mix(in srgb,var(--dpl-fg) 20%,transparent);
  background:color-mix(in srgb,var(--dpl-panel-bg) 94%,var(--dpl-fg));
}
.dpp-bar:active{transform:translateY(0) scale(.985)}
.dpp-bar:focus-visible{outline:2px solid var(--dpl-fg);outline-offset:2px}
/* 箭头 hover 右移、灯泡 hover 微倾放大（与悬浮胶囊 dpl-chev 同节奏的微交互）。 */
.dpp-bar .dpp-chev{transition:transform .28s cubic-bezier(.32,.72,0,1),color .2s ease}
.dpp-bar:hover .dpp-chev{transform:translateX(2px);color:var(--dpl-fg)}
.dpp-bar .dpp-bulb{transition:transform .28s cubic-bezier(.32,.72,0,1)}
.dpp-bar:hover .dpp-bulb{transform:scale(1.15) rotate(-8deg)}
/* 卡片挂载入场：只淡入不位移——弹窗 portal 挂在本容器内用 fixed 定位，
   祖先留 transform 会把 fixed 变成相对定位（弹窗错位）。 */
@keyframes dppCardIn{from{opacity:0}to{opacity:1}}
[data-dpp-card]{animation:dppCardIn .45s ease backwards}
/* 进行中常态：有条目时呼吸辉光（hover / 一次性动画期间让位，避免抢通道）。 */
@keyframes dppBreath{0%,100%{box-shadow:var(--dpl-shell-shadow)}50%{box-shadow:var(--dpl-shell-shadow-unread)}}
.dpp-bar[data-state="running"]:not(:hover):not(.dpp-fx-start):not(.dpp-fx-done){
  animation:dppBreath 2.6s ease-in-out infinite;
}
/* 状态过渡一次性动画：任务开始 = 弹性 pop；有新完成 = 轻弹跳 + 绿色高亮扫过。
   由组件在计数变化时挂 .dpp-fx-* 类、动画窗口结束后摘除（见 sidebar-card）。 */
@keyframes dppFxStart{0%{transform:scale(.92);opacity:.55}55%{transform:scale(1.04);opacity:1}100%{transform:scale(1)}}
@keyframes dppFxDone{
  0%{transform:translateY(0);box-shadow:var(--dpl-shell-shadow)}
  25%{transform:translateY(-3px);box-shadow:0 0 0 3px color-mix(in srgb,var(--dpl-ok) 38%,transparent),var(--dpl-shell-shadow-unread)}
  60%{transform:translateY(0)}
  100%{transform:translateY(0);box-shadow:var(--dpl-shell-shadow)}
}
.dpp-bar.dpp-fx-start{animation:dppFxStart .55s cubic-bezier(.32,.72,0,1)}
.dpp-bar.dpp-fx-done{animation:dppFxDone .85s cubic-bezier(.32,.72,0,1)}
/* 条上文案 / 图标 / 徽标随内容切换淡入弹跳（组件用 key 变化重挂载触发）。 */
@keyframes dppSwapIn{0%{transform:scale(.4);opacity:0}60%{transform:scale(1.08);opacity:1}100%{transform:scale(1)}}
.dpp-bar-label{animation:dpLineIn .3s cubic-bezier(.32,.72,0,1) backwards}
.dpp-icon-swap{display:inline-flex;animation:dppSwapIn .45s cubic-bezier(.32,.72,0,1) backwards}
.dpp-badge-pop{animation:dpPop .35s cubic-bezier(.32,.72,0,1)}
/* 面板滚动条：最细细条（3px、无轨道、无上下箭头按钮）——作用于面板本身
   与内部所有可滚动元素（记录卡内的 <pre> 全文等）。
   ⚠ 不能同时写标准 scrollbar-width/scrollbar-color：现代 Chromium 一旦
   设置标准滚动条属性就会整体忽略 ::-webkit-scrollbar 样式，退回原生
   （带上下箭头）。此处只走 webkit 伪元素路径。 */
.dsh-done-pill [role="dialog"]::-webkit-scrollbar,
.dsh-done-pill [role="dialog"] *::-webkit-scrollbar{width:3px;height:3px}
.dsh-done-pill [role="dialog"]::-webkit-scrollbar-thumb,
.dsh-done-pill [role="dialog"] *::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--dpl-fg) 25%,transparent);border-radius:1.5px}
.dsh-done-pill [role="dialog"]::-webkit-scrollbar-track,
.dsh-done-pill [role="dialog"] *::-webkit-scrollbar-track{background:transparent}
.dsh-done-pill [role="dialog"]::-webkit-scrollbar-button,
.dsh-done-pill [role="dialog"] *::-webkit-scrollbar-button{display:none;height:0;width:0}
/* ── 录屏按钮（rec-button.tsx）：待机 hover 浮现底 + 轻放大；录制中红点
   呼吸光环 + 计时淡入；编码中 spinner 自转。颜色全走 --dpl-* 变量随主题。
   ⚠ 表面属性写在类上而非内联（内联优先级高于 :hover，会让反馈失效）。 ── */
.dpl-rec-btn{
  position:relative;
  transition:background-color .18s ease,color .18s ease,transform .18s cubic-bezier(.32,.72,0,1);
}
.dpl-rec-btn:hover:not(:disabled){background:var(--dpl-accent-soft);transform:scale(1.06)}
.dpl-rec-btn:active:not(:disabled){transform:scale(.94)}
.dpl-rec-btn:focus-visible{outline:2px solid var(--dpl-fg);outline-offset:1px}
.dpl-rec-btn:disabled{cursor:default;opacity:.5}
.dpl-rec-icon{position:relative;display:inline-flex;align-items:center;justify-content:center;color:var(--dpl-fg-dim)}
.dpl-rec-label{animation:dpLineIn .28s cubic-bezier(.32,.72,0,1) backwards;color:var(--dpl-fg-dim)}
/* 待机图标 hover 微亮。 */
.dpl-rec-btn:hover:not(:disabled) .dpl-rec-icon{color:var(--dpl-fg)}
/* 录制中：红点语义色 + 呼吸光环（::before 环从中心扩散淡出）。 */
.dpl-rec-btn[data-state="recording"]{color:#e5484d}
.dpl-rec-btn[data-state="recording"] .dpl-rec-icon{color:#e5484d}
.dpl-rec-btn[data-state="recording"] .dpl-rec-label{color:#e5484d}
.dpl-rec-btn[data-state="recording"] .dpl-rec-icon::before{
  content:'';position:absolute;left:50%;top:50%;width:100%;height:100%;
  border-radius:50%;transform:translate(-50%,-50%);
  background:radial-gradient(circle,#e5484d 0%,transparent 70%);
  animation:dplRecPulse 1.5s ease-out infinite;pointer-events:none;
}
.dpl-rec-stop{display:block;border-radius:2px;background:currentColor}
/* 编码中：spinner 匀速自转。 */
.dpl-rec-btn[data-state="encoding"] .dpl-rec-icon{color:var(--dpl-fg-dim);animation:dplRecSpin .8s linear infinite}
/* 弹窗头部的录制状态芯片：红点脉冲 + 计时；编码中 spinner 自转。 */
.dpl-rec-chip{animation:dpLineIn .28s cubic-bezier(.32,.72,0,1) backwards}
.dpl-rec-chip-dot{position:relative;flex:none;width:7px;height:7px;border-radius:50%;background:#e5484d}
.dpl-rec-chip-dot::after{content:'';position:absolute;inset:-4px;border-radius:50%;border:1.5px solid #e5484d;animation:dplRecChipPing 1.5s cubic-bezier(0,0,.2,1) infinite}
.dpl-rec-chip-spin{display:inline-flex;animation:dplRecSpin .8s linear infinite}
@keyframes dplRecChipPing{0%{transform:scale(.5);opacity:.9}100%{transform:scale(1.3);opacity:0}}
@keyframes dplRecPulse{0%{opacity:.55;transform:translate(-50%,-50%) scale(.6)}100%{opacity:0;transform:translate(-50%,-50%) scale(2.2)}}
@keyframes dplRecSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
/* 录屏框选 overlay（rec-region-overlay.tsx）：遮罩淡入、选框出现时轻微放大、
   尺寸标签滑动、手柄 hover 放大、底部操作条上浮、提示点脉冲。
   全部用 transform/opacity，不触发重排（拖拽时每帧都在重绘选框）。 */
.dpl-region-handle{transition:transform .12s cubic-bezier(.32,.72,0,1),box-shadow .12s ease}
.dpl-region-handle:hover{transform:scale(1.25)}
/* 操作条：抬一层并给按钮留出点击面。它必须是根层的 pointerdown 盲区
   （组件里 stopPropagation）——否则根层会把指针捕获走，两个按钮的 click
   会被吞掉（真机 bug：点「开始录制」没反应，只有 Enter 有用）。 */
.dpl-region-bar{pointer-events:auto}
.dpl-region-bar button{position:relative;z-index:1}
.dpl-region-go{transition:transform .12s cubic-bezier(.32,.72,0,1),filter .12s ease}
.dpl-region-go:hover{transform:translateY(-1px);filter:brightness(1.06)}
.dpl-region-go:active{transform:translateY(0) scale(.97)}
@keyframes dplRegionIn{from{opacity:0}to{opacity:1}}
@keyframes dplRegionFade{from{opacity:0}to{opacity:1}}
@keyframes dplRegionPick{from{opacity:.4;transform:scale(1.02)}to{opacity:1;transform:none}}
@keyframes dplRegionPulse{0%{box-shadow:0 0 0 0 rgba(229,72,77,.55)}100%{box-shadow:0 0 0 7px rgba(229,72,77,0)}}
@media (prefers-reduced-motion:reduce){
  .dpl-region-handle,.dpl-region-go{transition:none}
  .dpl-region-handle:hover{transform:none}
}
/* 录屏设置行：帧率滑杆（焦点光环 + 数值跳动）与档位刻度条。
   刻度条宽 160 与 sizeSliderStyle 同宽，滑杆的拇指行程 = 宽度 - 16px 拇指，
   所以内轨左右各留 8px，刻度才与拇指位置对齐。 */
.dpl-rec-slider{position:relative;flex:none;display:flex;flex-direction:column;gap:7px;width:160px}
.dpl-rec-slider-row{display:flex;align-items:center;gap:10px}
.dpl-rec-slider input[type=range]{position:relative;z-index:1;transition:filter .2s ease}
.dpl-rec-slider input[type=range]:focus-visible{outline:none;filter:drop-shadow(0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary) 34%,transparent))}
.dpl-rec-slider input[type=range]:active{filter:brightness(1.08)}
.dpl-rec-slider .dpl-rec-fps-val{animation:dplFpsPop .24s cubic-bezier(.32,.72,0,1)}
@keyframes dplFpsPop{0%{transform:scale(.9);opacity:.5}60%{transform:scale(1.06)}100%{transform:scale(1);opacity:1}}
.dpl-rec-fps-ticks{position:relative;height:14px;width:160px;margin-left:-8px;padding:0 8px}
.dpl-rec-fps-ticks::before{content:'';position:absolute;left:8px;right:8px;top:3px;height:2px;border-radius:1px;background:var(--dsw-alias-border-l2)}
.dpl-rec-fps-fill{position:absolute;left:8px;top:3px;height:2px;border-radius:1px;width:calc(var(--dpl-fps-pct) * .88);max-width:calc(100% - 16px);background:var(--dsw-alias-state-business-primary);transition:width .22s cubic-bezier(.32,.72,0,1)}
.dpl-rec-fps-tick{position:absolute;top:0;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:2px;font-size:9px;line-height:9px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary);transition:color .2s ease,transform .2s cubic-bezier(.32,.72,0,1)}
.dpl-rec-fps-tick::before{content:'';width:2px;height:6px;border-radius:1px;background:currentColor;opacity:.45}
.dpl-rec-fps-tick[data-on="1"]{color:var(--dsw-alias-state-business-primary)}
.dpl-rec-fps-tick[data-on="1"]::before{opacity:1}
.dpl-rec-fps-tick[data-on="1"]:last-child,.dpl-rec-fps-tick[data-on="1"]:nth-last-child(2){font-weight:600}
@media (prefers-reduced-motion:reduce){
  .dpl-rec-btn,.dpl-rec-btn:hover:not(:disabled){transform:none}
  .dpl-rec-btn[data-state="recording"] .dpl-rec-icon::before{animation:none;opacity:.35}
  .dpl-rec-btn[data-state="encoding"] .dpl-rec-icon{animation:none}
  .dpl-rec-slider .dpl-rec-fps-val,.dpl-rec-fps-fill,.dpl-rec-fps-tick{animation:none;transition:none}
}
`

// ---- 样式（配色跟随主题：颜色全部走 .dsh-done-pill 上的 --dpl-* 变量 +
// 官方主题令牌，浅色下白底深字、深色下深底浅字；变量定义见上方 PILL_CSS）----
//
// ## 两个缩放维度（正交，互不覆盖）
//
//  `--dps`  **胶囊大小**：用户在本插件设置里自设的缩放（0.65–1.6），
//           管「这个胶囊整体多大」。
//  `--dpt`  **字号比例**：跟官方「设置 → 字号」走（10/14 – 22/14，钳 0.72–1.6），
//           由 font-axis.ts 订阅官方变量后注入，管「文字多大」。
//
// 改造前只有 `--dps`：把官方正文字号从 14 调到 20，胶囊文字一个像素都不动，
// 与旁边已经变大的正文摆在同一屏里像两套界面。现在**字号类**的量一律写成
// `calc(基线 × var(--dps) × var(--dpt))`，两个维度叠乘；
// **几何类**的量（高度/内距/圆角/徽章）仍只跟 `--dps`——胶囊大小是用户
// 自己的显式选择，不该被官方字号二次放大。
//
// 不用 transform scale（非整数渲染会发糊）。

/**
 * 悬停容器：包住胶囊 + 滑出面板，保证两者间移动鼠标不丢 hover；也是拖拽手柄。
 *
 * `ratio` = 官方字号比例（见上方「两个缩放维度」）：**只有字号类的量**乘它，
 * 几何量（高度/内距/圆角）仍只走 `--dps`。它同时也决定胶囊外壳高度
 * （见 `PILL_H` 的说明与 `pillHeight`），所以高度那边也要同一份 ratio。
 */
const wrapStyle = (
  dragging: boolean,
  pos: PillPos | null,
  scale: number,
  ratio: number,
  fontStack: string,
): CSSProperties => ({
  position: 'fixed',
  // pos 恒为整数像素（挂载后由 useLayoutEffect 把居中模式换算成整数坐标）：
  // translateX(-50%) 居中会落在半像素上，文字亚像素渲染发糊。
  // null 仅存在于首帧（绘制前即被 useLayoutEffect 修正）。
  ...(pos === null
    ? { top: defaultShellTop(), left: '50%', transform: 'translateX(-50%)' }
    : { top: pos.y, left: pos.x }),
  zIndex: 9400,
  cursor: dragging ? 'grabbing' : 'grab',
  userSelect: 'none',
  touchAction: 'none',
  ...(fontStack !== '' ? { fontFamily: fontStack } : {}),
  '--dps': String(scale),
  '--dpt': String(ratio),
  letterSpacing: '-0.01em',
  WebkitFontSmoothing: 'antialiased',
  // 上下内衬各 8px：面板贴着 padding box 定位（下方 top:100% / 上方
  // bottom:100%），胶囊与面板之间的视觉缝隙落在容器内，鼠标滑过去不会触发
  // mouseleave。marginTop 抵消上内衬——外壳本体仍精确落在 pos.y，拖拽与
  // 锚点换算都以**外壳**矩形为基准（见 onPointerDown 用 shellRef 取 rect）。
  paddingTop: 'calc(8px * var(--dps))',
  paddingBottom: 'calc(8px * var(--dps))',
  marginTop: 'calc(-8px * var(--dps))',
  // 核心动画：left 与外壳 width 同节奏（MORPH_DUR）过渡。位置按目标宽
  // 一步算准（见 syncPosition），Δw 的过渡期里左缘滑动的量恒为
  // ∓Δw/2，与右缘对称——胶囊呈「两侧拉伸 / 两侧收窄」，而不是先单边
  // 伸缩、再瞬移回中。拖拽中必须关闭，否则位置被过渡拖着走、毫无跟手性。
  ...(dragging ? {} : { transition: `left ${MORPH_DUR} cubic-bezier(.32,.72,0,1)` }),
} as unknown as CSSProperties)

/** 胶囊外壳最大宽度（px）：与 pillShellStyle 的 maxWidth 同源——
 *  居中/锚定计算要复刻同一钳制规则，超宽胶囊的位置才算得准。
 *  v0.2.1：720 → 960，趣味词条（30+ 字）不再被截断（用户反馈「字没有
 *  完全显示出来」）；超出视口时仍以省略号兜底。 */
const SHELL_MAX_W = 960

/** 居中/锚定计算用的「实际渲染宽」：优先取受控目标宽（宽度过渡的终点，
 *  用它算出的坐标才与宽度动画同时抵达），并复刻外壳 maxWidth 的钳制；
 *  尚无目标宽（首帧）时回退实测宽度。 */
function effectiveShellWidth(target: number | null, el: HTMLDivElement | null): number {
  const maxW = Math.min(SHELL_MAX_W, window.innerWidth - 48)
  if (target !== null && target > 0) return Math.min(target, maxW)
  return el !== null ? el.getBoundingClientRect().width : 160
}

/** 胶囊外壳：只管几何（尺寸/圆角/受控宽度）。表面色、描边、文字色、投影与
 *  hover/未读态一律由样式表 .dsh-done-pill-shell 提供——内联写死
 *  background:'transparent' + 白字曾造成两个 bug：① 优先级高于样式表，
 *  把常态底色整个盖掉（胶囊只剩一圈辉光）；② 白字在浅色主题下等于隐形。
 *  boxSizing:border-box：受控 width 已含左右各 1px 描边（见宽度测量 +2）。 */
const pillShellStyle = (width: number | null): CSSProperties => ({
  boxSizing: 'border-box',
  position: 'relative',
  display: 'flex',
  alignItems: 'stretch',
  // 高度也要乘 --dpt：字号调大后文字变高，外壳若保持 40px 会把文字夹住；
  // 且 JS 侧的 pillHeight() 是同一个公式（拖拽钳制/中心锚点靠它算坐标）。
  height: `calc(${PILL_H}px * var(--dps) * var(--dpt, 1))`,
  maxWidth: `min(${SHELL_MAX_W}px, calc(100vw - 48px))`,
  ...(width !== null ? { width } : {}),
  borderRadius: 'calc(12px * var(--dps))',
  // 字号乘上官方字号比例（--dpt）；几何量不乘（见上方「两个缩放维度」）。
  fontSize: 'calc(13.5px * var(--dps) * var(--dpt, 1))',
  lineHeight: 'calc(20px * var(--dps) * var(--dpt, 1))',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  // 宽度伸缩与位置滑动/文字淡入同节奏（MORPH_DUR）；颜色类过渡也写在内联，
  // 否则内联 transition 会整条覆盖样式表里的 transition。
  transition: `width ${MORPH_DUR} cubic-bezier(.32,.72,0,1), box-shadow .22s cubic-bezier(.32,.72,0,1), color .14s ease, transform .22s cubic-bezier(.32,.72,0,1)`,
})

/** 胶囊主体（点击 = 进入最新完成的会话；按住拖动 = 移动胶囊）。
 *  左内边距 20px、右 22px，徽章与文字间距 12px。 */
const pillMainStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'calc(10px * var(--dps))',
  minWidth: 0,
  padding: '0 calc(18px * var(--dps)) 0 calc(15px * var(--dps))',
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontWeight: 'inherit',
  cursor: 'inherit',
  overflow: 'hidden',
}

/** 未读徽章（极简）：实心墨点，替代旧蓝底白勾块。 */
const checkBadgeStyle: CSSProperties = {
  flex: 'none',
  width: 'calc(7px * var(--dps))',
  height: 'calc(7px * var(--dps))',
  borderRadius: '50%',
  display: 'inline-flex',
  background: 'var(--dpl-fg)',
  animation: 'dpPop .35s cubic-bezier(.32,.72,0,1)',
}

/** 灯泡徽章容器：单色线稿（底色走 .dpl-bulb-badge，极简无环）。 */
const bulbBadgeStyle: CSSProperties = {
  flex: 'none',
  position: 'relative',
  width: 'calc(22px * var(--dps))',
  height: 'calc(22px * var(--dps))',
  borderRadius: '50%',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
}

/** 健康提醒徽章（左段芯片）：橙色月亮 + 橙字，常驻胶囊最左侧。 */
const reminderBadgeStyle: CSSProperties = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 'calc(7px * var(--dps))',
  padding: '0 calc(20px * var(--dps)) 0 calc(17px * var(--dps))',
  color: 'var(--dpl-warn)',
  fontSize: 'calc(13.5px * var(--dps) * var(--dpt, 1))',
  lineHeight: 'calc(20px * var(--dps) * var(--dpt, 1))',
  fontWeight: 500,
}

type ReminderIconKind = 'moon' | 'coffee'

/** 月亮（凌晨提醒）：单色填充，随容器 currentColor（暖赭语义色）。 */
function MoonIcon(props: { size?: number }): JSX.Element {
  const size = props.size ?? 18
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ flex: 'none' }}>
      <path d="M21 14.5A9.2 9.2 0 1 1 9.5 3a7.2 7.2 0 0 0 11.5 11.5Z" fill="currentColor" />
    </svg>
  )
}

/** 咖啡图标（休息提醒态）：单色暖橙线性图标。 */
function CoffeeIcon(props: { size?: number }): JSX.Element {
  const size = props.size ?? 18
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: 'none' }}
    >
      <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
      <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
      <line x1="7" y1="2" x2="7" y2="5" />
      <line x1="12" y1="2" x2="12" y2="5" />
    </svg>
  )
}

/**
 * 灯泡徽章（主文案图标）：单色线稿灯泡，无底无环（极简）。
 * @param props.scale - 「胶囊大小」系数。
 * @param props.ratio - 官方字号比例（与字号走同一份，见 `iconSize`）。
 */
function BulbBadge(props: { scale: number; ratio: number }): JSX.Element {
  const icon = iconSize(13.5, 11, props.scale, props.ratio)
  return (
    <span className="dpl-bulb-badge" style={bulbBadgeStyle} aria-hidden>
      <svg
        width={icon} height={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}
      >
        <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
        <line x1="9.5" y1="17" x2="14.5" y2="17" />
        <line x1="10.5" y1="20" x2="13.5" y2="20" />
      </svg>
    </span>
  )
}

/** 右箭头（>）：胶囊末端「可点击进入」提示。 */
function ChevronIcon(props: { size?: number }): JSX.Element {
  const size = props.size ?? 13
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: 'none' }}
    >
      <path d="m9 5 7 7-7 7" />
    </svg>
  )
}

/** 主体与左块之间的细分隔线（复刻参考稿的浅灰竖线）。
 *  ⚠ 不能用 margin 做左右间距：外壳宽度测量用 getBoundingClientRect
 *  （不含 margin），会给外壳算窄 24px/条，主按钮右内边距被 overflow
 *  裁掉（v0.2.4 修复：间距并入自身 width）。 */
const pillDividerStyle: CSSProperties = {
  flex: 'none',
  width: 'calc(17px * var(--dps))',
  alignSelf: 'stretch',
  // ⚠ 必须是 background-image（linear-gradient 充当 1px 竖线）：
  //  background 简写里的颜色会铺满整个元素，position/size 只对图片生效——
  //  写成纯色会把整条分隔 span 染成灰柱（v0.6.0 实测翻车）。
  background: 'linear-gradient(var(--dpl-divider), var(--dpl-divider)) center / 1px 60% no-repeat',
}

/** shell 直接子项统一禁止收缩：宽度测量（子块求和）才不受受控宽度污染。 */
const shellChildStyle: CSSProperties = { flex: 'none' }

/** 记录面板宽度（视口溢出保护计算用）。 */
const DONE_PANEL_W = 600
/** 运行中任务面板宽度。 */
const RUN_PANEL_W = 320

/** 悬停滑出面板的公共骨架：面板底 + 发丝边 + 轻投影，
 *  `up` = 向上翻转（胶囊被拖到视口下半时，面板改从上方滑出，否则会掉出
 *  屏幕底部且无法滚动到）。滑入方向随之取反，动画方向与位置一致。 */
const floatPanelStyle = (
  open: boolean,
  shiftX: number,
  up: boolean,
  width: number,
  maxHeight: string,
  gap: number,
  padding: number,
  radius: number,
): CSSProperties => ({
  position: 'absolute',
  ...(up ? { bottom: '100%' } : { top: '100%' }),
  left: shiftX,
  width: `min(${width}px, calc(100vw - 24px))`,
  maxHeight,
  overflowY: 'auto',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap,
  padding,
  borderRadius: radius,
  border: '1px solid var(--dpl-panel-border)',
  background: 'var(--dpl-panel-bg)',
  color: 'var(--dpl-fg)',
  boxShadow: 'var(--dpl-panel-shadow)',
  opacity: open ? 1 : 0,
  transform: `translateY(${open ? 0 : (up ? 8 : -8)}px) scale(${open ? 1 : .98})`,
  visibility: open ? 'visible' : 'hidden',
  pointerEvents: open ? 'auto' : 'none',
  // 收起时 visibility 延迟到过渡结束再隐藏，滑出动画才完整可见。
  transition: open
    ? 'opacity .26s cubic-bezier(.32,.72,0,1), transform .26s cubic-bezier(.32,.72,0,1), visibility 0s'
    : 'opacity .18s ease, transform .18s ease, visibility 0s linear .18s',
})

/** 记录面板：悬停主体时滑出（墨线标题 + 空状态线稿/列表）。 */
const panelStyle = (open: boolean, shiftX: number, up: boolean): CSSProperties =>
  floatPanelStyle(open, shiftX, up, DONE_PANEL_W, 'min(66vh, 640px)', 0, 0, 20)

/** 运行中任务面板：悬停左侧计数块时滑出的窄列表。 */
const runPanelStyle = (open: boolean, shiftX: number, up: boolean): CSSProperties =>
  floatPanelStyle(open, shiftX, up, RUN_PANEL_W, 'min(60vh, 480px)', 4, 12, 16)

/** 胶囊左侧「运行中」区块：转圈弧线 + 数量，悬停滑出任务列表。 */
const runningBlockStyle = (hasRunning: boolean): CSSProperties => ({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 'calc(8px * var(--dps))',
  padding: '0 calc(12px * var(--dps)) 0 calc(14px * var(--dps))',
  border: 'none',
  background: 'transparent',
  color: hasRunning ? 'var(--dpl-fg)' : 'var(--dpl-fg-weak)',
  font: 'inherit',
  fontWeight: hasRunning ? 500 : 400,
  cursor: 'pointer',
})

/** 运行中指示容器：SVG 笔画自带尺寸与颜色（见 status-orbit.tsx）。 */
const runOrbStyle: CSSProperties = { flex: 'none' }

/** 面板内列表项的墨点：面板不参与胶囊缩放，固定 8px 小圆。 */
const panelDotStyle: CSSProperties = {
  flex: 'none',
  width: 7,
  height: 7,
  borderRadius: '50%',
  background: 'var(--dpl-fg-dim)',
}

/**
 * 面板（滑出的记录面板 / 运行中任务面板）的字号。
 *
 * 面板**不参与 `--dps` 缩放**（它是独立浮层，不跟胶囊大小一起胀缩），
 * 但**要跟随官方字号轴**：面板里是成段的会话标题与摘要，字号设置调大了
 * 而面板文字纹丝不动，读起来比胶囊本体还别扭。
 * 这里用 `--dpt`（在 wrap 上注入，两层面板都是它的后代）。
 */
const panelFont = (size: number): string => `calc(${size}px * var(--dpt, 1))`

const runRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--dpl-row-bg)',
  color: 'var(--dpl-fg)',
  fontSize: panelFont(13),
  lineHeight: panelFont(20),
  textAlign: 'left',
  cursor: 'pointer',
}

const runRowTitleStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

/** 运行中任务的实时执行时长（等宽数字避免跳动）。 */
const runRowTimeStyle: CSSProperties = {
  flex: 'none',
  fontSize: panelFont(11),
  color: 'var(--dpl-fg-weak)',
  fontVariantNumeric: 'tabular-nums',
}

// ---- 记录面板 ----

/** 面板头部：短墨线 + 标题 + 右侧计数/链接。 */
const headStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '20px 24px 14px',
}

/** 标题左侧短墨线（极简锚点）。 */
const headBarStyle: CSSProperties = {
  flex: 'none',
  width: 3,
  height: 15,
  borderRadius: 1.5,
  background: 'var(--dpl-fg-dim)',
}

const headTitleStyle: CSSProperties = {
  flex: 'none',
  fontSize: panelFont(17),
  fontWeight: 600,
  lineHeight: panelFont(24),
  color: 'var(--dpl-fg)',
}

const headMetaStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 10,
  whiteSpace: 'nowrap',
  textAlign: 'right',
  fontSize: panelFont(13),
  lineHeight: panelFont(20),
  color: 'var(--dpl-fg-dim)',
}

/** 「点击卡片进入会话」链接；无记录时禁用变灰。 */
const headLinkStyle: CSSProperties = {
  flex: 'none',
  border: 'none',
  background: 'transparent',
  padding: 0,
  margin: 0,
  fontSize: panelFont(13),
  lineHeight: panelFont(20),
  color: 'var(--dpl-fg)',
  textDecoration: 'underline',
  textUnderlineOffset: '3px',
  textDecorationColor: 'var(--dpl-fg-weak)',
  cursor: 'pointer',
}

/** 记录卡（列表行）：浅墨底圆角卡 + hover 左描边。 */
const cardStyle: CSSProperties = {
  border: 'none',
  borderRadius: 10,
  padding: '10px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  cursor: 'pointer',
  background: 'var(--dpl-row-bg)',
  textAlign: 'left',
}

const cardHeadStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
}

/** 卡片内未读点：墨色小圆（无光环）。 */
const unreadDotStyle: CSSProperties = {
  flex: 'none',
  width: 7,
  height: 7,
  borderRadius: '50%',
  background: 'var(--dpl-fg)',
}

const sessionTitleStyle: CSSProperties = {
  flex: 'none',
  maxWidth: 340,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: panelFont(14),
  fontWeight: 500,
  color: 'var(--dpl-fg)',
}

const metaStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  textAlign: 'right',
  fontSize: panelFont(12),
  color: 'var(--dpl-fg-weak)',
  whiteSpace: 'nowrap',
}

const closeStyle: CSSProperties = {
  flex: 'none',
  width: 22,
  height: 22,
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  color: 'var(--dpl-fg-weak)',
  fontSize: panelFont(13),
  /* 行高也走 panelFont：字号跟到 22px 档时（面板 17px 宽），行高若钉在 22px
     会让关闭按钮的 ✕ 偏上而不是居中。 */
  lineHeight: panelFont(22),
  cursor: 'pointer',
}

const answerStyle: CSSProperties = {
  margin: 0,
  maxHeight: 240,
  overflowY: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontSize: panelFont(12.5),
  lineHeight: panelFont(20),
  color: 'var(--dpl-fg-dim)',
  borderTop: '1px solid var(--dpl-divider)',
  paddingTop: 8,
  // 字体族显式跟随容器：<pre> 默认 monospace，会无视胶囊字体设置。
  fontFamily: 'inherit',
}

const errorTagStyle: CSSProperties = {
  flex: 'none',
  fontSize: panelFont(12),
  lineHeight: panelFont(20),
  color: 'var(--dpl-warn)',
}

/** 运行面板的空态小字。 */
const emptyStyle: CSSProperties = {
  padding: '14px 8px',
  textAlign: 'center',
  fontSize: panelFont(12),
  color: 'var(--dpl-fg-weak)',
}

/** 记录面板空状态容器：线稿插画 + 提示文字（极简，无装饰层）。 */
const emptyStateStyle: CSSProperties = {
  position: 'relative',
  minHeight: 220,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  padding: '26px 20px 30px',
  color: 'var(--dpl-fg-weak)',
}

/** 空状态提示文字：纯次级色文案，不再包胶囊底。字号走 panelFont（面板不参与 --dps）。 */
const captionPillStyle: CSSProperties = {
  position: 'relative',
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '0 12px',
  color: 'var(--dpl-caption-fg)',
  fontSize: panelFont(13.5),
  lineHeight: panelFont(22),
  whiteSpace: 'nowrap',
}

/** 空状态插画：极简单色线稿（两只对话气泡，继承容器文字灰阶）。 */
function EmptyIllustration(): JSX.Element {
  return (
    <svg
      width={200} height={112} viewBox="0 0 200 112" aria-hidden style={{ flex: 'none' }}
      preserveAspectRatio="xMidYMid meet"
      fill="none" stroke="currentColor" strokeWidth={1.5}
      strokeLinecap="round" strokeLinejoin="round"
    >
      {/* 后层气泡（淡） */}
      <rect x="20" y="12" width="104" height="64" rx="16" opacity="0.45" />
      <path d="M42 76 L38 90 L54 78" opacity="0.45" />
      {/* 前层气泡（面板底色挖白）+ 三点 */}
      <rect x="76" y="34" width="104" height="64" rx="16" fill="var(--dpl-panel-bg)" />
      <circle cx="110" cy="66" r="3" fill="currentColor" stroke="none" opacity="0.8" />
      <circle cx="128" cy="66" r="3" fill="currentColor" stroke="none" opacity="0.55" />
      <circle cx="146" cy="66" r="3" fill="currentColor" stroke="none" opacity="0.3" />
    </svg>
  )
}

/** 记录列表容器（有记录时）：行间距与上下留白。 */
const listStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '2px 20px 24px',
}

// ---- 基础设置行（与 General 区条目一致的 Setting-Cell 布局）----

const rowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '16px 0',
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
}
const rowTextStyle: CSSProperties = {
  flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, paddingRight: 48,
}
const rowTitleStyle: CSSProperties = { fontSize: 14, fontWeight: 400, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)' }
const rowDescStyle: CSSProperties = { fontSize: 12, fontWeight: 400, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }

function switchStyle(on: boolean): CSSProperties {
  return {
    position: 'relative', flex: 'none', width: 40, height: 22, padding: 0,
    border: 'none', borderRadius: 11, cursor: 'pointer',
    // 开启态用品牌蓝（不能用反色的 brand-primary）；关闭态描边底 + 灰钮。
    background: on ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-bg-module-platform)',
    transition: 'background .15s',
  }
}
function knobStyle(on: boolean): CSSProperties {
  return {
    position: 'absolute', top: 2, left: on ? 20 : 2, width: 18, height: 18,
    borderRadius: '50%', background: on ? '#ffffff' : 'var(--dsw-alias-label-tertiary)',
    transition: 'left .15s, background .15s',
  }
}

/** 基础设置行：对话完成胶囊显隐开关。 */
function DonePillRow(): JSX.Element {
  const [on, setOn] = useState(enabledStore.get())
  useEffect(() => enabledStore.subscribe(setOn), [])

  function toggle(): void {
    enabledStore.set(!enabledStore.get())
  }

  return (
    <div style={rowStyle}>
      <div style={rowTextStyle}>
        <div style={rowTitleStyle}>对话完成胶囊</div>
        <div style={rowDescStyle}>总开关：关闭后卡片与悬浮两种形态都隐藏</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="对话完成胶囊"
        onClick={toggle}
        style={switchStyle(on)}
      >
        <span style={knobStyle(on)} />
      </button>
    </div>
  )
}

/** 基础设置行：任务完成提醒（总开关 + 提示音 + 通道状态 + 授权按钮）。 */
function NotifyRow(): JSX.Element {
  const [config, setConfig] = useState(() => notifyStore.get())
  const [channel, setChannel] = useState<NotifyChannel>(() => activeChannel())
  const [asking, setAsking] = useState(false)
  useEffect(() => notifyStore.subscribe(setConfig), [])

  // 通道状态可能随权限变化（用户在别处授权/拒绝），设置面板打开后按需刷新。
  useEffect(() => {
    const timer = window.setInterval(() => { setChannel(activeChannel()) }, 1500)
    return () => { window.clearInterval(timer) }
  }, [])

  const channelText = (): string => {
    if (channel === 'native') return '系统通知已授权，点通知直接进入对应会话'
    if (channel === 'shell') return '壳内由壳子发系统通知（通知中心），点通知回到对应会话'
    return '系统通知未授权，暂用右下角页内提醒卡代替'
  }

  async function ask(): Promise<void> {
    setAsking(true)
    try {
      await requestNativePermission()
      setChannel(activeChannel())
    } finally {
      setAsking(false)
    }
  }

  // 壳内不提供授权按钮：跨源 iframe 里的权限请求会挂起等一个不会出现的
  // 系统弹窗（壳子没有授权 UI），点了只会永远停在「请求中…」。那条路走 host。
  const canAsk = channel === 'card' && !inEmbeddedFrame()

  return (
    <div style={rowStyle}>
      <div style={rowTextStyle}>
        <div style={rowTitleStyle}>任务完成提醒</div>
        <div style={rowDescStyle}>{channelText()}</div>
      </div>
      {canAsk && (
        <button
          type="button"
          onClick={() => { void ask() }}
          disabled={asking}
          style={notifyAskStyle(asking)}
        >
          {asking ? '请求中…' : '启用系统通知'}
        </button>
      )}
      {/* 提示音独立小开关：只要声音不要系统通知（或反之）是常见诉求。 */}
      <button
        type="button"
        role="switch"
        aria-checked={config.sound}
        aria-label="完成提示音"
        title="完成提示音"
        onClick={() => { notifyStore.set({ sound: !notifyStore.get().sound }) }}
        style={soundToggleStyle(config.sound)}
      >
        {config.sound ? <SoundOnIcon /> : <SoundOffIcon />}
      </button>
      <button
        type="button"
        role="switch"
        aria-checked={config.enabled}
        aria-label="任务完成提醒"
        onClick={() => { notifyStore.set({ enabled: !notifyStore.get().enabled }) }}
        style={switchStyle(config.enabled)}
      >
        <span style={knobStyle(config.enabled)} />
      </button>
    </div>
  )
}

/** 提示音小开关：图标钮（与右侧总开关并排，不抢主次）。 */
function soundToggleStyle(on: boolean): CSSProperties {
  return {
    flex: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 30,
    height: 30,
    padding: 0,
    borderRadius: 8,
    border: '1px solid var(--dsw-alias-border-l2)',
    background: on ? 'var(--dsw-alias-bg-layer-1)' : 'transparent',
    color: on ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-tertiary)',
    cursor: 'pointer',
    transition: 'color .15s ease,border-color .15s ease,background-color .15s ease',
  }
}

/** 喇叭（有声）：单色线稿，与胶囊图标同一套语言。 */
function SoundOnIcon(): JSX.Element {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 5L6 9H3v6h3l5 4V5z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  )
}

/** 喇叭（静音）：多一道斜杠。 */
function SoundOffIcon(): JSX.Element {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 5L6 9H3v6h3l5 4V5z" />
      <line x1="16" y1="9" x2="21" y2="15" />
      <line x1="21" y1="9" x2="16" y2="15" />
    </svg>
  )
}

/** 「启用系统通知」小按钮：与设置区其他次级按钮同调（发丝边 + hover 加深）。 */
function notifyAskStyle(busy: boolean): CSSProperties {
  return {
    flex: 'none',
    height: 30,
    padding: '0 12px',
    fontSize: 13,
    lineHeight: '28px',
    borderRadius: 8,
    border: '1px solid var(--dsw-alias-border-l2)',
    background: 'var(--dsw-alias-bg-layer-1)',
    color: 'var(--dsw-alias-label-primary)',
    cursor: busy ? 'default' : 'pointer',
    opacity: busy ? 0.6 : 1,
    transition: 'border-color .15s ease,background-color .15s ease',
  }
}

const timeInputStyle: CSSProperties = {
  flex: 'none',
  width: 96,
  height: 32,
  padding: '0 8px',
  fontSize: 13,
  lineHeight: '22px',
  borderRadius: 8,
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
}

const timeDashStyle: CSSProperties = {
  flex: 'none',
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 13,
}

/** 提醒设置行通用骨架：开关 + 可编辑时间段。 */
function ReminderRow(props: {
  titleText: string
  descText: string
  store: ReminderStore
}): JSX.Element {
  const { titleText, descText, store } = props
  const [config, setConfig] = useState<ReminderConfig>(() => store.get())
  useEffect(() => store.subscribe(setConfig), [])

  function update(patch: Partial<ReminderConfig>): void {
    store.set({ ...store.get(), ...patch })
  }

  return (
    <div style={rowStyle}>
      <div style={rowTextStyle}>
        <div style={rowTitleStyle}>{titleText}</div>
        <div style={rowDescStyle}>{descText}</div>
      </div>
      <input
        type="time"
        value={config.start}
        disabled={!config.enabled}
        aria-label={`${titleText}开始时间`}
        onChange={(event) => { if (event.target.value !== '') update({ start: event.target.value }) }}
        style={{ ...timeInputStyle, opacity: config.enabled ? 1 : 0.45 }}
      />
      <span style={timeDashStyle}>—</span>
      <input
        type="time"
        value={config.end}
        disabled={!config.enabled}
        aria-label={`${titleText}结束时间`}
        onChange={(event) => { if (event.target.value !== '') update({ end: event.target.value }) }}
        style={{ ...timeInputStyle, opacity: config.enabled ? 1 : 0.45 }}
      />
      <button
        type="button"
        role="switch"
        aria-checked={config.enabled}
        aria-label={titleText}
        onClick={() => { update({ enabled: !config.enabled }) }}
        style={{ ...switchStyle(config.enabled), marginLeft: 8 }}
      >
        <span style={knobStyle(config.enabled)} />
      </button>
    </div>
  )
}

/** 设置行下拉选项。 */
interface SettingsSelectOption {
  id: string
  label: string
}

/**
 * 设置行下拉：官方 primitives 的 Menu（按钮触发 + portal 浮层 + 勾选），
 * 与「繁忙时的发送行为」那行同款交互；触发钮样式 .dpl-settings-select 复刻
 * 官方 EnterBehaviorRow 的 selector。原生 <select> 是系统弹层，跟官方视觉不一致。
 */
function SettingsMenuSelect(props: {
  value: string
  options: SettingsSelectOption[]
  ariaLabel: string
  onChange: (id: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const selected = props.options.find(option => option.id === props.value)
  const label = selected !== undefined ? selected.label : props.value
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={props.options.map(option => ({ id: option.id, label: option.label }))}
      selectedId={props.value}
      onSelect={(id: string) => { setOpen(false); props.onChange(id) }}
      align="end"
      portal
      anchor={(
        <button
          type="button"
          className="dpl-settings-select"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={props.ariaLabel}
          onClick={() => { setOpen(prev => !prev) }}
        >
          {label}
          <IconChevronDownOutlineRegular className="dpl-settings-chev" />
        </button>
      )}
    />
  )
}

const sizeSliderStyle: CSSProperties = {
  flex: 'none',
  width: 160,
  accentColor: 'var(--dsw-alias-state-business-primary)',
  cursor: 'pointer',
}

/** 帧率行容器：滑杆 + 刻度条上下叠放，宽度与滑杆一致（160）。 */
const recSliderWrapStyle: CSSProperties = {
  flex: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 7,
  width: 160,
}
const recSliderRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
}
/** 刻度条外框（实际绘制全在 PILL_CSS 的 .dpl-rec-fps-* 里）。 */
const recTicksStyle: CSSProperties = {
  position: 'relative',
  height: 14,
  width: 160,
  marginLeft: -8,
  padding: '0 8px',
}
/** 已点亮刻度段的填充条（宽度由 CSS 的 --dpl-fps-pct 驱动，带过渡）。 */
const recFillStyle: CSSProperties = {
  position: 'absolute',
  left: 8,
  top: 3,
  height: 2,
  borderRadius: 1,
}

const sliderValueStyle: CSSProperties = {
  flex: 'none',
  width: 44,
  textAlign: 'right',
  fontSize: 13,
  color: 'var(--dsw-alias-label-secondary)',
  fontVariantNumeric: 'tabular-nums',
}

/** 基础设置行：胶囊大小（字体等比跟随）。 */
function PillScaleRow(): JSX.Element {
  const [config, setConfig] = useState<AppearanceConfig>(() => appearanceStore.get())
  useEffect(() => appearanceStore.subscribe(setConfig), [])
  const percent = Math.round(config.scale * 100)
  return (
    <div style={rowStyle}>
      <div style={rowTextStyle}>
        <div style={rowTitleStyle}>胶囊大小</div>
        <div style={rowDescStyle}>整体缩放胶囊，字体与图标等比跟随（65% – 160%）</div>
      </div>
      <input
        type="range"
        min={65}
        max={160}
        step={5}
        value={percent}
        aria-label="胶囊大小"
        onChange={(event) => { appearanceStore.set({ ...appearanceStore.get(), scale: Number(event.target.value) / 100 }) }}
        style={sizeSliderStyle}
      />
      <span style={sliderValueStyle}>{`${percent}%`}</span>
    </div>
  )
}

/** 基础设置行：胶囊字体风格。 */
function PillFontRow(): JSX.Element {
  const [config, setConfig] = useState<AppearanceConfig>(() => appearanceStore.get())
  useEffect(() => appearanceStore.subscribe(setConfig), [])
  return (
    <div style={rowStyle}>
      <div style={rowTextStyle}>
        <div style={rowTitleStyle}>胶囊字体</div>
        <div style={rowDescStyle}>胶囊与面板文字的字体风格</div>
      </div>
      <SettingsMenuSelect
        value={config.font}
        options={FONT_OPTIONS.map(option => ({ id: option.id, label: option.label }))}
        ariaLabel="胶囊字体"
        onChange={(id) => { appearanceStore.set({ ...appearanceStore.get(), font: id }) }}
      />
    </div>
  )
}

/**
 * 帧率档位：滑杆步进 1，但停在这些常用档上（滑杆自带 datalist 刻度，拖到位就吸附）。
 * 24 是「网页 GIF 顺手可播」的常规档，60 是 GIF 时间轴本身的上限。
 */
const REC_FPS_STOPS = [4, 12, 24, 30, 60]

/** 帧率档位名（滑杆气泡、数值标签与刻度条共用同一套说法）。 */
function recFpsLabel(fps: number): string {
  if (fps >= REC_FPS_MAX) return `${fps} fps（满帧）`
  if (fps === 24) return `${fps} fps（常规流畅）`
  if (fps === REC_FPS_DEFAULT) return `${fps} fps（默认）`
  return `${fps} fps`
}

/** 基础设置行：录屏帧率（GIF 输出 fps，录制开始前生效；录制中锁定不改）。 */
function RecFpsRow(): JSX.Element {
  const [config, setConfig] = useState<RecConfig>(() => recStore.get())
  useEffect(() => recStore.subscribe(setConfig), [])
  const pct = Math.round(((config.fps - REC_FPS_MIN) / (REC_FPS_MAX - REC_FPS_MIN)) * 100)
  return (
    <div style={rowStyle}>
      <div style={rowTextStyle}>
        <div style={rowTitleStyle}>录屏帧率</div>
        <div style={rowDescStyle}>GIF 帧率（4 – 60 fps）：60 是 GIF 时间轴的上限；越高越流畅，体积涨得越快</div>
      </div>
      <div className="dpl-rec-slider" style={recSliderWrapStyle}>
        <div className="dpl-rec-slider-row" style={recSliderRowStyle}>
          <input
            type="range"
            min={REC_FPS_MIN}
            max={REC_FPS_MAX}
            step={1}
            list="dpl-rec-fps-stops"
            value={config.fps}
            aria-label="录屏帧率"
            aria-valuetext={recFpsLabel(config.fps)}
            title={recFpsLabel(config.fps)}
            onChange={(event) => { recStore.set({ fps: Number(event.target.value) }) }}
            style={sizeSliderStyle}
          />
          <datalist id="dpl-rec-fps-stops">
            {REC_FPS_STOPS.map(stop => <option key={stop} value={stop} label={String(stop)} />)}
          </datalist>
          <span className="dpl-rec-fps-val" style={sliderValueStyle}>{`${config.fps} fps`}</span>
        </div>
        {/* 刻度条：亮到当前帧率为止，滑块经过的档位轻微放大（CSS 读 --dpl-fps-pct 定位）。 */}
        <div
          className="dpl-rec-fps-ticks"
          aria-hidden
          style={{ ...recTicksStyle, ["--dpl-fps-pct" as string]: `${pct}%` }}
        >
          <span className="dpl-rec-fps-fill" style={recFillStyle} />
          {REC_FPS_STOPS.map(stop => {
            const at = Math.round(((stop - REC_FPS_MIN) / (REC_FPS_MAX - REC_FPS_MIN)) * 100)
            return (
              <span
                key={stop}
                className="dpl-rec-fps-tick"
                data-on={config.fps >= stop ? '1' : '0'}
                style={{ left: `${at}%` }}
              >
                {stop}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** 基础设置行：录屏画质（输出宽度档位；0 = 原始分辨率不缩放）。 */
function RecWidthRow(): JSX.Element {
  const [config, setConfig] = useState<RecConfig>(() => recStore.get())
  useEffect(() => recStore.subscribe(setConfig), [])
  const labelOf = (w: number): string => {
    const name = recWidthLabel(w)
    // 最宽档标出「清晰优先」的代价：2560×1440 单帧编码约 44ms，实际帧率会掉到 23 上下。
    return w === 2560 ? `${name} · 清晰优先` : name
  }
  return (
    <div style={rowStyle}>
      <div style={rowTextStyle}>
        <div style={rowTitleStyle}>录屏画质</div>
        <div style={rowDescStyle}>GIF 输出宽度：越高清体积越大（逐帧编码，近似平方级增长）；2K 单帧编码约 44ms、帧率会让步到 23 fps；录制开始前生效</div>
      </div>
      <SettingsMenuSelect
        value={String(config.width)}
        options={REC_WIDTH_OPTIONS.map(w => ({ id: String(w), label: labelOf(w) }))}
        ariaLabel="录屏画质"
        onChange={(id) => { recStore.set({ ...recStore.get(), width: Number(id) }) }}
      />
    </div>
  )
}

const segWrapStyle: CSSProperties = {
  flex: 'none',
  display: 'flex',
  gap: 2,
  padding: 2,
  borderRadius: 9,
  background: 'var(--dsw-alias-bg-module-platform)',
}

function segOptionStyle(activeOption: boolean): CSSProperties {
  return {
    border: 'none',
    cursor: 'pointer',
    padding: '6px 14px',
    borderRadius: 7,
    fontSize: 13,
    lineHeight: '20px',
    fontWeight: activeOption ? 600 : 400,
    background: activeOption ? 'var(--dsw-alias-bg-layer-1)' : 'transparent',
    color: activeOption ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
    boxShadow: activeOption ? '0 1px 2px rgba(0,0,0,.08)' : 'none',
  }
}

/** 基础设置行：胶囊形态（卡片 / 悬浮，二选一，实时切换）。 */
function PillModeRow(): JSX.Element {
  const [pillMode, setPillMode] = useState<PillMode>(() => modeStore.get())
  useEffect(() => modeStore.subscribe(setPillMode), [])
  return (
    <div style={rowStyle}>
      <div style={rowTextStyle}>
        <div style={rowTitleStyle}>胶囊形态</div>
        <div style={rowDescStyle}>卡片：左下角设置上方的小横条，悬停查看进行中与最近完成；悬浮：顶部可拖拽浮窗</div>
      </div>
      <div role="radiogroup" aria-label="胶囊形态" style={segWrapStyle}>
        <button
          type="button"
          role="radio"
          aria-checked={pillMode === 'card'}
          onClick={() => { modeStore.set('card') }}
          style={segOptionStyle(pillMode === 'card')}
        >
          卡片
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={pillMode === 'float'}
          onClick={() => { modeStore.set('float') }}
          style={segOptionStyle(pillMode === 'float')}
        >
          悬浮
        </button>
      </div>
    </div>
  )
}

// ---- 组件 ----

interface DragState {
  px: number
  py: number
  ox: number
  oy: number
  moved: boolean
  /** 按下时所在的功能区（data-dp-zone），决定「点击」落到哪个动作。 */
  zone: string
}

/** 顶部悬浮「对话完成」胶囊：点击进会话、悬停滑出记录、可拖拽、常驻显示。 */
export function DonePill(props: DonePillProps): JSX.Element | null {
  // 按需加载：不订阅 DSH 会话全量 store（state.byId）。任何会话状态变化
  // （如点击会话切换）都会让全量订阅组件重渲染并 Object.values 遍历全部
  // 会话——running/完成数据改由 host 的 /api/dsh-done-pill 增量推送驱动。
  const [entries, setEntries] = useState<DoneEntry[]>([])
  const [readIds, setReadIds] = useState<Set<string>>(() => loadReadIds())
  const [hovered, setHovered] = useState(false)
  const [hoveredRunning, setHoveredRunning] = useState(false)
  const [enabled, setEnabled] = useState(enabledStore.get())
  // 胶囊形态：'card' 时悬浮胶囊隐藏（左下角小横条接管），'float' 时显示。
  const [pillMode, setPillMode] = useState<PillMode>(() => modeStore.get())
  // 注意：initializer 里不能引用下方才声明的 anchorRef（TDZ），直接读存储。
  const [pos, setPos] = useState<PillPos | null>(() => {
    const anchor = loadAnchor()
    // 挂载前无法测实际宽度，用估算宽度 160 定位；挂载后宽度同步 effect 会按中心重放一次。
    // 高度按已持久化的缩放系数 × 官方字号比例推算（不是写死 30），
    // 首帧垂直位置就落在正确处。比例走 store 同步读，不经 state（初始值 TDZ）。
    return anchor === null ? null : anchorToPos(anchor, 160, pillHeight(appearanceStore.get().scale, fontRatioStore.get()))
  })
  const [dragging, setDragging] = useState(false)
  // 正在执行回合的信息（host 下发）：sessionId → { since, question }，
  // question = 当前正在执行的那条用户消息，供任务列表展示。
  const [runInfo, setRunInfo] = useState<Record<string, { since: number; question: string; title: string }>>({})
  // 实时时钟：任务面板展开时每秒走字。
  const [nowTick, setNowTick] = useState(() => Date.now())
  // 健康提醒时钟：每 30 秒刷新当前分钟，判断是否落在提醒时段内。
  const [reminderTick, setReminderTick] = useState(0)
  const [restConfig, setRestConfig] = useState<ReminderConfig>(() => restStore.get())
  const [lateConfig, setLateConfig] = useState<ReminderConfig>(() => lateStore.get())
  // 外观：缩放系数 + 字体风格。
  const [appearance, setAppearance] = useState<AppearanceConfig>(() => appearanceStore.get())
  const scale = appearance.scale
  /*
   * 官方字号比例（见 font-axis.ts）：驱动 `--dpt`、外壳高度与图标尺寸。
   * 单独一个 state 而不是并进 appearance：它与「胶囊大小」是两个正交维度，
   * 真值来自官方设置、本插件只读。
   */
  const [fontRatio, setFontRatio] = useState(() => fontRatioStore.get())
  useEffect(() => fontRatioStore.subscribe(setFontRatio), [])
  // 缩放系数镜像：拖拽/锚点等稳定回调里要读最新值（进依赖数组会让回调重建，
  // 拖拽中重建会丢 pointer capture）。字号比例同理——它同样参与 pillHeight()。
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  const fontRatioRef = useRef(fontRatio)
  fontRatioRef.current = fontRatio
  // 平时轮播：随机开心话术 / AI 名词的下标。
  const [funIdx, setFunIdx] = useState(() => Math.floor(Math.random() * FUN_LINES.length))
  // 胶囊宽度受控值（跟随内容自然宽度平滑过渡）。
  const [shellWidth, setShellWidth] = useState<number | null>(null)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const shellWidthRef = useRef<number | null>(null)
  // 主文案之外的固有宽度（内边距 + 图标 + 分隔线 + 提醒徽章 +
  // 运行中计数块）。文案的 maxWidth 由「外壳上限 − 这个值」算出，才能在
  // 任何组合下都以省略号收尾（写死一个常数在带徽章时会算多，文字仍被硬切）。
  const [decoWidth, setDecoWidth] = useState(80)
  const labelRef = useRef<HTMLSpanElement | null>(null)
  // 增量水位仅存内存：首次 tick 用 0 全量拉（恢复最近记录），之后增量。
  const sinceRef = useRef(0)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  // 「正在执行」面板的左缘锚点：左侧运行中区块相对胶囊左缘的偏移（每渲染实测）。
  const [runBlockLeft, setRunBlockLeft] = useState(0)
  const runBlockRef = useRef<HTMLButtonElement | null>(null)
  // 视口高度（resize 时更新）：决定悬停面板朝下还是朝上滑出。
  // 兜底 900：窗口最小化/离屏时 innerHeight 可能是 0，按 0 判会把面板永久
  // 翻到上方（实测在离屏实例里就是这样）。
  const [viewportH, setViewportH] = useState(() => window.innerHeight || 900)

  // 设置开关：关闭即整体隐藏。
  useEffect(() => enabledStore.subscribe(setEnabled), [])
  useEffect(() => modeStore.subscribe(setPillMode), [])
  useEffect(() => restStore.subscribe(setRestConfig), [])
  useEffect(() => lateStore.subscribe(setLateConfig), [])
  useEffect(() => appearanceStore.subscribe(setAppearance), [])
  // 样式表兜底注入（幂等）：正常路径在 applyDonePill 注册时就注入好了——
  // 必须早于首次渲染，否则外壳先以「无样式」算一遍布局，样式到位时
  // background-color/box-shadow 会走一次过渡淡入（实测在某些环境里首帧
  // 停在透明态上，看着就是「胶囊不见了」）。
  useLayoutEffect(() => { ensurePillKeyframes() }, [])
  useEffect(() => {
    setReminderTick(t => t + 1)
    const timer = window.setInterval(() => { setReminderTick(t => t + 1) }, 10000)
    return () => { window.clearInterval(timer) }
  }, [])

  // 健康提醒激活判断（reminderTick 每 10 秒变化触发重算：分钟切换最多延迟
  // 10 秒，够准；无秒级文案后不再需要 1s 定时器）。
  const nowMinutes = (() => {
    const d = new Date()
    void reminderTick
    return d.getHours() * 60 + d.getMinutes()
  })()
  const lateActive = lateConfig.enabled && inTimeRange(nowMinutes, lateConfig)
  const restActive = !lateActive && restConfig.enabled && inTimeRange(nowMinutes, restConfig)

  // 自动居中模式（从未手动拖拽过）：胶囊宽度随文字变化（任务完成时变长），
  // 固定 left 会偏离居中——每次渲染后按目标宽重算水平居中（见 syncPosition），
  // 并保持整数像素（translateX(-50%) 的半像素会让文字发糊）。
  // 一旦用户拖拽（onPointerUp moved），autoCenterRef 置 false，锁定锚点位置。
  const anchorRef = useRef<PillAnchor | null>(loadAnchor())
  const autoCenterRef = useRef(anchorRef.current === null)

  /**
   * 位置同步（两种模式共用一个入口）：
   *  - 自动居中模式（从未拖拽过）：按当前目标宽水平居中；
   *  - 锁定模式：按持久化的**中心锚点**比率还原位置。
   * 两者都按受控**目标宽**（宽度过渡的终点）计算，而不是实测宽——实测值在
   * 过渡期间是中间值，算出的坐标永远追着动画尾巴；用目标宽则 left 过渡与
   * width 过渡同时抵达终点，合成「两侧对称伸缩」。
   * 相等性检查：位置没变就返回原 state（React bail out），不会死循环。
   *
   * 每次渲染后由下方宽度测量的 layout effect 调用。原实现把居中逻辑挂在
   * ResizeObserver 上，而 RO 的回调派发依赖帧生命周期——离屏/最小化窗口里
   * 帧被冻结时回调不来，胶囊变宽后就一直偏在旧位置（实测偏移半个 Δw）。
   */
  const syncPosition = useCallback((): void => {
    const w = effectiveShellWidth(shellWidthRef.current, shellRef.current)
    if (w <= 0) return
    const h = pillHeight(scaleRef.current, fontRatioRef.current)
    if (autoCenterRef.current) {
      const x = Math.max(8, Math.round((window.innerWidth - w) / 2))
      setPos(prev => {
        const next = { x, y: prev?.y ?? defaultShellTop() }
        return prev !== null && prev.x === next.x && prev.y === next.y ? prev : next
      })
      return
    }
    const anchor = anchorRef.current
    if (anchor === null) return
    const next = anchorToPos(anchor, w, h)
    setPos(prev => (prev !== null && prev.x === next.x && prev.y === next.y ? prev : next))
  }, [])
  useEffect(() => {
    const onResize = (): void => {
      if (window.innerHeight > 0) setViewportH(window.innerHeight)
      syncPosition()
    }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [syncPosition])

  // 合并新条目：按 id 去重、降序、截断上限。
  const mergeEntries = useCallback((incoming: DoneEntry[]): void => {
    if (incoming.length === 0) return
    setEntries(prev => {
      const seen = new Set(prev.map(item => item.id))
      const merged = [...prev]
      for (const item of incoming) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        merged.push(item)
      }
      merged.sort((a, b) => b.seq - a.seq)
      return merged.length > MAX_ENTRIES ? merged.slice(0, MAX_ENTRIES) : merged
    })
  }, [])

  // 轮询 host：增量拉取完成记录。
  //
  // ⚠ **后台也必须继续轮询**。曾经这里写的是 `if (document.hidden) return`
  // （早期为省流量加的优化），结果窗口失焦/最小化/切到别的应用时整轮轮询被跳过
  // → 拿不到新完成条目 → 完成提醒（桌面浮窗 + 音效）**只有在前台才弹**。
  // 那正是用户报的「必须在前台才能弹出通知与音效」。
  //
  // 现在的策略：后台**降频**而不是停掉（前台 3s、后台 10s）。壳子已经关掉了
  // 后台节流（disable-background-timer-throttling / disable-renderer-backgrounding），
  // 所以后台定时器照常跑；即使某次被节流，回前台时 visibilitychange 会立刻补一轮。
  //
  // ⚠ **谁是当前显示的形态，谁才轮询**（避免两份轮询白跑）：
  //   胶囊显示（float）→ 胶囊轮询；卡片显示（card）→ 小横条轮询（见 sidebar-card）。
  //   但**总开关关掉时两个形态都不显示**，那时小横条的 `active` 为 false 也不会
  //   轮询——若胶囊也停掉就没人轮询，完成提醒会整块失效。所以胶囊在
  //   「!enabled」时**兜底继续轮询**（用户把胶囊关了，提醒仍要能用）。
  //   覆盖矩阵：enabled&&float → 胶囊；enabled&&card → 小横条；!enabled → 胶囊兜底。
  const polling = !enabled || pillMode === 'float'
  useEffect(() => {
    if (!polling) return
    let stopped = false
    let inFlight = false
    const tick = (): void => {
      if (inFlight) return
      inFlight = true
      fetch(`/api/dsh-done-pill?since=${sinceRef.current}`, { cache: 'no-store' })
        .then(async (res) => {
          if (!res.ok) throw new Error(`http ${res.status}`)
          return res.json() as Promise<{ ok: boolean; version: number; items: DoneEntry[]; running?: Array<{ sessionId: string; since: number; question?: string; title?: string }>; openSessionId?: string }>
        })
        .then((data) => {
          if (stopped || data?.ok !== true || !Array.isArray(data.items)) return
          // ⚠ 水位必须**跟随 host**，不能用 Math.max 只增不减：
          // host 的 seq 基数 = 进程启动时间戳，服务重启后会换一套基数。若客户端的
          // since 已经大于 host 的 version（多客户端 / 重启竞态 / 上一次水位被推高），
          // `Math.max` 会让 since 永久卡在超出 host 的值上——此后每轮都是
          // `items: []`，表现为「完成提醒再也不出现」（真机抓到 since=…252 而
          // host version=…251，之后所有轮询全空）。
          // 现在直接对齐 host 下发的 version；它本身就是「当前最大 seq」。
          if (typeof data.version === 'number' && Number.isFinite(data.version)) {
            sinceRef.current = data.version
          }
          mergeEntries(data.items.filter(item => item !== null && typeof item === 'object' && typeof item.id === 'string'))
          // 任务完成提醒：由完成条目驱动（模块级去重，两种形态各轮询也只提醒一次）。
          // 传 version 当基线水位——host 刚重启（完成列表为空）时它也能首轮把水位
          // 钉住，否则用户跑完的第一个任务会被当成「首个非空批次」整个吃掉。
          void consumeDoneEntries(data.items, data.version)
            .catch(() => { /* 提醒失败不影响胶囊本体 */ })
          // 壳页面点了系统通知：host 回传一次待跳转会话，这里接管跳转。
          consumeOpenRequest(data.openSessionId)
          if (Array.isArray(data.running)) {
            const next: Record<string, { since: number; question: string; title: string }> = {}
            for (const entry of data.running) {
              if (entry !== null && typeof entry === 'object'
                && typeof entry.sessionId === 'string' && typeof entry.since === 'number') {
                next[entry.sessionId] = {
                  since: entry.since,
                  question: typeof entry.question === 'string' ? entry.question : '',
                  title: typeof entry.title === 'string' ? entry.title : '',
                }
              }
            }
            setRunInfo(next)
          }
        })
        .catch(() => { /* 服务暂不可达时静默，下轮重试 */ })
        .finally(() => { inFlight = false })
    }
    tick()
    // 自适应轮询：前台按 POLL_MS，后台降到 POLL_MS_BACKGROUND（省电/省流量，
    // 但不为 0——为 0 就等于「后台不提醒」，那正是要修的 bug）。
    let timer = 0
    const schedule = (): void => {
      window.clearInterval(timer)
      const interval = document.hidden ? POLL_MS_BACKGROUND : POLL_MS
      timer = window.setInterval(tick, interval)
    }
    schedule()
    // 可见性变化：立刻补一轮，并把轮询频率切到对应档位。
    const onVisibility = (): void => { tick(); schedule() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // polling 进依赖：形态/总开关变化时重挂轮询（切到 float 会立刻 tick 一次，
    // 不会有空白期；切走后停掉，把轮询让给另一个形态）。
  }, [mergeEntries, polling])

  const unreadCount = useMemo(() => entries.filter(item => !readIds.has(item.id)).length, [entries, readIds])
  const latest = entries[0]

  // 轮播（无未读时）：每 FUN_INTERVAL_MS 随机换一条开心话术 / AI 名词。
  // 提醒态**不再暂停**轮播：提醒已独立成左侧徽章、不占主文案，旧实现却仍
  // 按「提醒激活」停掉定时器——设了长时段提醒（如 22:00-07:00）时主文案
  // 整夜冻在同一条上。
  const funIdle = unreadCount === 0
  useEffect(() => {
    if (!funIdle) return
    const timer = window.setInterval(() => {
      setFunIdx(prev => {
        let next = Math.floor(Math.random() * FUN_LINES.length)
        if (next === prev) next = (next + 1) % FUN_LINES.length
        return next
      })
    }, FUN_INTERVAL_MS)
    return () => { window.clearInterval(timer) }
  }, [funIdle])

  // 正在执行中的任务：直接取 host 增量推送的 running 列表（turn/start 入表、
  // turn/end 出表，已排除 subagent），按开始时间降序。不再订阅全量会话
  // store（byId）——那会在任何会话状态变化（如点击会话）时触发本组件
  // 重渲染 + Object.values 全量遍历。
  const runningSessions = useMemo(() => (
    Object.entries(runInfo)
      .map(([sessionId, info]) => ({ id: sessionId, displayTitle: info.title, since: info.since }))
      .sort((a, b) => b.since - a.since)
  ), [runInfo])
  // 镜像：点击回调（稳定引用）里要读最新运行列表，不进依赖数组。
  const runningSessionsRef = useRef(runningSessions)
  runningSessionsRef.current = runningSessions

  const markAllRead = useCallback((): void => {
    setReadIds(prev => {
      const next = new Set(prev)
      for (const item of entries) next.add(item.id)
      saveReadIds(next)
      return next.size === prev.size ? prev : next
    })
  }, [entries])

  // 已读时机 = 面板**关闭**时（看过即已读）。旧实现在 hovered 变 true 的同一
  // 帧就 markAllRead，未读圆点在面板出现的瞬间全部消失，等于看不出哪几条是新的。
  const wasHoveredRef = useRef(false)
  useEffect(() => {
    if (hovered) { wasHoveredRef.current = true; return }
    if (wasHoveredRef.current) {
      wasHoveredRef.current = false
      markAllRead()
    }
  }, [hovered, markAllRead])

  // 实时时钟：运行中任务面板展开时每秒刷新，时长走字。
  useEffect(() => {
    if (!hoveredRunning || runningSessions.length === 0) return
    setNowTick(Date.now())
    const timer = window.setInterval(() => { setNowTick(Date.now()) }, 1000)
    return () => { window.clearInterval(timer) }
  }, [hoveredRunning, runningSessions.length])

  const dismiss = useCallback((id: string): void => {
    setEntries(prev => prev.filter(item => item.id !== id))
    setReadIds(prev => {
      const next = new Set(prev)
      next.add(id)
      saveReadIds(next)
      return next
    })
  }, [])

  const openSession = useCallback((sessionId: string, markReadId?: string): void => {
    // 跳转与失败反馈都在 session-nav 里统一处理（失败会经 navNoticeStore
    // 弹出可见提示条，不再只在 console 留一行 warn）。
    const outcome = openSessionById(sessionId)
    // 失败不标已读：条目仍是「未读」，用户能在胶囊上看到还有待处理的完成。
    if (outcome.ok && markReadId !== undefined) {
      setReadIds(prev => {
        if (prev.has(markReadId)) return prev
        const next = new Set(prev)
        next.add(markReadId)
        saveReadIds(next)
        return next
      })
    }
    setHovered(false)
  }, [])

  // ---- 拖拽（pointer 事件；4px 阈值区分点击与拖动）----

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const el = wrapRef.current
    if (el === null) return
    // 起点必须取**外壳**矩形：wrap 有上下各 8px 内衬（面板缝隙热区），
    // 用 wrap 的 rect.top 会比 pos.y 小 8px，一按下就整体跳一截。
    const rect = (shellRef.current ?? el).getBoundingClientRect()
    const zone = event.target instanceof Element
      ? (event.target.closest('[data-dp-zone]')?.getAttribute('data-dp-zone') ?? '')
      : ''
    dragRef.current = { px: event.clientX, py: event.clientY, ox: rect.left, oy: rect.top, moved: false, zone }
    try { el.setPointerCapture(event.pointerId) } catch { /* 合成事件等场景无有效 pointerId，忽略 */ }
  }, [])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null) return
    const dx = event.clientX - drag.px
    const dy = event.clientY - drag.py
    if (!drag.moved && Math.hypot(dx, dy) < 4) return
    if (!drag.moved) {
      drag.moved = true
      setDragging(true)
      setHovered(false)
      setHoveredRunning(false)
    }
    // 钳制按胶囊**实际尺寸**：宽胶囊（数百 px）以前能被拖到只剩左端露在屏内。
    const w = effectiveShellWidth(shellWidthRef.current, shellRef.current)
    setPos(clampPos(drag.ox + dx, drag.oy + dy, w, pillHeight(scaleRef.current, fontRatioRef.current)))
  }, [])

  /** 指针取消（系统手势打断、设备失联等）：必须清干净拖拽态，
   *  否则 dragRef 常驻非空，之后 hover 被 `dragRef.current === null` 判死，
   *  面板再也展不开（旧实现无此分支，实测能把胶囊「冻」住）。 */
  const onPointerCancel = useCallback((): void => {
    dragRef.current = null
    setDragging(false)
  }, [])

  const onPointerUp = useCallback((): void => {
    const drag = dragRef.current
    dragRef.current = null
    if (drag === null) return
    if (drag.moved) {
      // 用户手动拖拽：退出自动居中，按**胶囊中心点**的视口比率持久化锚点
      // （窗口缩放、内容伸缩时以中心为基准向两侧对称变化）。
      autoCenterRef.current = false
      setDragging(false)
      setPos(current => {
        if (current !== null) {
          const el = shellRef.current
          const w = el !== null ? el.getBoundingClientRect().width : 160
          const h = pillHeight(scaleRef.current, fontRatioRef.current)
          const anchor: PillAnchor = {
            xc: clamp01((current.x + w / 2) / Math.max(1, window.innerWidth)),
            yc: clamp01((current.y + h / 2) / Math.max(1, window.innerHeight)),
          }
          anchorRef.current = anchor
          saveAnchor(anchor)
        }
        return current
      })
      return
    }
    // 未超过阈值 = 点击。按下时所在区域决定动作：
    //  - 'run'（运行中计数块）：进入正在执行的那个会话（多个时进最新开始的）；
    //    旧实现无论点哪里都跳「最新完成的会话」——点运行中计数会跳到一个
    //    毫不相关的已完成会话，属于明显的误跳。
    //  - 'rec'（录屏按钮）：开始/停止录屏（GIF）；
    //  - 其他（主体/提醒徽章）：进入最新完成的会话。
    if (drag.zone === 'run') {
      const first = runningSessionsRef.current[0]
      if (first !== undefined) openSession(first.id)
      return
    }
    if (drag.zone === 'rec') {
      recorder.toggle()
      return
    }
    if (latest !== undefined) openSession(latest.sessionId, unreadCount > 0 ? latest.id : undefined)
  }, [latest, openSession, unreadCount])

  const latestTitle = latest !== undefined ? latest.title : ''

  // 胶囊主文本：显示刚完成的那条对话消息（而非会话标题/AI 回复）；
  // 无消息时回退标题。
  const latestLabel = latest !== undefined
    ? (latest.question !== '' ? latest.question : latestTitle)
    : ''

  // 健康提醒文案：凌晨提示优先于休息时段；时段内作为徽章常驻最左侧。
  const nowDate = new Date()
  let reminderLabel: string | null = null
  let reminderIcon: ReminderIconKind = 'moon'
  if (lateActive) {
    reminderIcon = 'moon'
    const hour = nowDate.getHours()
    // 「凌晨 N 点」只在真的凌晨（0-4 点）才说得通。该提醒的时段可自定义，
    // 旧文案对任何时刻都硬说「凌晨」——设成 18:00-23:00 会得到「凌晨 18 点了」。
    reminderLabel = hour <= 4
      ? `凌晨 ${hour} 点 ${nowDate.getMinutes()} 分`
      : `${hour >= 22 ? '夜深了' : `已 ${hour} 点`}`
  } else if (restActive) {
    reminderIcon = 'coffee'
    reminderLabel = `休息时间（${restConfig.start}-${restConfig.end}），该休息一下了`
  }

  // 平时（无提醒）：随机轮播开心话术 / AI 名词小知识。
  const funLine = FUN_LINES[funIdx % FUN_LINES.length] ?? FUN_LINES[0]

  // 优先级：未读通知 > 平时轮播（开心话术 / AI 名词小知识）。
  // 已读（悬停面板即全部已读）后不再停留「最近完成时间」，直接回到知识轮播。
  // 健康提醒不挤占主文案——作为独立黄色徽章常驻最左侧，与通知共存。
  const pillLabel = unreadCount > 0 && latest !== undefined
    ? `${unreadCount} 个对话完成 · ${truncate(latestLabel, 56)}`
    : funLine.text

  // 面板定位（整数像素）+ 视口边界保护：面板左/右缘都不超出视口，
  // 胶囊贴边时自动向内收。
  const clampPanelLeft = (panelW: number, left: number): number => {
    if (pos === null) return left
    const minLeft = Math.round(8 - pos.x)
    const maxLeft = Math.max(minLeft, Math.round(window.innerWidth - 12 - pos.x - panelW))
    return Math.min(Math.max(left, minLeft), maxLeft)
  }
  // 记录面板：与胶囊**中心对齐**。
  const doneShift = clampPanelLeft(DONE_PANEL_W, Math.round(((shellWidth ?? 0) - DONE_PANEL_W) / 2))
  // 「正在执行」面板：不居中展开，左缘与「运行中」区块左缘对齐。
  const runShift = clampPanelLeft(RUN_PANEL_W, runBlockLeft)
  // 面板朝向：胶囊落在视口下半时改为向**上**滑出。原实现恒向下，胶囊拖到
  // 底部后面板整段落在视口外，既看不见也滚不到（列表还挺长）。
  const panelUp = pos !== null && pos.y + pillHeight(scale, fontRatio) > viewportH * 0.55

  // 主文案：完整展示，不再截断（知识/话术全文）；超出由外壳 maxWidth + 省略号兜底。
  const displayText = pillLabel
  // 方案A信息分层：Tag（锚点，不收缩）+ 释义（次级色，优先被截断）。
  // 未读通知 → 计数 Tag + 最新问题；知识轮播 → 术语 Tag + 解释；话术无 Tag 原样。
  const hasUnreadMain = unreadCount > 0 && latest !== undefined
  let infoTag: string | null = null
  let infoDesc = displayText
  if (hasUnreadMain) {
    infoTag = `${unreadCount} 条完成`
    infoDesc = truncate(latestLabel, 56)
  } else if (funLine.icon === 'bulb') {
    const sep = funLine.text.search(/[:：]/)
    if (sep > 0) {
      infoTag = funLine.text.slice(0, sep).trim()
      infoDesc = funLine.text.slice(sep + 1).trim()
    }
  }

  // 宽度平滑跟随：每次渲染后对**子块宽度求和**（子块均不收缩，求和不受
  // shell 自身受控宽度污染，扩/缩双向都准确），交给 CSS transition 过渡。
  useLayoutEffect(() => {
    const el = shellRef.current
    if (el === null) return
    let total = 0
    for (const child of el.children) total += child.getBoundingClientRect().width
    // 无边框（inset 环走 box-shadow），无需再加 border 占位。钳制到外壳
    // 上限：内容组合（提醒+运行中+主文案）瞬时超宽时不会把右内边距裁掉
    // （v0.2.4）。宽度上限与 pillShellStyle 的 maxWidth 同源。
    const cap = Math.min(SHELL_MAX_W, window.innerWidth - 48)
    const target = Math.min(Math.round(total), cap)
    if (target > 0 && target !== shellWidthRef.current) {
      shellWidthRef.current = target
      setShellWidth(target)
    }
    // 装饰宽 = 子块总宽 − 主文案实际宽度。文案被 maxWidth 截断时用
    // scrollWidth（自然宽）会算大，这里取渲染宽即可：装饰部分的宽度与
    // 文案是否截断无关，差值恒等于装饰宽。
    const labelEl = labelRef.current
    if (labelEl !== null) {
      const deco = Math.round(total - labelEl.getBoundingClientRect().width)
      if (deco > 0 && Math.abs(deco - decoWidth) >= 1) setDecoWidth(deco)
    }
    // 「正在执行」面板锚点：左侧运行中区块的 offsetLeft（相对 wrap 的 padding box，
    // 即面板 absolute left 所需值）。胶囊宽度动画/内容变化后每渲染实测跟随；
    // 值不变时返回原 state，React bail out，不会死循环。
    const runEl = runBlockRef.current
    if (runEl !== null) {
      const runLeft = runEl.offsetLeft
      setRunBlockLeft(prev => (Math.abs(runLeft - prev) >= 1 ? runLeft : prev))
    }
    // 宽度变化后重放位置（居中模式重新居中 / 锁定模式按中心锚点对称伸缩）。
    // 拖拽进行中绝不重放——否则位置同步会和拖拽对抗，把胶囊拽回去。
    if (dragRef.current !== null) return
    syncPosition()
  })

  // 形态互斥：卡片形态时悬浮胶囊整体隐藏（左下角小横条接管展示）。
  if (!enabled || pillMode !== 'float') return null

  // 整行淡入：key = displayText，文本变化时 React 重建文本节点重放动画。

  return createPortal(
    <div
      ref={wrapRef}
      className="dsh-done-pill"
      style={wrapStyle(dragging, pos, appearance.scale, fontRatio, fontStackOf(appearance.font))}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onMouseEnter={() => { if (dragRef.current === null) setHovered(true) }}
      onMouseLeave={() => { setHovered(false); setHoveredRunning(false) }}
    >
      <div
        ref={shellRef}
        className="dsh-done-pill-shell"
        data-unread={unreadCount > 0 ? '1' : '0'}
        data-dragging={dragging ? '1' : '0'}
        style={pillShellStyle(shellWidth)}
      >
        {/* 健康提醒徽章：设定时段内常驻显示（橙色月亮/咖啡 + 橙字），
            与完成通知共存不挤占。 */}
        {reminderLabel !== null && (
          <>
            <span
              style={{ ...reminderBadgeStyle, ...shellChildStyle }}
              title={reminderLabel}
              data-dp-zone="badge"
            >
              {reminderIcon === 'moon'
                ? <MoonIcon size={iconSize(18, 14, appearance.scale, fontRatio)} />
                : <CoffeeIcon size={iconSize(18, 14, appearance.scale, fontRatio)} />}
              <span className="dpl-reminder-pill">{reminderLabel}</span>
            </span>
            <span style={pillDividerStyle} aria-hidden />
          </>
        )}
        {/* 左块：正在执行中的任务数量（仅在有任务运行时显示），悬停滑出任务列表 */}
        {runningSessions.length > 0 && (
          <>
            <button
              ref={runBlockRef}
              type="button"
              data-dp-zone="run"
              style={{ ...runningBlockStyle(true), ...shellChildStyle, cursor: 'inherit' }}
              aria-label={`正在执行中的任务 ${runningSessions.length} 个；悬停或聚焦查看列表`}
              title="正在执行中的任务"
              onMouseEnter={() => { setHoveredRunning(true); setHovered(false) }}
              onFocus={() => { setHoveredRunning(true); setHovered(false) }}
              onBlur={() => { setHoveredRunning(false) }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                const first = runningSessions[0]
                if (first !== undefined) openSession(first.id)
              }}
            >
              <span className="dpl-run-arc-wrap" style={runOrbStyle} aria-hidden>
                <RunningArc size={iconSize(15, 11, appearance.scale, fontRatio)} />
              </span>
              <span>{runningSessions.length}</span>
            </button>
            <span style={pillDividerStyle} aria-hidden />
          </>
        )}
        {/* 主体：点击 = 直接进入最新完成的会话；按住拖动 = 移动胶囊 */}
        <button
          type="button"
          className="dsh-done-pill-main"
          data-dp-zone="main"
          onKeyDown={(event) => {
            // 键盘可达：点击语义原先只由 wrap 的 pointerup 合成，Enter/Space
            // 落在 button 上不会触发任何动作（拖拽手柄吞掉了默认点击流）。
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            if (latest !== undefined) openSession(latest.sessionId, unreadCount > 0 ? latest.id : undefined)
          }}
          onFocus={() => { setHovered(true); setHoveredRunning(false) }}
          onBlur={() => { setHovered(false) }}
          style={{ ...pillMainStyle, ...shellChildStyle, cursor: 'inherit' }}
          aria-label={latest !== undefined
            ? `打开会话「${latestTitle}」（${unreadCount} 条对话完成未读）；拖动可移动位置`
            : reminderLabel !== null
              ? `${reminderLabel}；拖动可移动位置`
              : '对话完成胶囊（暂无记录）；拖动可移动位置'}
          onMouseEnter={() => { setHovered(true); setHoveredRunning(false) }}
        >
          {unreadCount > 0 && latest !== undefined ? (
            <span style={checkBadgeStyle} aria-hidden />
          ) : (
            // 图标：有任务在跑时用线稿灯泡；**完全空闲**（无未读、无进行中）
            // 才让 OpenBotMotion 机器人接管——它是唯一会持续吃帧的元素，
            // 只在「无事发生」时才值得开。
            //
            // 判空**只能看「未读」**，绝不能看「有没有历史记录」：entries 是
            // 永不清理的完成历史（host 最多留 50 条），只要跑过一轮对话，
            // entries[0] 就恒有值——拿它判空等于判「恒真」，机器人永远挂载
            // 不上（卡片形态查未读所以正常，悬浮形态一条都看不到）。
            runningSessions.length > 0
              ? <BulbBadge scale={appearance.scale} ratio={fontRatio} />
              : <IdleRobot size={iconSize(16, 14, appearance.scale, fontRatio)} />
          )}
          <span
            ref={labelRef}
            key={displayText}
            style={{
              // maxWidth 让超长文案以省略号收尾：外壳只有 overflow:hidden 时
              // 文字是被**硬切**的（末字截一半，没有「…」）。装饰宽实测得来，
              // 带提醒徽章/运行中计数时也算得准。
              maxWidth: `calc(min(${SHELL_MAX_W}px, 100vw - 48px) - ${decoWidth}px)`,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              minWidth: 0,
              overflow: 'hidden',
              opacity: 0,
              animation: `dpLineIn ${MORPH_DUR} ease forwards`,
            }}
          >
            {infoTag !== null && <span className="dpl-info-tag">{infoTag}</span>}
            <span className={infoTag !== null ? 'dpl-main-desc' : 'dpl-main-desc dpl-main-desc--plain'}>{infoDesc}</span>
          </span>
          <span className="dpl-chev" style={{ flex: 'none', display: 'inline-flex' }} aria-hidden>
            <ChevronIcon size={iconSize(11.5, 10, appearance.scale, fontRatio)} />
          </span>
        </button>
        {/* 录屏（GIF）：细分隔线 + 独立按钮块。点击分发走 wrap 的 pointerup
            zone 机制（data-dp-zone="rec"），与拖拽共用 4px 阈值判定。 */}
        <span style={pillDividerStyle} aria-hidden />
        <span style={{ ...shellChildStyle, display: 'inline-flex', alignItems: 'center', paddingRight: 'calc(8px * var(--dps))' }}>
          <RecButton variant="float" scale={appearance.scale} />
        </span>
      </div>
      {/* 运行中任务面板：悬停左侧计数块时从下方滑出 */}
      {/* 面板整体吞掉 pointerdown：不然从面板空白处按下会拖动胶囊（面板随即
          因 setHovered(false) 消失，观感像「点一下面板就跑了」）。 */}
      <div
        style={runPanelStyle(hoveredRunning, runShift, panelUp)}
        role="dialog"
        aria-label="正在执行中的任务"
        aria-hidden={!hoveredRunning}
        onPointerDown={(event) => { event.stopPropagation() }}
      >
        <div className="dp-panel-head" style={headStyle}>
          <span style={headBarStyle} aria-hidden />
          <span style={headTitleStyle}>正在执行中</span>
          <span style={headMetaStyle}>{`${runningSessions.length} 个任务 · 点击进入会话`}</span>
        </div>
        {runningSessions.map((session) => {
          const info = runInfo[session.id]
          // 主文本 = 当前正在执行的那条用户消息；无消息时回退会话标题。
          const label = info !== undefined && info.question !== '' ? info.question : session.displayTitle
          return (
            <button
              key={session.id}
              type="button"
              className="dsh-done-pill-row"
              style={runRowStyle}
              title={info !== undefined && info.question !== ''
                ? `「${session.displayTitle}」正在执行：${info.question}`
                : `点击打开会话：${session.displayTitle}`}
              onPointerDown={(event) => { event.stopPropagation() }}
              onClick={() => { openSession(session.id) }}
            >
              <span style={panelDotStyle} aria-hidden />
              <span style={runRowTitleStyle}>{label}</span>
              {info !== undefined && (
                <span style={runRowTimeStyle}>{formatElapsed(nowTick - info.since)}</span>
              )}
            </button>
          )
        })}
        {runningSessions.length === 0 && (
          <div style={emptyStyle}>没有正在运行的任务</div>
        )}
      </div>
      {/* 记录面板：悬停主体时从下方滑出 */}
      <div
        style={panelStyle(hovered, doneShift, panelUp)}
        role="dialog"
        aria-label="对话完成记录"
        aria-hidden={!hovered}
        onPointerDown={(event) => { event.stopPropagation() }}
      >
        <div className="dp-panel-head" style={headStyle}>
          <span style={headBarStyle} aria-hidden />
          <span style={headTitleStyle}>对话完成记录</span>
          <span style={headMetaStyle}>
            {`${entries.length} 条 ·`}
            <button
              type="button"
              className="dsh-done-pill-link"
              style={headLinkStyle}
              disabled={entries.length === 0}
              onPointerDown={(event) => { event.stopPropagation() }}
              onClick={(event) => {
                event.stopPropagation()
                if (latest !== undefined) openSession(latest.sessionId)
              }}
            >
              点击卡片进入会话
            </button>
          </span>
        </div>
        {entries.length === 0 ? (
          <div style={emptyStateStyle}>
            <EmptyIllustration />
            <span style={captionPillStyle}>暂无记录 — 任一会话的对话完成后会出现在这里</span>
          </div>
        ) : (
          <div style={listStyle}>
            {entries.map((item) => {
              const title = item.title
              const unread = !readIds.has(item.id)
              // 主文本 = 完成的那条对话消息；无消息时回退会话标题。
              const headLabel = item.question !== '' ? item.question : item.title
              return (
                <div
                  key={item.id}
                  className="dsh-done-pill-row"
                  style={cardStyle}
                  role="button"
                  tabIndex={0}
                  title={`「${title}」${item.question !== '' ? `问：${item.question}` : ''} — 点击打开会话`}
                  onPointerDown={(event) => { event.stopPropagation() }}
                  onClick={() => { openSession(item.sessionId, item.id) }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      openSession(item.sessionId, item.id)
                    }
                  }}
                >
                  <div style={cardHeadStyle}>
                    {unread && <span style={unreadDotStyle} aria-hidden />}
                    <span style={sessionTitleStyle}>{headLabel}</span>
                    {item.reasonKind === 'error' && <span style={errorTagStyle}>出错结束</span>}
                    <span style={metaStyle}>
                      {`回合 ${item.turn >= 0 ? item.turn + 1 : '?'} · ${formatTime(item.endedAt)}`}
                    </span>
                    <button
                      type="button"
                      className="dsh-done-pill-close"
                      style={closeStyle}
                      aria-label="移除这条记录（不跳转会话）"
                      onPointerDown={(event) => { event.stopPropagation() }}
                      onClick={(event) => { event.stopPropagation(); dismiss(item.id) }}
                    >
                      ✕
                    </button>
                  </div>
                  {item.answer !== '' && <pre style={answerStyle}>{item.answer}</pre>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/** 渲染期门：组件行关闭时胶囊整块不渲染（内部轮询随组件卸载而停）。 */
function DonePillGated(props: DonePillProps): JSX.Element | null {
  return <FeatureGate feature="view.done-pill"><DonePill {...props} /></FeatureGate>
}

/** 左下角小横条的同款渲染期门。 */
function SidebarBarCardGated(props: Record<string, unknown>): JSX.Element | null {
  return <FeatureGate feature="view.done-pill"><SidebarBarCard {...(props as never)} /></FeatureGate>
}

/** 注册顶部悬浮胶囊 + 左下角小横条卡片 + 基础设置行（形态 / 显隐 / 提醒 / 外观）。 */
export function applyDonePill(ctx: ClientContext): void {
  // 功能总开关（插件页 → 功能开关 → 对话完成胶囊）关闭时整块不装配：
  // 不注册任何 shell.overlay / sidebar.footer.action / settings.general.item 座位，
  // 胶囊组件也就不会挂载，内部的 3s 轮询与待机动画自然不启动。
  //
  // 这是 apply 期装配，拨完开关需要刷新页面生效（client/index.ts 外层还有一道
  // featureMount 同款门；这里再判一次是为了让「直接调用 applyDonePill」的测试
  // 与其它装配路径也不会漏掉总开关）。
  if (!featureEnabledNow('view.done-pill')) return
  // 样式先行：早于组件首次渲染注入，避免「无样式首帧 + 颜色过渡」。
  // 小横条卡片复用同一张样式表（--dpl-* 变量 + keyframes），这里一次注入。
  ensurePillKeyframes()
  // 底部布局修正（dsh-mobile-plus 把宽栏 foot 并成一行，卡片会被挤到设置
  // 右边；规则自带 :has 自失效，悬浮形态下零影响）。
  ensureCardLayoutCss()
  // sessions 服务懒取（点击时才真正 get；apply 同时段拿不到也不影响）。
  // 跳转入口探测与失败提示见 ./session-nav：DSH 0.2 的官方导航面是
  // `ctx.uiWorkspace.openSession()`，sessions 服务上没有 open()。
  setSessionNavContext(ctx as unknown as { get?(name: string): unknown })
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'dsh-done-pill',
    order: 90,
  }, DonePill))
  // 跳转失败提示条：独立浮层（不依赖胶囊形态/显隐开关——胶囊关掉了也要能
  // 看到失败原因），排在胶囊之后。
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'dsh-done-pill-nav-toast',
    order: 91,
  }, NavToast))
  // 任务完成提醒的页内兜底卡：系统通知发不出去时才出现，独立于胶囊形态与
  // 显隐开关（胶囊关掉了也照样提醒——提醒本身是独立功能，有单独的总开关）。
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'dsh-done-pill-notify',
    order: 92,
  }, NotifyCards))
  // 录屏目标选择面板：壳内无原生选择器时点录屏按钮弹出（整屏 / 框选 / 窗口）。
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'dsh-done-pill-rec-picker',
    order: 93,
  }, RecPickerPanel))
  // 录屏框选 overlay：面板点「框选区域」后接棒（比面板高一层）。
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'dsh-done-pill-rec-region',
    order: 94,
  }, RecRegionOverlay))
  // 左下角小横条：sidebar.footer.action 槽位；宿主默认就是纵向（动作组在
  // 设置行上方），dsh-mobile-plus 在宽栏会并成一行，靠 ensureCardLayoutCss
  // 的 :has 规则把动作组顶回独占一行。形态为 card 时才渲染。
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'dsh-done-pill-card',
    order: 10,
  }, SidebarBarCard))
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({
      name: 'settings.general.item',
      id: 'dsh-done-pill-mode',
      order: 30,
      label: '胶囊形态',
    }, PillModeRow))
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({
      name: 'settings.general.item',
      id: 'dsh-done-pill',
      order: 31,
      label: '对话完成胶囊',
    }, DonePillRow))
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({
      name: 'settings.general.item',
      id: 'dsh-done-pill-notify',
      order: 32,
      label: '任务完成提醒',
    }, NotifyRow))
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({
      name: 'settings.general.item',
      id: 'dsh-done-pill-rest',
      order: 33,
      label: '休息时间提醒',
    }, () => (
      <ReminderRow
        titleText="休息时间提醒"
        descText="设定时间段内胶囊持续提示休息；结束时间早于开始时间表示跨午夜"
        store={restStore}
      />
    )))
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({
      name: 'settings.general.item',
      id: 'dsh-done-pill-late',
      order: 34,
      label: '凌晨注意休息',
    }, () => (
      <ReminderRow
        titleText="凌晨注意休息"
        descText="凌晨时段内胶囊持续提示注意休息（默认 00:00-07:00）"
        store={lateStore}
      />
    )))
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({
      name: 'settings.general.item',
      id: 'dsh-done-pill-scale',
      order: 35,
      label: '胶囊大小',
    }, PillScaleRow))
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({
      name: 'settings.general.item',
      id: 'dsh-done-pill-font',
      order: 36,
      label: '胶囊字体',
    }, PillFontRow))
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({
      name: 'settings.general.item',
      id: 'dsh-done-pill-rec-fps',
      order: 37,
      label: '录屏帧率',
    }, RecFpsRow))
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({
      name: 'settings.general.item',
      id: 'dsh-done-pill-rec-width',
      order: 38,
      label: '录屏画质',
    }, RecWidthRow))
}
