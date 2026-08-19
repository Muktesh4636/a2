import { authHeaders, captureGunduToken } from './gunduAuth'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api/mines-path'
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

export const startRound = (playerId: string, betAmount: number) =>
  request<{
    round_id: string
    tile_count: number
    mine_count: number
    balance: string
    next_multiplier: string
  }>('/round/', {
    method: 'POST',
    body: JSON.stringify({ player_id: playerId, bet_amount: betAmount.toFixed(2) }),
  })

export const revealTile = (roundId: string, index: number) =>
  request<{
    index: number
    result: 'safe' | 'mine'
    safe_count: number
    multiplier: string
    payout: string
    balance: string
    status: 'active' | 'bust' | 'cashed'
    tiles?: Array<'safe' | 'mine' | 'hidden'>
  }>('/reveal/', {
    method: 'POST',
    body: JSON.stringify({ round_id: roundId, index }),
  })

export const cashOut = (roundId: string) =>
  request<{
    multiplier: string
    payout: string
    balance: string
    status: string
    tiles: Array<'safe' | 'mine' | 'hidden'>
  }>('/cashout/', {
    method: 'POST',
    body: JSON.stringify({ round_id: roundId }),
  })

const KEY = 'mines_player_id'
export const loadPlayerId = () => localStorage.getItem(KEY)
export const savePlayerId = (id: string) => localStorage.setItem(KEY, id)
