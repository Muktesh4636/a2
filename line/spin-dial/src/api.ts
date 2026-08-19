import { authHeaders, captureGunduToken } from './gunduAuth'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api/spin-dial'
captureGunduToken()

export interface SessionResponse {
  player_id: string
  balance: string
}

export interface PlayResponse {
  play_id: string
  segment_id: string
  color: string
  multiplier: string
  payout: string
  target_angle: number
  balance: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: authHeaders({ 'Content-Type': 'application/json', ...(init?.headers as Record<string, string> | undefined) }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(typeof data.detail === 'string' ? data.detail : `Request failed (${res.status})`)
  }
  return data as T
}

export const createSession = () => request<SessionResponse>('/session/', { method: 'POST' })
export const getSession = (id: string) => request<SessionResponse>(`/session/${id}/`)
export const placePlay = (playerId: string, betAmount: number) =>
  request<PlayResponse>('/play/', {
    method: 'POST',
    body: JSON.stringify({ player_id: playerId, bet_amount: betAmount.toFixed(2) }),
  })

const KEY = 'spindial_player_id'
export const loadPlayerId = () => localStorage.getItem(KEY)
export const savePlayerId = (id: string) => localStorage.setItem(KEY, id)
