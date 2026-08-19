import { authHeaders, captureGunduToken } from './gunduAuth'

const API = import.meta.env.VITE_API_URL ?? '/api/wave-surf'
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
export const startRound = (playerId: string, bet: number) =>
  req<{ round_id: string; balance: string }>('/round/', {
    method: 'POST',
    body: JSON.stringify({ player_id: playerId, bet_amount: bet.toFixed(2) }),
  })

export const tickRound = (roundId: string, multiplier: number) =>
  req<{ status: 'active' | 'crashed' }>('/tick/', {
    method: 'POST',
    body: JSON.stringify({ round_id: roundId, multiplier: multiplier.toFixed(2) }),
  })

export const cashOut = (roundId: string, multiplier: number) =>
  req<{ payout: string; multiplier: string; balance: string; status: string }>('/cashout/', {
    method: 'POST',
    body: JSON.stringify({ round_id: roundId, multiplier: multiplier.toFixed(2) }),
  })
const KEY = 'wavesurf_player_id'
export const loadPlayerId = () => localStorage.getItem(KEY)
export const savePlayerId = (id: string) => localStorage.setItem(KEY, id)
