/**
 * dsh-chat-plus — 任务概览卡片（一个卡片框统领全部任务项）。
 * 呈现 DSH 官方真实的 todo / task 列表。
 *
 * 卡片常驻：当前轮没有任务时给一行低对比度空态，而不是整张 return null。
 * 原因见下方注释——整张卡消失会让「模型什么时候想起写 todo」直接变成
 * 「卡片什么时候出现」。
 *
 * ══ 本轮优化的设计取舍 ═══════════════════════════════════════════════════
 * 1. 行 key 不再信任上游 id。三条数据源（本轮快照 / live 投影 / 会话回溯）
 *    对同一份任务给出不同 id 口径（live-N vs plan-task-*），数据源切换的
 *    那一帧所有 key 全变 → React 整列表重挂载 → 入场动画重播，表现为
 *    「任务列表闪一下重新铺开」。key 按 content 归一化后，同一任务跨数据
 *    源保持同 key，节点复用、动画不重播。
 * 2. 未完成兜底。官方 todos 存在「回合结束仍留着未完成项」的已知问题
 *    （DSH Discussions #3424）。轮次已停（isRunning=false）却仍有非完成项时，
 *    按「未完成」弱化态渲染——灰点线圈不转 + 灰标签，不再冒充活体；
 *    meta 文案同步从「进行中」改口「未完成」。
 *    2026-10-10 扩口径：原先只认 in_progress。host 侧新增「回合结束自动收口」
 *    （`agent/turn-stopping` 把残留 in_progress 降级为 pending）之后，回合结束
 *    的清单里不再有 in_progress，只认它会让这条兜底永不触发。改为认「非完成
 *    项」，语义也更准：回合都结束了还挂着的，就是没做完。
 * 3. 列表全量常展，不做已完成区收拢（按用户要求：任务不折叠）。曾试过
 *    长列表把已完成项折进摘要行，被否——清单就是给人逐条核对的，收起来
 *    等于藏信息。长清单的垂直代价由右栏滚动承担。
 * 4. 状态迁移动效（纯 CSS，一次性）。完成瞬间 = 对勾 pop + 行底色淡闪；
 *    两者都由**覆盖层子元素**承担（.kr-task-item__flash / __icon--pop），
 *    不动行本身的 animation 声明——class 切换会重置行的动画列表，把基底
 *    入场动画重播一遍，闪得更厉害。进行中行 = 左侧竖条 + 底色呼吸
 *    （::before/::after 覆盖层，不与 hover 底色打架）。全部完成 = 进度条
 *    一次光脉冲（false→true 跳变触发，900ms 后自动摘除）。
 * 5. 进度条三态。running = 品牌蓝 + 循环流光（sheen）；停滞 = 灰；
 *    全部完成 = 品牌蓝静止。颜色与宽度都有过渡，不做硬切。
 * 6. 无障碍。折叠热区 role=button + tabIndex + aria-expanded + Enter/Space；
 *    进度条 role=progressbar 带 aria-valuenow。
 *    与同仓库拖拽手柄的 WCAG 口径对齐（见 KrAgentPanel 的 resize-handle）。
 * 7. 折叠态持久化 localStorage（dsh.kr_chat.task_card_collapsed）。
 *    折叠是 UI 偏好不是会话状态，放卡片本地而不进 kr-chat-store。
 * 8. 口径标注。回溯到「会话最近一次清单」（非本轮写入）时，标题旁给一枚
 *    「会话清单」小标，避免用户误以为看到的是本轮任务。本轮/live 口径
 *    不标注——默认即本轮，少一件噪声。
 * 9. 进度数字翻滚（RollNum）。doneCount 变化时旧值上滚出、新值下滚入，
 *    320ms 一次性动画；inline-grid 叠层保证宽度随较宽者，tabular-nums
 *    下数字不抖。meta 无 aria-live，翻滚对读屏不可见（progressbar 的
 *    aria-valuenow 才是权威读数）。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StatusIcon } from './StatusIcon.tsx'

export interface DshTaskItem {
  readonly id: string
  readonly content: string
  readonly status: 'pending' | 'in_progress' | 'completed'
}

/** 任务清单的数据口径（由 KrAgentPanel 的三级回退判定，见其 tasksView memo）。 */
export type TaskSource = 'turn' | 'live' | 'session' | 'none'

export interface TaskOverviewCardProps {
  readonly tasks: readonly DshTaskItem[]
  readonly isRunning?: boolean
  /** 'session' = 跨轮次回退到会话最近一次清单；其余口径不标注。 */
  readonly source?: TaskSource
}

/** 折叠态持久化键。全局 UI 偏好，跨会话生效。 */
const STORAGE_KEY_COLLAPSED = 'dsh.kr_chat.task_card_collapsed'

function readCollapsed(): boolean {
  try {
    return typeof localStorage !== 'undefined'
      && localStorage.getItem(STORAGE_KEY_COLLAPSED) === '1'
  } catch {
    return false
  }
}

/**
 * content 归一化 key：跨数据源稳定（理由见文件头第 1 条）。
 * 同一列表里 content 撞车时追加 ~n 序号，保证 key 唯一不告警。
 */
function buildStableKeys(tasks: readonly DshTaskItem[]): readonly string[] {
  const seen = new Map<string, number>()
  return tasks.map((task) => {
    const base = task.content.trim() || task.id || '(untitled)'
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return n === 0 ? base : `${base}~${n}`
  })
}

/**
 * 进度数字翻滚。值变化时旧值滚出、新值滚入（增=下进上出，减=反向），
 * 360ms 后回到纯文本。inline-grid 叠层：两层同格，容器宽 = 较宽者。
 */
const RollNum = memo(function RollNum({ value }: { readonly value: number }) {
  const [roll, setRoll] = useState<{ from: number; dir: 'up' | 'down' } | null>(null)
  const lastRef = useRef(value)
  useEffect(() => {
    if (lastRef.current === value) return
    const dir = value > lastRef.current ? 'up' : 'down'
    const from = lastRef.current
    lastRef.current = value
    setRoll({ from, dir })
    const timer = setTimeout(() => setRoll(null), 360)
    return () => clearTimeout(timer)
  }, [value])
  if (roll === null) return <>{value}</>
  return (
    <span className={`kr-num-roll kr-num-roll--${roll.dir}`}>
      <span className="kr-num-roll__old">{roll.from}</span>
      <span className="kr-num-roll__new">{value}</span>
    </span>
  )
})

export const KrTaskOverviewCard = memo(function KrTaskOverviewCard({
  tasks,
  isRunning = false,
  source = 'turn',
}: TaskOverviewCardProps) {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  /** 进度条「全部完成」一次性光脉冲的激活窗（900ms）。 */
  const [flashDone, setFlashDone] = useState(false)

  /*
   * 原来这里是 `if (!tasks || tasks.length === 0) return null`——卡片整张消失。
   * 于是只要模型这一轮还没写出任务，右栏第一张卡就是空的；等第一条 todo 落地
   * 时整张卡突然弹出来，读作「最后才出现」。卡片的出现时机不该取决于模型
   * 什么时候想起写 todo。
   *
   * 现在常驻：没有任务时给一行低对比度的空态，位置永远稳定；有任务时进度条
   * 与列表自然填进去，不做整卡重挂载。
   */
  const empty = !tasks || tasks.length === 0
  const doneCount = tasks.filter((t) => t.status === 'completed').length
  /**
   * 回合结束后仍未收口的项数。
   *
   * 2026-10-10 扩口径：原先只数 `in_progress`，但 host 侧新增的「回合结束自动
   * 收口」（`agent/turn-stopping` 把残留 in_progress 改写为 pending）上线后，
   * 回合结束的清单里**不会再有** in_progress——只数 in_progress 会让这条兜底
   * 判定永远不触发，标签静默消失。
   *
   * 新口径 = 回合已停 且 非完成项（in_progress 或 pending）都算未收口。
   * 语义是自洽的：回合都结束了还挂着的未完成项，就是没做完。
   */
  const unfinishedCount = tasks.filter((t) => t.status !== 'completed').length
  const allDone = !empty && doneCount === tasks.length
  const percent = empty ? 0 : Math.round((doneCount / tasks.length) * 100)
  /**
   * 停滞：轮次已经停了，清单里却还挂着未完成项——官方收口问题的兜底
   * （文件头第 2 条）。空态与全完成态都不算停滞。
   */
  const stalled = !isRunning && unfinishedCount > 0

  // content 归一化 key（与 tasks 同引用周期，memo 依赖即够）。
  const keys = useMemo(() => buildStableKeys(tasks), [tasks])

  /* ── 完成迁移检测：pending/in_progress → completed 的那一帧点亮 just-done ── */
  const prevStatusRef = useRef<Map<string, string>>(new Map())
  const [justDoneKeys, setJustDoneKeys] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    const prev = prevStatusRef.current
    const next = new Map<string, string>()
    const fired: string[] = []
    for (let i = 0; i < tasks.length; i += 1) {
      const key = keys[i]
      const status = tasks[i].status
      next.set(key, status)
      const before = prev.get(key)
      if (before !== undefined && before !== 'completed' && status === 'completed') {
        fired.push(key)
      }
    }
    prevStatusRef.current = next
    if (fired.length > 0) {
      setJustDoneKeys((old) => {
        const merged = new Set(old)
        for (const key of fired) merged.add(key)
        return merged
      })
    }
  }, [tasks, keys])
  const clearJustDone = useCallback((key: string) => {
    setJustDoneKeys((old) => {
      if (!old.has(key)) return old
      const next = new Set(old)
      next.delete(key)
      return next
    })
  }, [])

  // 全部完成的光脉冲：allDone false→true 跳变时亮 900ms。
  const prevAllDoneRef = useRef(allDone)
  useEffect(() => {
    const was = prevAllDoneRef.current
    prevAllDoneRef.current = allDone
    if (allDone && !was) {
      setFlashDone(true)
      const timer = setTimeout(() => setFlashDone(false), 900)
      return () => clearTimeout(timer)
    }
  }, [allDone])

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => !prev)
  }, [])

  /*
   * 持久化走 effect，不塞进 setState updater：updater 是渲染期才执行的
   * （StrictMode 下还会重放），在它里面写 localStorage 会让「落盘的值」与
   * 「屏幕上的折叠态」时序脱节。effect 依赖 collapsed，状态定型后落盘，
   * 挂载时也会把当前值原样写一次（无害）。
   */
  useEffect(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_COLLAPSED, collapsed ? '1' : '0')
      }
    } catch { /* 隐私模式下写不进就算了，折叠态只影响本页面生命周期 */ }
  }, [collapsed])

  /*
   * 进度说明是**纯文字**，不再是一枚带底色的徽标（按用户要求）：卡片标题行
   * 右侧挂一枚胶囊，右栏每张卡各挂一枚，三张并排时是一列色块，噪声比信息
   * 本身大。文字弱一级（.kr-card__meta）即可，扫读时不会和标题抢。
   */
  const progressMeta = empty ? (
    '本轮还没有任务'
  ) : allDone ? (
    <><RollNum value={tasks.length} /> 项已完成</>
  ) : (
    <>
      <RollNum value={doneCount} />/<RollNum value={tasks.length} /> 完成
      {/* 收口后的清单里已无 in_progress，只剩 pending——文案要能覆盖这一态，
          否则「· 未完成」在自动收口之后永远不出现。 */}
      {unfinishedCount > 0 ? (stalled ? ' · 未完成' : ' · 进行中') : ''}
    </>
  )

  const renderTaskRow = (
    entry: { key: string; task: DshTaskItem },
    staggerIndex: number,
  ) => {
    const { key, task } = entry
    const isCompleted = task.status === 'completed'
    const isInProgress = task.status === 'in_progress'
    /*
     * 行级停滞：整卡停滞（回合已停 + 还有未完成项）且这一行不是已完成。
     *
     * 与整卡判定同步扩口径：自动收口把 in_progress 改成 pending 之后，只有
     * `isInProgress` 的行会挂标签会让 pending 行静默裸奔——那些恰恰是收口后
     * 最该被看见的行。
     */
    const rowStalled = !isRunning && !isCompleted
    const justDone = justDoneKeys.has(key)

    return (
      <div
        key={key}
        className={`kr-task-item kr-task-item--${rowStalled ? 'stalled' : task.status}`}
        style={{ animationDelay: `${Math.min(staggerIndex, 8) * 34}ms` }}
      >
        <span
          className={`kr-task-item__icon${justDone ? ' kr-task-item__icon--pop' : ''}`}
        >
          {/* 状态圆圈：14px 实心对勾 / 蓝色转圈 / 点线，与右栏另一张卡
              的行首图标同尺寸同色系（那枚是类别图标，本卡是三态圆圈）。
              停滞行降级为 pending 的点线圈：不转、灰化，不再冒充活体。 */}
          <StatusIcon state={isCompleted ? 'done' : rowStalled ? 'pending' : isInProgress ? 'running' : 'pending'} />
        </span>

        <div className="kr-task-item__content">
          {task.content}
        </div>

        {/* 仅在进行中时提供微小状态标识，已完成依靠对勾图标自然传达，杜绝视觉垃圾。
            停滞行换灰色「未完成」：说清事实，但不是错误——下一轮模型收口后会自愈。
            2026-10-10：从「未收口」改口「未完成」并扩到 pending 行。原因是自动收口
            会把残留 in_progress 降级成 pending，此时说「未收口」已不准确——它已经
            被收口过了，只是**没做完**。
            两个分支互斥：回合在跑 → 进行中；回合停了 → 未完成（含 pending 行）。 */}
        {isInProgress && !rowStalled && (
          <span className="kr-task-item__tag kr-task-item__tag--running">
            进行中
          </span>
        )}
        {rowStalled && (
          <span className="kr-task-item__tag kr-task-item__tag--stalled">
            未完成
          </span>
        )}

        {/* 完成瞬间的一次性底色淡闪。覆盖层子元素承担动画（文件头第 4 条），
            动画播完即摘——行自身的入场动画声明全程不动，不会被 class 切换重播。 */}
        {justDone && (
          <span
            className="kr-task-item__flash"
            aria-hidden="true"
            onAnimationEnd={() => clearJustDone(key)}
          />
        )}
      </div>
    )
  }

  return (
    <div className="kr-card kr-card--task" data-empty={empty || undefined}>
      {/* 卡片头部：折叠热区。div + role=button 而非真 <button>——头部是
          「图标+标题+口径标+meta」的 flex 行，button 的默认样式复位成本高于
          ARIA 三件套；键盘 Enter/Space 与 aria-expanded 一样不缺。 */}
      <div
        className="kr-card__header"
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        aria-label={`任务概览，${empty ? '暂无任务' : `${doneCount}/${tasks.length} 项完成`}，点击${collapsed ? '展开' : '收起'}`}
        onClick={toggleCollapsed}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            toggleCollapsed()
          }
        }}
      >
        <span className="kr-card__icon">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M13.328 9.7v1.28H7.28V9.7h6.048zM13.328 2.97v1.28H7.28V2.97h6.048z" fill="currentColor"/>
            <path d="M4.645 10.336a1.283 1.283 0 1 1-2.566 0 1.283 1.283 0 0 1 2.566 0zm1.28 0c0 1.415-1.148 2.563-2.563 2.563A2.563 2.563 0 0 1 .8 10.336c0-1.415 1.147-2.562 2.562-2.562 1.415 0 2.563 1.147 2.563 2.562z" fill="currentColor"/>
            <path d="M4.645 3.612a1.283 1.283 0 1 1-2.565 0 1.283 1.283 0 0 1 2.565 0zm1.28 0C5.925 5.027 4.778 6.175 3.362 6.175A2.563 2.563 0 0 1 .8 3.612C.8 2.197 1.947 1.05 3.362 1.05c1.416 0 2.563 1.147 2.563 2.562z" fill="currentColor"/>
          </svg>
        </span>
        <span className="kr-card__title">任务概览</span>
        {/* 口径小标：只在回溯到会话清单时出现（文件头第 8 条）。 */}
        {source === 'session' && !empty && (
          <span className="kr-task-scope">会话清单</span>
        )}
        <span className="kr-card__meta">{progressMeta}</span>
      </div>

      {/*
       * 空态时整张卡只剩这一行头。
       *
       * 原来空态要占三行：头部（徽标写"暂无任务"）+ 0% 进度条 + 正文
       * "本轮还没有任务清单"。后两者都是同一句话的重复与纯装饰（0% 的进度条
       * 不传达任何信息），三行换一行，右栏省下的高度直接给思考与操作面板。
       * 徽标改成把话说完整，读起来也不用猜"暂无任务"指的是什么。
       */}
      {!collapsed && !empty && (
        <div
          className="kr-task-progress-line"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="任务完成进度"
          data-running={isRunning ? 'true' : undefined}
          data-done={allDone ? 'true' : undefined}
          data-flash={flashDone ? 'true' : undefined}
        >
          <div
            className="kr-task-progress-line__fill"
            style={{ width: `${percent}%` }}
          >
            <span className="kr-task-progress-line__sheen" aria-hidden="true" />
          </div>
        </div>
      )}

      {/* 任务列表（整洁单层卡片排布，无俄式套盒，去除非必要重复徽标）。
          全量常展，不做已完成区收拢（文件头第 3 条）。 */}
      {!collapsed && !empty && (
        <div className="kr-task-list">
          {tasks.map((task, index) => renderTaskRow({ key: keys[index], task }, index))}
        </div>
      )}
    </div>
  )
})
