import { useCallback, useEffect, useState } from 'react'
import {
  createSession,
  getSession,
  loadPlayerId,
  placeSpin,
  savePlayerId,
} from './api'
import { BetPanel } from './BetPanel'
import {
  DEFAULT_BET,
  SEGMENTS,
  type MultiplierKey,
} from './gameConfig'
import { MultiplierBar } from './MultiplierBar'
import { Wheel } from './Wheel'

const SPIN_MS = 4200

/** Rotate so `targetAngle` (from server) sits under the top pointer. */
function rotationForAngle(targetAngle: number, baseRotation: number): number {
  const extraSpins = 5 + Math.floor(Math.random() * 3)
  const normalized = ((baseRotation % 360) + 360) % 360
  const desired = ((-targetAngle % 360) + 360) % 360
  let delta = desired - normalized
  if (delta <= 0) delta += 360
  return baseRotation + extraSpins * 360 + delta
}

export default function App() {
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [balance, setBalance] = useState(0)
  const [bet, setBet] = useState(DEFAULT_BET)
  const [rotation, setRotation] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const [lastMultiplier, setLastMultiplier] = useState<MultiplierKey | null>(
    null,
  )
  const [lastPayout, setLastPayout] = useState<number | null>(null)
  const [highlighted, setHighlighted] = useState<MultiplierKey | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function boot() {
      try {
        setError(null)
        let id = loadPlayerId()
        let session
        if (id) {
          try {
            session = await getSession(id)
          } catch {
            session = await createSession()
            id = session.player_id
            savePlayerId(id)
          }
        } else {
          session = await createSession()
          id = session.player_id
          savePlayerId(id)
        }
        if (cancelled) return
        setPlayerId(id)
        setBalance(Number(session.balance))
        setReady(true)
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error
              ? e.message
              : 'Could not reach the game server. Is Django running on :8000?',
          )
        }
      }
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [])

  const onSpin = useCallback(async () => {
    if (!playerId || spinning || bet > balance || bet < 1) return

    setSpinning(true)
    setLastMultiplier(null)
    setLastPayout(null)
    setHighlighted(null)
    setError(null)

    // Optimistic balance deduct for snappy UI; server is source of truth
    setBalance((b) => b - bet)

    try {
      const result = await placeSpin(playerId, bet)
      const mult = Number(result.multiplier) as MultiplierKey
      const payout = Number(result.payout)
      const nextRotation = rotationForAngle(result.target_angle, rotation)
      setRotation(nextRotation)

      window.setTimeout(() => {
        setBalance(Number(result.balance))
        setLastMultiplier(mult)
        setLastPayout(payout)
        setHighlighted(mult)
        setSpinning(false)
      }, SPIN_MS)
    } catch (e) {
      // Roll back optimistic deduct
      setBalance((b) => b + bet)
      setSpinning(false)
      setError(e instanceof Error ? e.message : 'Spin failed')
    }
  }, [playerId, spinning, bet, balance, rotation])

  return (
    <div className="app">
      <header className="brand">
        <h1>Line</h1>
        <p>Pick a color. Spin the ring.</p>
      </header>

      {error && <div className="banner error">{error}</div>}
      {!ready && !error && <div className="banner">Connecting…</div>}

      <main className="stage">
        <Wheel segments={SEGMENTS} rotation={rotation} spinning={spinning} />
        <MultiplierBar
          lastMultiplier={lastMultiplier}
          highlighted={highlighted}
        />
        <BetPanel
          balance={balance}
          bet={bet}
          spinning={spinning || !ready}
          onBetChange={setBet}
          onSpin={() => void onSpin()}
          lastPayout={lastPayout}
          lastMultiplier={lastMultiplier}
        />
      </main>
    </div>
  )
}
