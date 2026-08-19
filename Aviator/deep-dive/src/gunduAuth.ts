/** JWT from casino / APK WebView (?token=) */
export function captureGunduToken(): string {
  try {
    const p = new URLSearchParams(location.search)
    const q =
      p.get('token') ||
      p.get('access_token') ||
      p.get('accessToken') ||
      p.get('access') ||
      ''
    if (q) {
      localStorage.setItem('gundu_access_token', q)
      localStorage.setItem('access_token', q)
    }
  } catch (_) {}
  return (
    localStorage.getItem('gundu_access_token') ||
    localStorage.getItem('access_token') ||
    localStorage.getItem('accessToken') ||
    localStorage.getItem('token') ||
    ''
  )
}

export async function fetchGunduWalletBalance(): Promise<number | null> {
  const token = captureGunduToken()
  if (!token) return null
  try {
    const r = await fetch('/api/auth/wallet/', {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })
    if (!r.ok) return null
    const j = await r.json()
    const data = j.data || j
    const bal = data.balance ?? data.wallet_balance ?? data.available_balance
    const n = Number(bal)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}
