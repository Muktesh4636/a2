import { authHeaders, captureGunduToken } from './gunduAuth'

const API = import.meta.env.VITE_API_URL ?? '/api/keno-pick'
captureGunduToken()

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: authHeaders({ 'Content-Type': 'application/json', ...(init?.headers as Record<string, string> | undefined) }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `Failed (${res.status})`)
  return data as T
}

export const createSession = () =>
  req<{ player_id: string; balance: string }>('/session/', { method: 'POST' })
export const getSession = (id: string) =>
  req<{ player_id: string; balance: string }>(`/session/${id}/`)
export const placePlay = (playerId: string, bet: number, picks: number[]) =>
  req<{
    picks: number[]
    drawn: number[]
    hits: number[]
    hit_count: number
    multiplier: string
    payout: string
    balance: string
    table: { hits: number; multiplier: string }[]
  }>('/play/', {
    method: 'POST',
    body: JSON.stringify({ player_id: playerId, bet_amount: bet.toFixed(2), picks }),
  })

const KEY = 'kenopick_player_id'
export const loadPlayerId = () => localStorage.getItem(KEY)
export const savePlayerId = (id: string) => localStorage.setItem(KEY, id)
