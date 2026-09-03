/**
 * Hi-Lo Cards SFX — deal / flip / win / lose / bet
 */

type SfxKey = 'bet' | 'deal' | 'flip' | 'win' | 'lose'

const cache = new Map<SfxKey, HTMLAudioElement>()
let unlocked = false

const BASE = (import.meta.env.BASE_URL || '/hi-lo-cards/').replace(/\/?$/, '/')

const VOL: Record<SfxKey, number> = {
  bet: 0.55,
  deal: 0.5,
  flip: 0.62,
  win: 0.9,
  lose: 0.85,
}

function urlFor(key: SfxKey): string {
  return `${BASE}sounds/${key}.mp3`
}

function getAudio(key: SfxKey): HTMLAudioElement | null {
  try {
    let a = cache.get(key)
    if (!a) {
      a = new Audio(urlFor(key))
      a.preload = 'auto'
      a.volume = VOL[key]
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
  ;(['bet', 'deal', 'flip', 'win', 'lose'] as SfxKey[]).forEach((k) => {
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
        a.volume = VOL[k]
      }
      if (p && typeof p.then === 'function') {
        p.then(finish).catch(() => {
          a.muted = false
          a.volume = VOL[k]
        })
      } else {
        finish()
      }
    } catch {
      a.muted = false
      a.volume = VOL[k]
    }
  })
}

function play(key: SfxKey, rate = 1): void {
  unlockGameAudio()
  const base = getAudio(key)
  if (!base) return
  try {
    const a = base.cloneNode(true) as HTMLAudioElement
    a.volume = VOL[key]
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

export function playDealSound(): void {
  play('deal', 0.95 + Math.random() * 0.1)
}

export function playFlipSound(): void {
  play('flip', 0.97 + Math.random() * 0.06)
}

export function playResultSound(won: boolean): void {
  play(won ? 'win' : 'lose')
}

;(['bet', 'deal', 'flip', 'win', 'lose'] as SfxKey[]).forEach(getAudio)
