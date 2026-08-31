/** Shared wheel-spin SFX (same asset as Vortex / daily reward). */
let sfx: HTMLAudioElement | null = null

function getSfx(): HTMLAudioElement | null {
  if (sfx) return sfx
  try {
    const a = new Audio(new URL('/vortex/sounds/spin.wav', window.location.origin).href)
    a.preload = 'auto'
    a.volume = 0.75
    sfx = a
    return a
  } catch {
    return null
  }
}

export function playSpinSound() {
  const a = getSfx()
  if (!a) return
  try {
    a.pause()
    a.currentTime = 0
    void a.play().catch(() => {})
  } catch {
    /* ignore autoplay / decode errors */
  }
}

export function stopSpinSound() {
  const a = getSfx()
  if (!a) return
  try {
    a.pause()
    a.currentTime = 0
  } catch {
    /* ignore */
  }
}
