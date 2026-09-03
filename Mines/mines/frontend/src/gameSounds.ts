/**
 * Mines SFX via HTMLAudioElement (same reliable pattern as Chicken Road).
 * Files live in /mines/sounds/*.mp3
 */

type SfxKey = 'tap' | 'gem' | 'mine' | 'bet' | 'cash'

const cache = new Map<SfxKey, HTMLAudioElement>()
let unlocked = false

function urlFor(key: SfxKey): string {
  const base = (import.meta.env.BASE_URL || '/mines/').replace(/\/?$/, '/')
  return `${base}sounds/${key}.mp3`
}

function getAudio(key: SfxKey): HTMLAudioElement | null {
  try {
    let a = cache.get(key)
    if (!a) {
      a = new Audio(urlFor(key))
      a.preload = 'auto'
      a.volume = key === 'mine' ? 1 : 0.9
      cache.set(key, a)
    }
    return a
  } catch {
    return null
  }
}

/** Warm up elements on first user gesture so later plays work after await. */
export function unlockGameAudio(): void {
  if (unlocked) return
  unlocked = true
  ;(['tap', 'gem', 'mine', 'bet', 'cash'] as SfxKey[]).forEach((k) => {
    const a = getAudio(k)
    if (!a) return
    try {
      a.muted = true
      a.volume = 0
      const p = a.play()
      if (p && typeof p.then === 'function') {
        p.then(() => {
          a.pause()
          a.currentTime = 0
          a.muted = false
          a.volume = k === 'mine' ? 1 : 0.9
        }).catch(() => {
          a.muted = false
          a.volume = k === 'mine' ? 1 : 0.9
        })
      } else {
        a.pause()
        a.currentTime = 0
        a.muted = false
        a.volume = k === 'mine' ? 1 : 0.9
      }
    } catch {
      if (a) {
        a.muted = false
        a.volume = k === 'mine' ? 1 : 0.9
      }
    }
  })
}

function play(key: SfxKey): void {
  unlockGameAudio()
  const base = getAudio(key)
  if (!base) return
  try {
    // Clone so rapid gem taps / blast can overlap
    const a = base.cloneNode(true) as HTMLAudioElement
    a.volume = key === 'mine' ? 1 : 0.9
    a.currentTime = 0
    void a.play().catch(() => {
      // Fallback: reuse base element
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

export function playTapSound(): void {
  play('tap')
}

export function playBetSound(): void {
  play('bet')
}

export function playGemSound(_gemsFound = 1): void {
  play('gem')
}

export function playMineSound(): void {
  play('mine')
}

export function playCashOutSound(): void {
  play('cash')
}

// Preload as soon as module loads
;(['tap', 'gem', 'mine', 'bet', 'cash'] as SfxKey[]).forEach(getAudio)
