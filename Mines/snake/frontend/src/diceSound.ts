/**
 * Dice roll SFX — plays alongside the dice (does not drive animation).
 * Preloaded so playback starts immediately on throw.
 */

let sfx: HTMLAudioElement | null = null
let primed = false

function getSfx(): HTMLAudioElement | null {
  if (sfx) return sfx
  try {
    const a = new Audio(`${import.meta.env.BASE_URL}sounds/dice-roll.wav`)
    a.preload = 'auto'
    a.volume = 0.9
    // Kick off network fetch immediately
    a.load()
    sfx = a
    return a
  } catch {
    return null
  }
}

/** Call early (app mount / button press) so the first throw isn't delayed. */
export function preloadDiceRollSound() {
  getSfx()
}

/**
 * Browsers block audio until a user gesture. Call this from the Play click
 * before any await so the element is unlocked and buffered.
 */
export function primeDiceRollSound() {
  const a = getSfx()
  if (!a || primed) return
  primed = true
  try {
    const vol = a.volume
    a.volume = 0
    a.currentTime = 0
    const p = a.play()
    if (p && typeof p.then === 'function') {
      void p
        .then(() => {
          a.pause()
          a.currentTime = 0
          a.volume = vol
        })
        .catch(() => {
          a.volume = vol
          primed = false
        })
    } else {
      a.pause()
      a.currentTime = 0
      a.volume = vol
    }
  } catch {
    primed = false
  }
}

/** Play the dice sound immediately when a throw starts. */
export function startDiceRollSound() {
  const a = getSfx()
  if (!a) return
  try {
    a.pause()
    a.currentTime = 0
    a.volume = 0.9
    a.loop = false
    void a.play().catch(() => {})
  } catch {
    /* ignore */
  }
}

export function stopDiceRollSound() {
  const a = getSfx()
  if (!a) return
  try {
    a.pause()
    a.currentTime = 0
  } catch {
    /* ignore */
  }
}

/** Original tumble window before land. */
export const DICE_ROLL_MS = 1200
/** Original settle wait after land starts. */
export const DICE_LAND_MS = 1300

preloadDiceRollSound()
