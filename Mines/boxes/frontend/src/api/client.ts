
function captureGunduToken() {
  try {
    const q = new URLSearchParams(location.search)
    const t = q.get('token') || q.get('access_token')
    if (t) localStorage.setItem('gundu_access_token', t)
  } catch (_) {}
}
captureGunduToken()

const API_BASE = import.meta.env.VITE_API_URL ?? '/api/boxes'
const PLAYER_KEY = 'boxes_player_id'

export type ApiCell = {
  index: number
  selected: boolean
  multiplier: string | null
  highlight: boolean
}

export type ApiGame = {
  id: string
  status: 'selecting' | 'settled'
  bet_amount: string
  selected: number[]
  pick_count: number
  rows: number
  cols: number
  total_multiplier: string
  payout: string
  profit: string
  board: ApiCell[]
  balance: string
  player_id: string
}

export type ApiPlayer = {
  player_id: string
  balance: string
  active_game: ApiGame | null
}

function getPlayerId(): string | null {
  return localStorage.getItem(PLAYER_KEY)
}

function savePlayerId(id: string) {
  localStorage.setItem(PLAYER_KEY, id)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  }
  const playerId = getPlayerId()
  if (playerId) headers['X-Player-Id'] = playerId
  const jwt = localStorage.getItem('gundu_access_token') || localStorage.getItem('access_token')
  if (jwt) headers['Authorization'] = `Bearer ${jwt}`

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers })
  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    const detail =
      data.detail ||
      data.bet_amount?.[0] ||
      data.index?.[0] ||
      'Request failed'
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }

  if (data.player_id) savePlayerId(data.player_id)
  return data as T
}

export function fetchPlayer() {
  return request<ApiPlayer>('/player/')
}

export function selectBox(index: number) {
  return request<ApiGame>('/games/select/', {
    method: 'POST',
    body: JSON.stringify({ index }),
  })
}

export function placeBet(betAmount: number) {
  return request<ApiGame>('/games/bet/', {
    method: 'POST',
    body: JSON.stringify({ bet_amount: betAmount.toFixed(2) }),
  })
}

export function newRound() {
  return request<ApiGame>('/games/new/', { method: 'POST' })
}
