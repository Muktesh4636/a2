import type { Card } from './gameConfig'

import { authHeaders, captureGunduToken } from './gunduAuth'
const API = import.meta.env.VITE_API_URL ?? '/api/hi-lo-cards'
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

export type Session = {
  player_id: string
  balance: string
  best_streak_mult: string
  total_wins: string
}

export const createSession = () => req<Session>('/session/', { method: 'POST' })
export const getSession = (id: string) => req<Session>(`/session/${id}/`)

export const startRound = (playerId: string, bet: number, autoCashout: number) =>
  req<{
    round_id: string
    card: Card
    streak: number
    multiplier: string
    next_multiplier: string
    balance: string
    status: string
  }>('/start/', {
    method: 'POST',
    body: JSON.stringify({
      player_id: playerId,
      bet_amount: bet.toFixed(2),
      auto_cashout: autoCashout.toFixed(2),
    }),
  })

export const guess = (roundId: string, choice: 'higher' | 'lower') =>
  req<{
    card: Card
    result: 'win' | 'lose'
    streak: number
    multiplier: string
    payout: string
    balance: string
    status: string
    next_multiplier?: string
    auto?: boolean
    best_streak_mult: string
    total_wins: string
  }>('/guess/', {
    method: 'POST',
    body: JSON.stringify({ round_id: roundId, choice }),
  })

export const cashout = (roundId: string) =>
  req<{
    multiplier: string
    payout: string
    balance: string
    status: string
    best_streak_mult: string
    total_wins: string
    card: Card
  }>('/cashout/', {
    method: 'POST',
    body: JSON.stringify({ round_id: roundId }),
  })

const KEY = 'hilocards_player_id'
export const loadPlayerId = () => localStorage.getItem(KEY)
export const savePlayerId = (id: string) => localStorage.setItem(KEY, id)
