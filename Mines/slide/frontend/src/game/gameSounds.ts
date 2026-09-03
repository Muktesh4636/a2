/**
 * Pin Stop — peg ticks synced to each multiplier box crossing the pin.
 */

import { scheduleTickTimesMs, SPIN_MS } from './slideSync'

type SfxKey = 'bet' | 'tick' | 'stop' | 'win' | 'lose'

const cache = new Map<SfxKey, HTMLAudioElement>()
let unlocked = false
let tickTimers: ReturnType<typeof setTimeout>[] = []
let lastTickAt = 0

const BASE = (import.meta.env.BASE_URL || '/slide/').replace(/\/?$/, '/')

function urlFor(key: SfxKey): string {
  return `${BASE}sounds/${key}.mp3`
}

function volFor(key: SfxKey): number {
  if (key === 'tick') return 0.44
  if (key === 'stop') return 0.58
  return 0.9
}

function getAudio(key: SfxKey): HTMLAudioElement | null {
  try {
    let a = cache.get(key)
    if (!a) {
      a = new Audio(urlFor(key))
      a.preload = 'auto'
      a.volume = volFor(key)
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
  ;(['bet', 'tick', 'stop', 'win', 'lose'] as SfxKey[]).forEach((k) => {
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
        a.volume = volFor(k)
      }
      if (p && typeof p.then === 'function') {
        p.then(finish).catch(() => {
          a.muted = false
          a.volume = volFor(k)
        })
      } else {
        finish()
      }
    } catch {
      a.muted = false
      a.volume = volFor(k)
    }
  })
}

function play(key: SfxKey, rate = 1): void {
  unlockGameAudio()
  const base = getAudio(key)
  if (!base) return
  try {
    const a = base.cloneNode(true) as HTMLAudioElement
    a.volume = volFor(key)
    a.playbackRate = rate
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

function playTick(): void {
  const now = performance.now()
  if (now - lastTickAt < 26) return
  lastTickAt = now
  play('tick', 0.94 + Math.random() * 0.12)
}

export function startSlideTicks(
  from: number,
  to: number,
  viewportWidth: number,
  reelLength: number,
  durationMs = SPIN_MS,
): void {
  stopSlideTicks()
  unlockGameAudio()
  lastTickAt = 0

  const times = scheduleTickTimesMs(from, to, viewportWidth, reelLength, durationMs)
  for (const delay of times) {
    tickTimers.push(setTimeout(() => playTick(), Math.max(0, delay)))
  }
}

export function stopSlideTicks(): void {
  for (const id of tickTimers) clearTimeout(id)
  tickTimers = []
}

export function playStopSound(): void {
  play('stop', 1)
}

export function playResultSound(won: boolean): void {
  play(won ? 'win' : 'lose')
}

;(['bet', 'tick', 'stop', 'win', 'lose'] as SfxKey[]).forEach(getAudio)
