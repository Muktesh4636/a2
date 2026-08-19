import { authHeaders, captureGunduToken } from './gunduAuth'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api/circle-game'
captureGunduToken()

export interface SessionResponse {
  player_id: string
  balance: string
  currency: string
  currency_symbol: string
}

export interface SpinResponse {
  spin_id: string
  player_id: string
  bet_amount: string
  segment_id: string
  color: string
  multiplier: string
  payout: string
  target_angle: number
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
  return request<SessionResponse & { last_spin?: unknown }>(`/session/${playerId}/`)
}

export function placeSpin(playerId: string, betAmount: number) {
  return request<SpinResponse>('/spin/', {
    method: 'POST',
    body: JSON.stringify({
      player_id: playerId,
      bet_amount: betAmount.toFixed(2),
    }),
  })
}

const PLAYER_KEY = 'line_player_id'

export function loadPlayerId(): string | null {
  return localStorage.getItem(PLAYER_KEY)
}

export function savePlayerId(id: string) {
  localStorage.setItem(PLAYER_KEY, id)
}
