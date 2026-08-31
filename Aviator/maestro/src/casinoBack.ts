/** Back to casino lobby — prefer history.back() to avoid reload / loading bar */
import { captureGunduToken } from './gunduAuth'

const FROM_CASINO_KEY = 'gundu_from_casino'

function casinoUrl() {
  const u = new URL('/casino/', location.origin)
  const t = captureGunduToken()
  if (t) u.searchParams.set('token', t)
  return u.toString()
}

function cameFromCasino(): boolean {
  try {
    if (sessionStorage.getItem(FROM_CASINO_KEY) === '1') return true
  } catch (_) {}
  try {
    if ((document.referrer || '').includes('/casino')) return true
  } catch (_) {}
  return false
}

/** Stop HTML media + any game-provided WebAudio hooks (crash flight loops, etc.). */
export function stopAllAudio() {
  try {
    const w = window as any
    if (typeof w.stopGameAudio === 'function') w.stopGameAudio()
    if (typeof w.silenceGameAudio === 'function') w.silenceGameAudio(true)
  } catch (_) {}
  try {
    document.querySelectorAll('audio, video').forEach((el) => {
      const m = el as HTMLMediaElement
      try {
        m.pause()
        m.muted = true
        m.currentTime = 0
      } catch (_) {}
    })
  } catch (_) {}
}

function goCasino() {
  stopAllAudio()
  try {
    if ((window as any).AndroidBridge?.goBack) {
      ;(window as any).AndroidBridge.goBack()
      return
    }
  } catch (_) {}

  // Restore the existing casino tab from history (bfcache) — no loading bar.
  if (cameFromCasino() && history.length > 1) {
    let left = false
    const markLeft = () => {
      left = true
    }
    window.addEventListener('pagehide', markLeft, { once: true })
    window.addEventListener('unload', markLeft, { once: true })
    history.back()
    window.setTimeout(() => {
      if (left) return
      try {
        sessionStorage.removeItem(FROM_CASINO_KEY)
      } catch (_) {}
      location.replace(casinoUrl())
    }, 450)
    return
  }

  location.replace(casinoUrl())
}

export function installCasinoBack(_gameId: string) {
  captureGunduToken()
  try {
    if ((document.referrer || '').includes('/casino')) {
      sessionStorage.setItem(FROM_CASINO_KEY, '1')
    }
  } catch (_) {}

  // Kill sound when leaving / backgrounding (history.back bfcache keeps AudioContext alive otherwise)
  window.addEventListener('pagehide', stopAllAudio)
  window.addEventListener('freeze', stopAllAudio as EventListener)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stopAllAudio()
  })

  if (document.getElementById('gunduBackBtn')) return
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.id = 'gunduBackBtn'
  btn.setAttribute('aria-label', 'Back to Casino')
  btn.style.cssText =
    'position:fixed;top:max(10px,env(safe-area-inset-top));left:10px;z-index:9999;' +
    'width:40px;height:40px;border-radius:12px;border:1px solid rgba(255,255,255,.18);' +
    'background:rgba(0,0,0,.55);color:#fff;display:grid;place-items:center;cursor:pointer;' +
    'backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);'
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15.5 4.5 8 12l7.5 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  btn.addEventListener('click', goCasino)
  document.body.appendChild(btn)
  // Intentionally no pushState/popstate → location.replace(casino):
  // that forced a full casino reload and showed the loading bar again.
}
