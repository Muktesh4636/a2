import { captureGunduToken } from './gunduAuth'
const API_BASE = import.meta.env.VITE_API_URL ?? '/api/jet'
captureGunduToken()
const TOKEN_KEY = 'jet_player_token'

export function getPlayerToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

function saveToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  const token = getPlayerToken()
  if (token) headers.set('X-Player-Token', token)
  const jwt = captureGunduToken()
  if (jwt) headers.set('Authorization', `Bearer ${jwt}`)

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as { detail?: string }).detail || res.statusText)
  }
  const player = (data as { player?: { token?: string } }).player
  if (player?.token) saveToken(player.token)
  return data as T
}

export interface PlayerDto {
  id: string
  token: string
  balance: string
  currency: string
}

export interface RoundDto {
  id: string
  status: 'waiting' | 'flying' | 'crashed'
  crash_point: string | null
  wait_ms: number
  growth: number
}

export interface BetDto {
  id: string
  panel: number
  amount: string
  status: string
  cashout_mult: string | null
  win: string | null
  auto_cashout: string | null
}

export function bootstrap() {
  return api<{
    player: PlayerDto
    round: RoundDto
    history: number[]
  }>('/bootstrap/')
}

export function startRound(roundId: string) {
  return api<{
    player: PlayerDto
    round: RoundDto
    bets: BetDto[]
  }>('/round/start/', {
    method: 'POST',
    body: JSON.stringify({ round_id: roundId }),
  })
}

export function crashRound(roundId: string) {
  return api<{
    player: PlayerDto
    round: RoundDto
    history: number[]
  }>('/round/crash/', {
    method: 'POST',
    body: JSON.stringify({ round_id: roundId }),
  })
}

export function newRound() {
  return api<{
    player: PlayerDto
    round: RoundDto
    history: number[]
  }>('/round/new/', { method: 'POST', body: '{}' })
}

export function placeBet(panel: number, amount: number, autoCashout?: number) {
  return api<{ player: PlayerDto; bet: BetDto }>('/bet/', {
    method: 'POST',
    body: JSON.stringify({
      panel,
      amount,
      auto_cashout: autoCashout ?? null,
    }),
  })
}

export function cashOut(panel: number, mult: number) {
  return api<{ player: PlayerDto; bet: BetDto }>('/cashout/', {
    method: 'POST',
    body: JSON.stringify({ panel, mult }),
  })
}
