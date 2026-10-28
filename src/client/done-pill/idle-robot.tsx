/**
 * dsh-chat-plus — 对话胶囊（移植自 dsh-companion）— the idle mascot.
 *
 * Ports the macOS `IdleDirector` (macos/Sources/IdleRobot.swift) to the web.
 * The mascot is the vendored OpenBotMotion engine: a zero-dependency SVG
 * runtime with a continuous animated idle plus nine discrete character motions.
 * The scheduling policy itself lives in ./idle-director.ts.
 *
 * Driving contract — this mirrors the upstream exporter (tools/idle/index.html):
 *  - `mount(autoplay:false, loop:false)` paints only when we call `seek()`;
 *  - the engine resolves the pose through `window.poseFor(dataset.motion,
 *    window.previewTime ?? time)`, so `previewTime` is what actually selects the
 *    frame (`seek`'s own argument is clamped to the engine's 20.783s master
 *    loop and must not be used as a clock);
 *  - an empty `data-motion` yields the engine's own `getBotState(1, t)` — the
 *    continuous animated idle; a motion id yields that clip's pose.
 *
 * One rAF loop owns all motion, so the capsule costs frames only while visible.
 */
import { useEffect, useRef, type ReactElement } from 'react'
import OpenBotMotion from './vendor/open-bot-motion.js'
import { poseFor } from './vendor/idle-motions.js'
import { chooseMotion, clipDuration, prefersReducedMotion, rareSeconds, restSeconds, type Motion } from './idle-director'

export { BASICS, chooseMotion, restSeconds, rareSeconds } from './idle-director'

/**
 * The mascot's own framing.
 *
 * The engine hard-codes `viewBox="-140 -140 280 280"`, but the robot only
 * occupies about half of that, so at pill size it reads as a speck. These are
 * the measured union bounds of every pose we render (idle + all nine basics +
 * the rare dance), recentred with a hair of margin:
 *
 *   x ∈ [-136.3, 93.5]   y ∈ [-135.0, 96.8]
 *
 * Fitting that box makes the idle robot ~61% of the frame instead of ~51%,
 * while still never clipping the widest motions (hop / dance).
 */
const VIEW_BOX = '-136 -135 232 232'

/** The live robot instance returned by the engine's mount(). */
interface Robot {
  seek(t: number): void
  destroy(): void
}

/** The window globals the engine reads. */
interface EngineGlobals extends Window {
  poseFor?: (id: string | undefined, time: number) => unknown
  previewTime?: number
}

/**
 * The mascot's palette for the current theme.
 *
 * The engine defaults to a charcoal body with white eyes, which vanishes against
 * the pill's dark surface. These two values mirror the pill's own
 * `--dpl-fg` / surface in each theme (see PILL_CSS), so the robot always reads
 * as "ink on the pill" rather than as a fixed colour.
 */
function mascotPalette(): { body: number; eye: number } {
  const dark = typeof document !== 'undefined'
    && document.body !== null
    && document.body.hasAttribute('data-ds-dark-theme')
  // light theme: charcoal body, white eyes (matches --dpl-fg #2f3437)
  // dark theme:  warm-white body, dark eyes (matches --dpl-fg #d6d3cd)
  return dark ? { body: 0xd6d3cd, eye: 0x202020 } : { body: 0x2f3437, eye: 0xffffff }
}

/**
 * Install the pose resolver the engine calls every frame, plus the
 * `previewTime` channel that is the real clock. Returns a disposer restoring
 * any prior globals, so unmounting never leaves engine hooks behind.
 */
function installPoseResolver(): () => void {
  const g = window as EngineGlobals
  const hadPoseFor = Object.prototype.hasOwnProperty.call(g, 'poseFor')
  const previousPoseFor = g.poseFor
  const hadPreview = Object.prototype.hasOwnProperty.call(g, 'previewTime')
  const previousPreview = g.previewTime

  g.poseFor = (id: string | undefined, time: number) => {
    const state = (id === undefined || id === '')
      // Resting state: the engine's own continuous animated idle.
      ? OpenBotMotion.getBotState(1, time)
      // Active motion: the clip's pose at its own elapsed time.
      : poseFor(id, time)
    if (state === undefined || state === null || typeof state !== 'object') return state
    const withBot = state as { bot?: Record<string, unknown> }
    // The rare dance keeps its own 12-colour rotation — that IS the easter egg.
    if (id === 'dance' || withBot.bot === undefined) return state
    const palette = mascotPalette()
    return { ...state, bot: { ...withBot.bot, bodyColor: palette.body, eyeColor: palette.eye } }
  }

  return () => {
    if (hadPoseFor) g.poseFor = previousPoseFor
    else delete g.poseFor
    if (hadPreview) g.previewTime = previousPreview
    else delete g.previewTime
  }
}

/**
 * Mount, schedule and animate the idle mascot inside `container`.
 * @returns a disposer that stops the loop, restores globals, and tears down the SVG.
 */
export function startIdleRobot(container: HTMLElement, size = 22): () => void {
  const g = window as EngineGlobals
  const reduced = prefersReducedMotion()
  const restoreGlobals = installPoseResolver()

  let robot: Robot | undefined
  try {
    robot = OpenBotMotion.mount(container, {
      bot: 1,
      size,
      autoplay: false,
      loop: false,
    }) as Robot
  } catch {
    restoreGlobals()
    return () => {}
  }

  // Reframe the engine's overly loose viewBox so the mascot fills the pill.
  const svg = container.querySelector('svg')
  svg?.setAttribute('viewBox', VIEW_BOX)

  /** Paint one frame through the engine's previewTime channel. */
  const paint = (motion: string, poseTime: number): void => {
    container.dataset.motion = motion
    g.previewTime = poseTime
    robot?.seek(poseTime)
  }

  // Reduced motion still gets the mascot, frozen on a neutral frame.
  if (reduced) {
    paint('blink', 0)
    return () => {
      restoreGlobals()
      try { robot?.destroy() } catch { /* already gone */ }
    }
  }

  let rafId: number | undefined
  let stopped = false
  let previous: Motion | '' = ''
  let action: Motion | '' = ''
  let actionStarted = 0
  let nextBasicAt = 0
  let nextRareAt = 0

  const seconds = (): number => performance.now() / 1000
  const schedule = (from: number): void => {
    nextBasicAt = from + restSeconds()
    nextRareAt = from + rareSeconds()
  }

  const start = (now: number): void => {
    const chosen = chooseMotion(now, nextRareAt, previous)
    if (chosen === 'dance') nextRareAt = now + rareSeconds()
    action = chosen
    previous = chosen
    actionStarted = now
  }

  schedule(seconds())

  const tick = (): void => {
    if (stopped) return
    const now = seconds()

    if (action === '') {
      if (now >= nextBasicAt || now >= nextRareAt) start(now)
    } else if (now - actionStarted >= clipDuration(action)) {
      action = ''
      schedule(now)
    }

    try {
      if (action === '') paint('', now)
      else paint(action, now - actionStarted)
    } catch {
      /* A single bad frame must not kill the loop. */
    }

    rafId = requestAnimationFrame(tick)
  }

  rafId = requestAnimationFrame(tick)

  return () => {
    stopped = true
    if (rafId !== undefined) cancelAnimationFrame(rafId)
    restoreGlobals()
    try { robot?.destroy() } catch { /* already gone */ }
  }
}

/** Padding so the rendered SVG (which uses width/height:100%) can size itself. */
export interface IdleRobotProps {
  /** Intrinsic engine size in px; the container's CSS box wins for layout. */
  size?: number
  /** Extra class for the host container (the pill supplies its own). */
  className?: string
}

/** The mascot element: an empty container the engine paints into. */
export function IdleRobot({ size = 24, className }: IdleRobotProps): ReactElement {
  const host = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    const node = host.current
    if (!node) return
    return startIdleRobot(node, size)
  }, [size])

  return (
    <span
      ref={host}
      className={className === undefined ? 'dpl-idle-bot' : 'dpl-idle-bot ' + className}
      aria-hidden
    />
  )
}