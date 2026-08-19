/** Back to casino lobby — keeps JWT on the URL */
import { captureGunduToken } from './gunduAuth'

function casinoUrl() {
  const u = new URL('/casino/', location.origin)
  const t = captureGunduToken()
  if (t) u.searchParams.set('token', t)
  return u.toString()
}

function goCasino() {
  try {
    if (window.AndroidBridge && typeof window.AndroidBridge.goBack === 'function') {
      window.AndroidBridge.goBack()
      return
    }
  } catch (_) {}
  location.href = casinoUrl()
}

declare global {
  interface Window {
    AndroidBridge?: { goBack?: () => void; openGame?: (id: string, url: string) => void }
  }
}

export function installCasinoBack(gameId: string) {
  captureGunduToken()
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

  try {
    history.pushState({ gundu_game: gameId }, '', location.href)
    window.addEventListener('popstate', () => location.replace(casinoUrl()))
  } catch (_) {}
}
