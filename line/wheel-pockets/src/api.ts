import { authHeaders, captureGunduToken } from './gunduAuth'

const API = import.meta.env.VITE_API_URL ?? '/api/wheel-pockets'
captureGunduToken()
async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init, headers: authHeaders({ 'Content-Type': 'application/json', ...(init?.headers as Record<string, string> | undefined) }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `Failed (${res.status})`)
  return data as T
}
export const createSession = () => req<{ player_id: string; balance: string }>('/session/', { method: 'POST' })
export const getSession = (id: string) => req<{ player_id: string; balance: string }>(`/session/${id}/`)
export const placePlay = (playerId: string, bet: number) =>
  req<{
    pocket_id: string; color: string; multiplier: string; payout: string
    target_angle: number; balance: string
  }>('/play/', {
    method: 'POST',
    body: JSON.stringify({ player_id: playerId, bet_amount: bet.toFixed(2) }),
  })
const KEY = 'wheelpockets_player_id'
export const loadPlayerId = () => localStorage.getItem(KEY)
export const savePlayerId = (id: string) => localStorage.setItem(KEY, id)
