/**
 * Sky Path SFX — soft steps, sparkle on safe tiles, warm cash-out.
 */

let ctx: AudioContext | null = null
let master: GainNode | null = null
let unlocked = false

function ac(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return null
      ctx = new Ctx()
      master = ctx.createGain()
      master.gain.value = 0.55
      master.connect(ctx.destination)
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

export function unlockGameAudio() {
  if (unlocked) return
  const c = ac()
  if (!c) return
  unlocked = true
  const g = c.createGain()
  g.gain.value = 0.0001
  const o = c.createOscillator()
  o.connect(g)
  g.connect(c.destination)
  o.start()
  o.stop(c.currentTime + 0.01)
}

function envGain(c: AudioContext, peak: number, attack: number, release: number, when = c.currentTime) {
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, when)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, when + attack + release)
  if (master) g.connect(master)
  else g.connect(c.destination)
  return g
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', peak = 0.2, when = 0) {
  const c = ac()
  if (!c || !master) return
  const t0 = c.currentTime + when
  const o = c.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(freq, t0)
  const g = envGain(c, peak, 0.01, dur * 0.9, t0)
  o.connect(g)
  o.start(t0)
  o.stop(t0 + dur + 0.04)
}

export function playBetSound() {
  unlockGameAudio()
  tone(440, 0.08, 'triangle', 0.1)
  tone(660, 0.12, 'sine', 0.08, 0.04)
}

/** Safe step / egg — soft footfall + sparkle */
export function playStepSound(stepsCleared = 1) {
  unlockGameAudio()
  const lift = Math.min(10, stepsCleared) * 22
  tone(180 + lift * 0.4, 0.06, 'triangle', 0.1) // soft thud
  tone(620 + lift, 0.16, 'sine', 0.18, 0.03)
  tone(930 + lift, 0.2, 'triangle', 0.08, 0.06)
}

export function playDangerSound() {
  unlockGameAudio()
  const c = ac()
  if (!c || !master) return
  const t0 = c.currentTime
  const o = c.createOscillator()
  o.type = 'sawtooth'
  o.frequency.setValueAtTime(220, t0)
  o.frequency.exponentialRampToValueAtTime(70, t0 + 0.28)
  const f = c.createBiquadFilter()
  f.type = 'lowpass'
  f.frequency.value = 600
  const g = envGain(c, 0.28, 0.01, 0.32, t0)
  o.connect(f)
  f.connect(g)
  o.start(t0)
  o.stop(t0 + 0.35)
  tone(140, 0.2, 'sine', 0.2, 0.02)
}

export function playCashOutSound() {
  unlockGameAudio()
  const notes = [392, 493.88, 587.33, 784] // G4 B4 D5 G5
  notes.forEach((f, i) => {
    tone(f, 0.26, 'sine', 0.15, i * 0.08)
    tone(f * 2, 0.18, 'triangle', 0.045, i * 0.08 + 0.02)
  })
}
