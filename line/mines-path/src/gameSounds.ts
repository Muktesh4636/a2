/**
 * Mines Path SFX — HTMLAudioElement + local MP3s (/mines-path/sounds/*.mp3)
 */

type SfxKey = 'tap' | 'gem' | 'mine' | 'bet' | 'cash'

const cache = new Map<SfxKey, HTMLAudioElement>()
let unlocked = false

const BASE = (import.meta.env.BASE_URL || '/mines-path/').replace(/\/?$/, '/')

function urlFor(key: SfxKey): string {
  return `${BASE}sounds/${key}.mp3`
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
      const finish = () => {
        a.pause()
        a.currentTime = 0
        a.muted = false
        a.volume = k === 'mine' ? 1 : 0.9
      }
      if (p && typeof p.then === 'function') {
        p.then(finish).catch(() => {
          a.muted = false
          a.volume = k === 'mine' ? 1 : 0.9
        })
      } else {
        finish()
      }
    } catch {
      a.muted = false
      a.volume = k === 'mine' ? 1 : 0.9
    }
  })
}

function play(key: SfxKey): void {
  unlockGameAudio()
  const base = getAudio(key)
  if (!base) return
  try {
    const a = base.cloneNode(true) as HTMLAudioElement
    a.volume = key === 'mine' ? 1 : 0.9
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

export function stopGameAudio(): void {
  cache.forEach((a) => {
    try {
      a.pause()
      a.currentTime = 0
    } catch {
      /* ignore */
    }
  })
}

export function playTapSound(): void {
  play('tap')
}

export function playBetSound(): void {
  play('bet')
}

export function playGemSound(): void {
  play('gem')
}

export function playMineSound(): void {
  play('mine')
}

export function playCashOutSound(): void {
  play('cash')
}

;(['tap', 'gem', 'mine', 'bet', 'cash'] as SfxKey[]).forEach(getAudio)

if (typeof window !== 'undefined') {
  ;(window as unknown as { stopGameAudio?: () => void }).stopGameAudio = stopGameAudio
  window.addEventListener('pagehide', stopGameAudio)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stopGameAudio()
  })
}
