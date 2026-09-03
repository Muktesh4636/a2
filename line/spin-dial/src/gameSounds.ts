/**
 * Spin Dial SFX — HTMLAudioElement + local MP3s (/spin-dial/sounds/*.mp3)
 */

type SfxKey = 'bet' | 'spin' | 'stop' | 'win' | 'lose'

const cache = new Map<SfxKey, HTMLAudioElement>()
let unlocked = false
let spinEl: HTMLAudioElement | null = null
let spinRateRaf = 0
let spinStopTimer: ReturnType<typeof setTimeout> | null = null

const BASE = (import.meta.env.BASE_URL || '/spin-dial/').replace(/\/?$/, '/')

function urlFor(key: SfxKey): string {
  return `${BASE}sounds/${key}.mp3`
}

function getAudio(key: SfxKey): HTMLAudioElement | null {
  try {
    let a = cache.get(key)
    if (!a) {
      a = new Audio(urlFor(key))
      a.preload = 'auto'
      a.volume = key === 'spin' ? 0.85 : 0.9
      cache.set(key, a)
    }
    return a
  } catch {
    return null
  }
}

export function unlockGameAudio(): void {
  if (unlocked) return
  unlocked = true
  ;(['bet', 'spin', 'stop', 'win', 'lose'] as SfxKey[]).forEach((k) => {
    const a = getAudio(k)
    if (!a) return
    try {
      a.muted = true
      a.volume = 0
      const p = a.play()
      const finish = () => {
        a.pause()
        a.currentTime = 0
        a.muted = false
        a.volume = k === 'spin' ? 0.85 : 0.9
      }
      if (p && typeof p.then === 'function') {
        p.then(finish).catch(() => {
          a.muted = false
          a.volume = k === 'spin' ? 0.85 : 0.9
        })
      } else {
        finish()
      }
    } catch {
      a.muted = false
      a.volume = k === 'spin' ? 0.85 : 0.9
    }
  })
}

function play(key: SfxKey): void {
  unlockGameAudio()
  const base = getAudio(key)
  if (!base) return
  try {
    const a = base.cloneNode(true) as HTMLAudioElement
    a.volume = key === 'spin' ? 0.85 : 0.9
    a.currentTime = 0
    void a.play().catch(() => {
      try {
        base.currentTime = 0
        void base.play().catch(() => {})
      } catch {
        /* ignore */
      }
    })
  } catch {
    try {
      base.currentTime = 0
      void base.play().catch(() => {})
    } catch {
      /* ignore */
    }
  }
}

export function playBetSound(): void {
  play('bet')
}

/** Wheel spin — synced to dial rotation (same duration as CSS transition). */
function bezierComponent(u: number, p0: number, p1: number, p2: number, p3: number): number {
  const inv = 1 - u
  return inv * inv * inv * p0 + 3 * inv * inv * u * p1 + 3 * inv * u * u * p2 + u * u * u * p3
}

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

function rateForProgress(t: number): number {
  const vel = bezierVelocity(t, 0.12, 0.75, 0.08, 1)
  const minRate = 0.28
  const maxRate = 1.14
  return Math.max(minRate, minRate + Math.min(1.4, vel / 2.65) * (maxRate - minRate))
}

export function playSpinSoundAfterPaint(durationMs = 5000): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => playSpinSound(durationMs))
  })
}

export function playSpinSound(durationMs = 5000): void {
  unlockGameAudio()
  stopSpinSound()
  try {
    spinEl = new Audio(`${BASE}sounds/spin.wav`)
    spinEl.preload = 'auto'
    spinEl.loop = true
    spinEl.volume = 0.85
    spinEl.currentTime = 0
    spinEl.playbackRate = rateForProgress(0)
    void spinEl.play().catch(() => play('spin'))

    const startAt = performance.now()
    const tick = () => {
      if (!spinEl) return
      const t = (performance.now() - startAt) / durationMs
      spinEl.playbackRate = rateForProgress(t)
      if (t < 1) spinRateRaf = requestAnimationFrame(tick)
    }
    spinRateRaf = requestAnimationFrame(tick)
    spinStopTimer = setTimeout(() => stopSpinSound(), durationMs)
  } catch {
    play('spin')
  }
}

export function stopSpinSound(): void {
  if (spinRateRaf) cancelAnimationFrame(spinRateRaf)
  spinRateRaf = 0
  if (spinStopTimer) clearTimeout(spinStopTimer)
  spinStopTimer = null
  if (spinEl) {
    try {
      spinEl.pause()
      spinEl.currentTime = 0
      spinEl.playbackRate = 1
    } catch {
      /* ignore */
    }
    spinEl = null
  }
}

export function playResultSound(won: boolean): void {
  play(won ? 'win' : 'lose')
}

;(['bet', 'spin', 'stop', 'win', 'lose'] as SfxKey[]).forEach(getAudio)
