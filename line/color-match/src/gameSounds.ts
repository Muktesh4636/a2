/**
 * Color Match SFX — HTMLAudioElement + local MP3s (/color-match/sounds/*.mp3)
 */

type SfxKey = 'bet' | 'spin' | 'stop' | 'win' | 'lose'

const cache = new Map<SfxKey, HTMLAudioElement>()
let unlocked = false
let spinEl: HTMLAudioElement | null = null
let spinTimer: ReturnType<typeof setTimeout> | null = null

const BASE = (import.meta.env.BASE_URL || '/color-match/').replace(/\/?$/, '/')

function urlFor(key: SfxKey): string {
  return `${BASE}sounds/${key}.mp3`
}

function volFor(key: SfxKey): number {
  if (key === 'spin') return 0.65
  if (key === 'stop') return 0.75
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

function play(key: SfxKey): void {
  unlockGameAudio()
  const base = getAudio(key)
  if (!base) return
  try {
    const a = base.cloneNode(true) as HTMLAudioElement
    a.volume = volFor(key)
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

/** Reel roll — one 3.5s clip synced to CSS spin duration. */
export function playSpinSound(durationMs = 3500): void {
  stopSpinSound()
  unlockGameAudio()
  const base = getAudio('spin')
  if (!base) return
  try {
    spinEl = base.cloneNode(true) as HTMLAudioElement
    spinEl.volume = 0.65
    spinEl.currentTime = 0
    void spinEl.play().catch(() => {})
    spinTimer = setTimeout(() => stopSpinSound(), durationMs)
  } catch {
    play('spin')
  }
}

export function stopSpinSound(): void {
  if (spinTimer) {
    clearTimeout(spinTimer)
    spinTimer = null
  }
  if (spinEl) {
    try {
      spinEl.pause()
      spinEl.currentTime = 0
    } catch {
      /* ignore */
    }
    spinEl = null
  }
}

export function playStopSound(): void {
  play('stop')
}

export function playResultSound(won: boolean): void {
  play(won ? 'win' : 'lose')
}

export function stopGameAudio(): void {
  stopSpinSound()
  cache.forEach((a) => {
    try {
      a.pause()
      a.currentTime = 0
    } catch {
      /* ignore */
    }
  })
}

;(['bet', 'spin', 'stop', 'win', 'lose'] as SfxKey[]).forEach(getAudio)

if (typeof window !== 'undefined') {
  ;(window as unknown as { stopGameAudio?: () => void }).stopGameAudio = stopGameAudio
  window.addEventListener('pagehide', stopGameAudio)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stopGameAudio()
  })
}
