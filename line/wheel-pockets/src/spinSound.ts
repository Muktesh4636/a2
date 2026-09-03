/**
 * Spin sound synced to CSS wheel/reel rotation.
 * Call playSpinSoundAfterPaint(durationMs) when the rotation transition starts.
 */

const BASE = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')
const SPIN_URL = `${BASE}sounds/spin.wav`

let spinEl: HTMLAudioElement | null = null
let rafId = 0
let stopTimer: ReturnType<typeof setTimeout> | null = null

const DEFAULT_BEZIER: [number, number, number, number] = [0.12, 0.75, 0.08, 1]

const ensureSpin = () => {
  if (spinEl) return spinEl
  try {
    spinEl = new Audio(SPIN_URL)
    spinEl.preload = 'auto'
    spinEl.volume = 0.85
    spinEl.load()
    return spinEl
  } catch {
    return null
  }
}

function bezierComponent(u: number, p0: number, p1: number, p2: number, p3: number): number {
  const inv = 1 - u
  return inv * inv * inv * p0 + 3 * inv * inv * u * p1 + 3 * inv * u * u * p2 + u * u * u * p3
}

/** CSS cubic-bezier progress at wall-clock fraction t ∈ [0, 1]. */
function bezierProgress(
  t: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  let lo = 0
  let hi = 1
  for (let i = 0; i < 14; i++) {
    const u = (lo + hi) / 2
    const x = bezierComponent(u, 0, x1, x2, 1)
    if (x < t) lo = u
    else hi = u
  }
  const u = (lo + hi) / 2
  return bezierComponent(u, 0, y1, y2, 1)
}

/** Approximate d(progress)/dt — matches how fast the wheel is turning. */
function bezierVelocity(
  t: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dt = 0.01
  const p0 = bezierProgress(Math.max(0, t - dt), x1, y1, x2, y2)
  const p1 = bezierProgress(Math.min(1, t + dt), x1, y1, x2, y2)
  return (p1 - p0) / (2 * dt)
}

function rateForProgress(t: number, bez: [number, number, number, number] = DEFAULT_BEZIER): number {
  const vel = bezierVelocity(t, bez[0], bez[1], bez[2], bez[3])
  const minRate = 0.28
  const maxRate = 1.14
  const peakVel = 2.65
  const normalized = Math.min(1.4, vel / peakVel)
  return Math.max(minRate, minRate + normalized * (maxRate - minRate))
}

export function preloadSpinSound() {
  ensureSpin()
}

/** Start roll sound — pass the same duration as the CSS spin transition (ms). */
export function playSpinSound(
  durationMs: number,
  bez: [number, number, number, number] = DEFAULT_BEZIER,
) {
  stopSpinSound()
  const a = ensureSpin()
  if (!a || durationMs <= 0) return

  try {
    a.loop = true
    a.volume = 0.85
    a.currentTime = 0
    a.playbackRate = rateForProgress(0, bez)
    void a.play().catch(() => {})
  } catch {
    return
  }

  const startAt = performance.now()
  const tick = () => {
    const t = (performance.now() - startAt) / durationMs
    if (a && !a.paused) a.playbackRate = rateForProgress(t, bez)
    if (t < 1) rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)

  stopTimer = setTimeout(() => stopSpinSound(), durationMs)
}

/** Wait for React paint so audio starts with the CSS transition. */
export function playSpinSoundAfterPaint(
  durationMs: number,
  bez: [number, number, number, number] = DEFAULT_BEZIER,
) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => playSpinSound(durationMs, bez))
  })
}

export function stopSpinSound() {
  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = 0
  }
  if (stopTimer) {
    clearTimeout(stopTimer)
    stopTimer = null
  }
  if (!spinEl) return
  try {
    spinEl.pause()
    spinEl.currentTime = 0
    spinEl.playbackRate = 1
  } catch {
    /* ignore */
  }
}

preloadSpinSound()
