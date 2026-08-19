import { authHeaders, captureGunduToken } from './gunduAuth'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api/dice-over-under'
captureGunduToken()

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: authHeaders({ 'Content-Type': 'application/json', ...(init?.headers as Record<string, string> | undefined) }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `Failed (${res.status})`)
  return data as T
}

export const createSession = () =>
  request<{ player_id: string; balance: string }>('/session/', { method: 'POST' })

export const getSession = (id: string) =>
  request<{ player_id: string; balance: string }>(`/session/${id}/`)

export const placePlay = (
  playerId: string,
  betAmount: number,
  target: number,
  side: 'under' | 'over',
) =>
  request<{
    roll: number
    won: boolean
    multiplier: string
    payout: string
    balance: string
    target: number
    side: string
  }>('/play/', {
    method: 'POST',
    body: JSON.stringify({
      player_id: playerId,
      bet_amount: betAmount.toFixed(2),
      target,
      side,
    }),
  })

const KEY = 'dice_player_id'
export const loadPlayerId = () => localStorage.getItem(KEY)
export const savePlayerId = (id: string) => localStorage.setItem(KEY, id)
