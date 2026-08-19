const BASE = import.meta.env.BASE_URL

function load(file, { loop = false, volume = 1 } = {}) {
  try {
    const a = new Audio(`${BASE}sounds/${file}`)
    a.preload = 'auto'
    a.loop = loop
    a.volume = volume
    return a
  } catch (_) {
    return null
  }
}

const jumpSfx = load('jump.mp3', { volume: 1 })
const bgm = load('purity-piano.mp3', { loop: true, volume: 0.32 })

let jumpUnlocked = false
let musicOn = localStorage.getItem('chicken_music_off') !== '1'

export function isMusicOn() {
  return musicOn
}

export function playJump() {
  if (!jumpSfx) return
  try {
    jumpSfx.muted = false
    const shot = jumpSfx.cloneNode(true)
    shot.volume = 1
    const p = shot.play()
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        jumpSfx.currentTime = 0
        void jumpSfx.play().catch(() => {})
      })
    }
  } catch (_) {}
}

export function startBgm() {
  if (!bgm || !musicOn) return
  bgm.muted = false
  const p = bgm.play()
  if (p && typeof p.catch === 'function') p.catch(() => {})
}

export function setMusicOn(on) {
  musicOn = !!on
  localStorage.setItem('chicken_music_off', musicOn ? '0' : '1')
  if (musicOn) startBgm()
  else if (bgm) bgm.pause()
}

export function unlockAudio() {
  if (jumpSfx && !jumpUnlocked) {
    jumpSfx.muted = true
    const p = jumpSfx.play()
    const done = () => {
      jumpUnlocked = true
      jumpSfx.muted = false
    }
    if (p && typeof p.then === 'function') {
      void p
        .then(() => {
          jumpSfx.pause()
          jumpSfx.currentTime = 0
          done()
        })
        .catch(() => done())
    } else {
      done()
    }
  }
  startBgm()
}
