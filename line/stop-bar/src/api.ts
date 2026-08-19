import { authHeaders, captureGunduToken } from './gunduAuth'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api/stop-bar'
captureGunduToken()

export interface SessionResponse {
  player_id: string
  balance: string
  currency: string
  currency_symbol: string
}

export interface PlayResponse {
  play_id: string
  player_id: string
  bet_amount: string
  zone_id: string
  color: string
  multiplier: string
  payout: string
  target_position: number
  balance: string
  currency: string
  currency_symbol: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: authHeaders({ 'Content-Type': 'application/json', ...(init?.headers as Record<string, string> | undefined) }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(
      typeof data.detail === 'string' ? data.detail : `Request failed (${res.status})`,
    )
  }
  return data as T
}

export function createSession() {
  return request<SessionResponse>('/session/', { method: 'POST' })
}

export function getSession(playerId: string) {
  return request<SessionResponse>(`/session/${playerId}/`)
}

export function placePlay(playerId: string, betAmount: number) {
  return request<PlayResponse>('/play/', {
    method: 'POST',
    body: JSON.stringify({
      player_id: playerId,
      bet_amount: betAmount.toFixed(2),
    }),
  })
}

const PLAYER_KEY = 'stopbar_player_id'

export function loadPlayerId(): string | null {
  return localStorage.getItem(PLAYER_KEY)
}

export function savePlayerId(id: string) {
  localStorage.setItem(PLAYER_KEY, id)
}
