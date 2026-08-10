
function captureGunduToken() {
  try {
    const q = new URLSearchParams(location.search)
    const t = q.get('token') || q.get('access_token')
    if (t) localStorage.setItem('gundu_access_token', t)
  } catch (_) {}
}
captureGunduToken()

const API_BASE = import.meta.env.VITE_API_URL ?? '/api/snake'
const PLAYER_KEY = 'snake_player_id'

export type TrackTile = {
  index: number
  type: 'start' | 'mult' | 'snake'
  multiplier?: string
}

export type ActiveGame = {
  id: string
  status: 'idle' | 'playing' | 'won' | 'lost'
  bet_amount: string
  die1: number | null
  die2: number | null
  dice_sum: number | null
  land_index: number | null
  multiplier: string
  payout: string
  profit: string
}

export type ApiState = {
  track: TrackTile[]
  balance: string
  player_id: string
  active_game: ActiveGame | null
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
    const detail = data.detail || data.bet_amount?.[0] || 'Request failed'
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }

  if (data.player_id) savePlayerId(data.player_id)
  return data as T
}

export function fetchPlayer() {
  return request<ApiState>('/player/')
}

export function playRound(betAmount: number) {
  return request<ApiState>('/play/', {
    method: 'POST',
    body: JSON.stringify({ bet_amount: betAmount.toFixed(2) }),
  })
}
