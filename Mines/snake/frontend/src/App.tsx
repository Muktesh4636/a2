import { useEffect, useState } from 'react'
import { Board } from './components/Board'
import { Controls } from './components/Controls'
import { fetchPlayer, playRound, type TrackTile } from './api/client'
import { formatMoney } from './game/format'
import './App.css'
import { fetchGunduWalletBalance } from './gunduWallet'
import {
  DICE_LAND_MS,
  DICE_ROLL_MS,
  preloadDiceRollSound,
  primeDiceRollSound,
  startDiceRollSound,
  stopDiceRollSound,
} from './diceSound'

const DEFAULT_TRACK: TrackTile[] = [
  { index: 0, type: 'start' },
  { index: 1, type: 'mult', multiplier: '20.00' },
  { index: 2, type: 'mult', multiplier: '3.00' },
  { index: 3, type: 'mult', multiplier: '2.00' },
  { index: 4, type: 'mult', multiplier: '1.50' },
  { index: 5, type: 'mult', multiplier: '1.20' },
  { index: 6, type: 'snake' },
  { index: 7, type: 'mult', multiplier: '1.20' },
  { index: 8, type: 'mult', multiplier: '1.50' },
  { index: 9, type: 'mult', multiplier: '2.00' },
  { index: 10, type: 'mult', multiplier: '3.00' },
  { index: 11, type: 'mult', multiplier: '5.00' },
]

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}



export default function App() {
  const [balance, setBalance] = useState(10000)
  const [betAmount, setBetAmount] = useState(100)
  const [track, setTrack] = useState<TrackTile[]>(DEFAULT_TRACK)
  const [die1, setDie1] = useState(1)
  const [die2, setDie2] = useState(1)
  const [rolling, setRolling] = useState(false)
  const [markerIndex, setMarkerIndex] = useState<number | null>(0)
  const [resultMultiplier, setResultMultiplier] = useState<number | null>(1)
  const [lost, setLost] = useState(false)
  const [lastProfit, setLastProfit] = useState<number | null>(null)
  const [lastMultiplier, setLastMultiplier] = useState<number | null>(null)
  const [lastStatus, setLastStatus] = useState<'won' | 'lost' | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    preloadDiceRollSound()
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Show chrome immediately; wallet + player load in parallel
      const walletP = fetchGunduWalletBalance().catch(() => null)
      try {
        const state = await fetchPlayer()
        if (cancelled) return
        if (state.track?.length) setTrack(state.track)
        const g = state.active_game
        if (g?.die1 && g?.die2 && g.land_index != null) {
          setDie1(g.die1)
          setDie2(g.die2)
          setMarkerIndex(g.land_index)
          setResultMultiplier(Number(g.multiplier))
          setLost(g.status === 'lost')
          setLastStatus(g.status === 'lost' ? 'lost' : 'won')
          setLastProfit(Number(g.profit))
          setLastMultiplier(Number(g.multiplier))
        }
        const gBal = await walletP
        if (!cancelled) {
          setBalance(gBal != null ? gBal : Number(state.balance))
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load')
          const gBal = await walletP
          if (gBal != null) setBalance(gBal)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function handlePlay() {
    if (busy || betAmount <= 0 || betAmount > balance) return
    // Unlock + start audio on the user gesture BEFORE any await / state paint lag
    primeDiceRollSound()
    startDiceRollSound()

    setBusy(true)
    setError(null)
    setLost(false)
    setLastStatus(null)
    setRolling(true)
    setMarkerIndex(0)
    setResultMultiplier(1)

    const rollStarted = performance.now()

    try {
      const state = await playRound(betAmount)
      const g = state.active_game
      if (!g || g.die1 == null || g.die2 == null || g.land_index == null || g.dice_sum == null) {
        throw new Error('Invalid game response')
      }

      // Keep tumbling in the air for a natural throw
      const elapsed = performance.now() - rollStarted
      await sleep(Math.max(0, DICE_ROLL_MS - elapsed))

      setDie1(g.die1)
      setDie2(g.die2)
      setRolling(false)
      // Wait for decelerating land animation
      await sleep(DICE_LAND_MS)
      stopDiceRollSound()

      // Animate marker from start along the path
      const steps = g.dice_sum
      for (let s = 1; s <= steps; s++) {
        const idx = (s - 1) % track.length
        setMarkerIndex(idx)
        await sleep(140)
      }
      setMarkerIndex(g.land_index)

      setBalance(Number(state.balance))
      setResultMultiplier(Number(g.multiplier))
      setLost(g.status === 'lost')
      setLastStatus(g.status === 'lost' ? 'lost' : 'won')
      setLastProfit(Number(g.profit))
      setLastMultiplier(Number(g.multiplier))
      if (state.track?.length) setTrack(state.track)
    } catch (err) {
      stopDiceRollSound()
      setRolling(false)
      setError(err instanceof Error ? err.message : 'Could not play')
    } finally {
      setBusy(false)
    }
  }

  function handleBetChange(value: number) {
    if (Number.isNaN(value)) return
    setBetAmount(Math.max(0, Math.min(value, 100000)))
  }

  return (
    <div className="app">
      <div className="ambient" aria-hidden />
      <header className="top-brand">
        <div className="brand-left">
          <span className="brand-mark" aria-hidden />
          <h1>Roll & Land</h1>
        </div>
        <div className="balance-chip top-balance" title="Your Gundu wallet">
          <span>Balance</span>
          <strong>{formatMoney(balance)}</strong>
        </div>
      </header>
      {loading ? (
        <p className="footer-note">Loading Roll & Land…</p>
      ) : (
        <main className="shell">
          <Controls
            balance={balance}
            betAmount={betAmount}
            busy={busy}
            lastProfit={lastProfit}
            lastMultiplier={lastMultiplier}
            lastStatus={lastStatus}
            onBetChange={handleBetChange}
            onPlay={handlePlay}
          />
          <Board
            track={track}
            die1={die1}
            die2={die2}
            rolling={rolling}
            markerIndex={markerIndex}
            resultMultiplier={resultMultiplier}
            lost={lost}
          />
        </main>
      )}
      {error && <p className="footer-note error-note">{error}</p>}
      {lastStatus === 'won' && lastProfit != null && (
        <p className="footer-note">
          Payout applied. Balance {formatMoney(balance)}.
        </p>
      )}
    </div>
  )
}
