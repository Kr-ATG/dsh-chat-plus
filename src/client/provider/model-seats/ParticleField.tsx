/**
 * ParticleField — 推理等级滑杆的点阵粒子画布。
 *
 * 设计（对齐参考图）：轨道上铺满等距的竖条点阵，每根竖条由若干上下堆叠的小方格
 * 组成；方格亮度沿列序带相位差，读作一条从左向右扫过的能量波，同时每格各自
 * 呼吸闪烁。越靠近滑块（当前档位）越淡，被滑块「吸收」。档位越高 → 波越快越亮。
 * 切换档位时在滑块处散开一圈方形火星作为反馈。
 *
 * 主题自适应：深色主题 additive（'lighter'）叠加 + 亮蓝点阵；浅色主题
 * 'source-over' + 饱和品牌蓝点阵（additive 在白底上会直接消失）。
 *
 * 工程细节：devicePixelRatio 自适应、真实时间步长（不假设 60fps）、
 * prefers-reduced-motion 下渲染静态点阵（dt 归零，不推进动画）、
 * 画布尺寸为 0（最小化）时只跳帧不自杀。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

/** 一根竖条：若干上下堆叠的小方格。 */
interface DotColumn {
  /** 每格基础亮度 0..1。 */
  cells: number[]
  /** 每格闪烁相位（rad）。 */
  cellPhase: number[]
  /** 每格闪烁频率（rad/s）。 */
  cellPulse: number[]
  /** 整列明暗增益 0..1（逐列不同，避免整齐划一）。 */
  gain: number
}

/** 一枚迸发火星（切换档位的触感反馈）。 */
interface Spark {
  /** 位置（CSS px）。 */
  x: number
  y: number
  /** 速度（px/s）。 */
  vx: number
  vy: number
  /** 边长（CSS px）。 */
  size: number
  /** 剩余寿命（秒）。 */
  life: number
  /** 初始寿命（秒）。 */
  maxLife: number
}

/** {@link ParticleFieldHandle.flow} / {@link ParticleFieldHandle.burst} 的参数。 */
export interface FlowOptions {
  /** 当前档位位置（滑块中心，归一化到轨道可用宽度 0..1）。 */
  end: number
  /** 强度 0..1（推理等级越高越强）。 */
  intensity: number
  /** 当前档位主色相（deg，迸发火星用）。 */
  hue: number
}

/** 对外暴露的控制入口。 */
export interface ParticleFieldHandle {
  /** 启动 / 更新点阵流。 */
  flow(options: FlowOptions): void
  /** 停止（点阵淡出，在途火星自然熄灭）。 */
  stop(): void
  /** 在滑块处散开一圈火星（切换档位的触感反馈）。 */
  burst(options: FlowOptions): void
}

interface ParticleFieldProps {
  className?: string
}

/** 左右内边距 = 滑块半径，与 `.peff-eff-fill` 宽度公式 / `.peff-eff-ticks` 一致。 */
const TRACK_PAD = 20
/** 列周期（px）：竖条宽 + 间隙。 */
const COL_STEP = 6
/** 竖条宽度（px）。 */
const COL_WIDTH = 3
/** 方格高（px）：格子高、间隙小，整体读作一条竖条（对齐参考图的分段感）。 */
const CELL_H = 3.6
/** 方格间隙（px）。 */
const CELL_GAP = 1
/** 轨道上下内边距（px）。 */
const ROW_PAD = 5
/** 相邻列的波相位差（rad）：决定能量波的空间频率。 */
const WAVE_K = 0.36
/** 列数上限。 */
const MAX_COLS = 80
/** 单帧最大时间步长（切标签页回来时防止跳跃）。 */
const MAX_STEP = 0.05

/** 画布调色模式：跟随 DSH 主题。 */
type Tone = 'light' | 'dark'

/** 点阵基色（R/G/B）。 */
const DOT_RGB: Record<Tone, readonly [number, number, number]> = {
  light: [86, 146, 220],
  dark: [140, 180, 255],
}

/** 当前 DSH 主题是否为深色（官方在 body 上打 data-ds-dark-theme）。 */
function currentTone(): Tone {
  if (typeof document === 'undefined') return 'dark'
  return document.body.dataset.dsDarkTheme === undefined ? 'light' : 'dark'
}

/** 用户是否要求减少动效。 */
function reducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 平滑插值（0..1）。 */
function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** 造一根竖条：每格亮度 / 相位 / 频率各自随机。 */
function makeColumn(rows: number): DotColumn {
  const cells: number[] = []
  const cellPhase: number[] = []
  const cellPulse: number[] = []
  for (let r = 0; r < rows; r += 1) {
    cells.push(0.42 + Math.random() * 0.58)
    cellPhase.push(Math.random() * Math.PI * 2)
    cellPulse.push(1.6 + Math.random() * 3.4)
  }
  return { cells, cellPhase, cellPulse, gain: 0.72 + Math.random() * 0.28 }
}

/**
 * 渲染点阵粒子画布；`ref` 暴露 {@link ParticleFieldHandle}。
 */
export const ParticleField = forwardRef<ParticleFieldHandle, ParticleFieldProps>(
  function ParticleField({ className }, ref) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const colsRef = useRef<DotColumn[]>([])
    const sparksRef = useRef<Spark[]>([])
    const flowRef = useRef<FlowOptions & { active: boolean }>({ end: 0.5, intensity: 0.5, hue: 212, active: false })
    const rafRef = useRef(0)
    const runningRef = useRef(false)
    const lastRef = useRef(0)
    const fadeRef = useRef(0)
    /** 动画时钟（秒）：reduced-motion 下停止累加，点阵保持静态。 */
    const clockRef = useRef(0)
    const toneRef = useRef<Tone>('dark')

    /** 滑块（点阵终点）的画布 x 坐标。 */
    const endX = (width: number): number => {
      const inner = Math.max(0, width - TRACK_PAD * 2)
      return TRACK_PAD + inner * Math.min(1, Math.max(0, flowRef.current.end))
    }

    /** 轨道高度能放下的方格行数。 */
    const rowsFor = (height: number): number =>
      Math.max(3, Math.floor((height - ROW_PAD * 2 + CELL_GAP) / (CELL_H + CELL_GAP)))

    /** 轨道宽度能放下的竖条列数。 */
    const colsFor = (width: number): number =>
      Math.min(MAX_COLS, Math.max(1, Math.floor((width - TRACK_PAD * 2) / COL_STEP) + 1))

    /** 列数据按画布尺寸补齐 / 裁剪 / 重建。 */
    const syncCols = (width: number, height: number): void => {
      const target = colsFor(width)
      const rows = rowsFor(height)
      const list = colsRef.current
      if (list.length > target) list.length = target
      while (list.length < target) list.push(makeColumn(rows))
      for (const col of list) {
        if (col.cells.length === rows) continue
        const fresh = makeColumn(rows)
        col.cells = fresh.cells
        col.cellPhase = fresh.cellPhase
        col.cellPulse = fresh.cellPulse
      }
    }

    /** 在滑块处散开一圈方形火星。 */
    const spawnBurst = (x: number, mid: number, intensity: number): void => {
      const count = 14 + Math.round(intensity * 14)
      for (let i = 0; i < count; i += 1) {
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.7
        const speed = 28 + Math.random() * 62
        sparksRef.current.push({
          x,
          y: mid,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed * 0.62,
          size: 1.6 + Math.random() * 2.2,
          life: 0.34 + Math.random() * 0.34,
          maxLife: 0.68,
        })
      }
    }

    const start = (): void => {
      if (runningRef.current) return
      runningRef.current = true
      lastRef.current = 0
      rafRef.current = requestAnimationFrame(tick)
    }

    const tick = (now: number): void => {
      const canvas = canvasRef.current
      if (canvas === null) {
        runningRef.current = false
        return
      }
      const rect = canvas.getBoundingClientRect()
      const width = rect.width
      const height = rect.height
      const active = flowRef.current.active

      // 窗口最小化 / 面板刚挂载：尺寸为 0 时只跳帧，不结束循环（否则永久停摆）。
      if (width === 0 || height === 0) {
        if (!active && sparksRef.current.length === 0 && fadeRef.current <= 0.01) {
          runningRef.current = false
          return
        }
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      toneRef.current = currentTone()

      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const pixelWidth = Math.round(width * dpr)
      const pixelHeight = Math.round(height * dpr)
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth
        canvas.height = pixelHeight
      }
      const ctx = canvas.getContext('2d')
      if (ctx === null) {
        runningRef.current = false
        return
      }
      // 之后一律用 CSS px 作画，缩放交给变换矩阵。
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      // reduced-motion：动画时钟冻结 → 点阵是静态的（波不扫、格不闪），但画面完整。
      // ⚠️ 冻结必须走独立时钟（clockRef），不能用 now/1000：后者是绝对时间，
      // 即使把 dt 归零，波形仍会随真实时间继续推移，等于没降级。
      const still = reducedMotion()
      const realDt = lastRef.current === 0 ? 1 / 60 : Math.min(MAX_STEP, (now - lastRef.current) / 1000)
      const animDt = still ? 0 : realDt
      lastRef.current = now
      clockRef.current += animDt

      // 开关的淡入淡出：停止后点阵退场。用真实时间步长，降级时也要能淡入。
      fadeRef.current += ((active ? 1 : 0) - fadeRef.current) * Math.min(1, realDt * 9)
      const fade = fadeRef.current

      if (active) syncCols(width, height)

      const dark = toneRef.current === 'dark'
      const tone = DOT_RGB[toneRef.current]
      const [r0, g0, b0] = tone
      const intensity = flowRef.current.intensity
      ctx.clearRect(0, 0, width, height)
      // 深色主题：additive 让点阵发光；浅色主题：常规叠加，否则白底上完全消失。
      ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over'

      const stop = endX(width)
      const rows = rowsFor(height)
      const colCount = colsRef.current.length
      const seconds = clockRef.current
      // 波速随档位提升：低档缓慢推移，高档快速掠过。
      const waveSpeed = 1.4 + intensity * 2.8
      const topAlpha = (dark ? 0.95 : 0.84) * (0.45 + intensity * 0.55)
      const dotColor = `rgb(${r0},${g0},${b0})`

      if (fade > 0.01) {
        for (let i = 0; i < colCount; i += 1) {
          const x = TRACK_PAD + i * COL_STEP
          if (x > stop + 0.5) continue
          const col = colsRef.current[i]
          // 靠近滑块（右端）淡出：点阵被滑块吸收。
          const near = 1 - smoothstep(stop - 30, stop + 1, x)
          // 左端淡入：只压掉最外侧 3px，避免圆角处硬切又不把左端整体调暗。
          const far = smoothstep(TRACK_PAD - 1, TRACK_PAD + 4, x)
          // 沿列序传播的能量波（波峰随时间向右推移）。
          const wave = 0.62 + 0.38 * Math.sin(seconds * waveSpeed - i * WAVE_K)
          const colAlpha = near * far * wave * col.gain * topAlpha * fade
          if (colAlpha <= 0.02) continue
          for (let r = 0; r < rows; r += 1) {
            const flick = 0.5 + 0.5 * Math.sin(col.cellPhase[r] + seconds * col.cellPulse[r])
            const alpha = colAlpha * col.cells[r] * (0.35 + 0.65 * flick)
            if (alpha <= 0.02) continue
            ctx.globalAlpha = Math.min(1, alpha)
            ctx.fillStyle = dotColor
            ctx.fillRect(x, ROW_PAD + r * (CELL_H + CELL_GAP), COL_WIDTH, CELL_H)
          }
        }
      }

      // 火星：方形小点，随寿命衰减。
      const sparks = sparksRef.current
      if (sparks.length > 0) {
        const hue = flowRef.current.hue
        ctx.fillStyle = `hsl(${hue} 88% ${dark ? 74 : 54}%)`
        for (let i = sparks.length - 1; i >= 0; i -= 1) {
          const spark = sparks[i]
          // 火星用真实步长推进：降级时不该把它们冻在半空。
          spark.life -= realDt
          if (spark.life <= 0) {
            sparks.splice(i, 1)
            continue
          }
          spark.vx *= 1 - 2.6 * realDt
          spark.vy *= 1 - 2.6 * realDt
          spark.x += spark.vx * realDt
          spark.y += spark.vy * realDt
          const decay = Math.max(0, spark.life / spark.maxLife) ** 1.25
          const alpha = Math.min(1, decay * fade * (dark ? 0.95 : 0.8))
          if (alpha <= 0.02) continue
          ctx.globalAlpha = alpha
          const half = spark.size / 2
          ctx.fillRect(spark.x - half, spark.y - half, spark.size, spark.size)
        }
      }

      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'

      if (!active && fade <= 0.01 && sparks.length === 0) {
        colsRef.current = []
        runningRef.current = false
        ctx.clearRect(0, 0, width, height)
        return
      }
      // 降级模式：动画时钟已冻结，画面不再变化 —— 淡入淡出跑完就停下，
      // 免得在用户明确要求「减少动效」时还挂着一个 60fps 的空转循环。
      if (still && sparks.length === 0 && Math.abs((active ? 1 : 0) - fade) < 0.005) {
        fadeRef.current = active ? 1 : 0
        runningRef.current = false
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    useImperativeHandle(ref, () => ({
      flow(options) {
        flowRef.current = { ...options, active: true }
        start()
      },
      stop() {
        flowRef.current.active = false
      },
      burst(options) {
        flowRef.current = { ...options, active: flowRef.current.active }
        const canvas = canvasRef.current
        if (canvas === null) return
        const rect = canvas.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return
        if (fadeRef.current <= 0.01) fadeRef.current = 1
        spawnBurst(endX(rect.width), rect.height / 2, options.intensity)
        start()
      },
    }), [])

    useEffect(() => () => {
      runningRef.current = false
      flowRef.current.active = false
      colsRef.current = []
      sparksRef.current = []
      if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current)
    }, [])

    return <canvas ref={canvasRef} className={className} aria-hidden />
  },
)
