import { useCallback, useEffect, useRef, useState } from 'react'
import { Controls } from './components/Controls'
import { Reel } from './components/Reel'
import { fetchPlayer, playRound, type ReelBox } from './api/client'
import { formatMoney, formatMultiplier } from './game/format'
import './App.css'
import { fetchGunduWalletBalance } from './gunduWallet'
import {
  playBetSound,
  playResultSound,
  playStopSound,
  stopSlideTicks,
  unlockGameAudio,
} from './game/gameSounds'

const RESULT_HOLD_MS = 4000

const DEMO_REEL: ReelBox[] = [
  { multiplier: '1.30', tone: 'gray' },
  { multiplier: '2.80', tone: 'teal' },
  { multiplier: '1.03', tone: 'gray' },
  { multiplier: '2.63', tone: 'teal' },
  { multiplier: '20.00', tone: 'gold' },
  { multiplier: '1.40', tone: 'blue' },
  { multiplier: '5.38', tone: 'orange' },
  { multiplier: '1.68', tone: 'blue' },
  { multiplier: '3.47', tone: 'white' },
  { multiplier: '1.52', tone: 'blue' },
  { multiplier: '2.41', tone: 'teal' },
  { multiplier: '1.82', tone: 'blue' },
  { multiplier: '2.57', tone: 'teal' },
  { multiplier: '1.62', tone: 'blue' },
]

type PendingResult = {
  status: 'won' | 'lost'
  multiplier: number
  profit: number
  balance: number
}



export default function App() {
  const [balance, setBalance] = useState(10000)
  const [betAmount, setBetAmount] = useState(100)
  const [reel, setReel] = useState<ReelBox[]>(DEMO_REEL)
  const [winIndex, setWinIndex] = useState<number | null>(3)
  const [spinning, setSpinning] = useState(false)
  const [spinId, setSpinId] = useState(0)
  const [showResult, setShowResult] = useState(false)
  const [lastProfit, setLastProfit] = useState<number | null>(null)
  const [lastMultiplier, setLastMultiplier] = useState<number | null>(null)
  const [lastStatus, setLastStatus] = useState<'won' | 'lost' | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [betsOnline] = useState(26)
  const pendingRef = useRef<PendingResult | null>(null)
  const resultTimerRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const state = await fetchPlayer()
        if (cancelled) return
        const gBal = await fetchGunduWalletBalance()
        setBalance(gBal != null ? gBal : Number(state.balance))
        const g = state.active_game
        if (g?.reel?.length) {
          setReel(g.reel)
          setWinIndex(g.win_index)
          setLastStatus(g.status)
          setLastProfit(Number(g.profit))
          setLastMultiplier(Number(g.multiplier))
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      if (resultTimerRef.current) window.clearTimeout(resultTimerRef.current)
    }
  }, [])

  const handleSpinEnd = useCallback(() => {
    setSpinning(false)
    playStopSound()
    const pending = pendingRef.current
    if (pending) {
      playResultSound(pending.status === 'won')
      setBalance(pending.balance)
      setLastMultiplier(pending.multiplier)
      setLastProfit(pending.profit)
      setLastStatus(pending.status)
      setShowResult(true)
      pendingRef.current = null
    }

    if (resultTimerRef.current) window.clearTimeout(resultTimerRef.current)
    resultTimerRef.current = window.setTimeout(() => {
      setShowResult(false)
      setBusy(false)
      resultTimerRef.current = null
    }, RESULT_HOLD_MS)
  }, [])

  async function handlePlay() {
    if (busy || betAmount <= 0 || betAmount > balance) return
    unlockGameAudio()
    playBetSound()
    setBusy(true)
    setError(null)
    setLastStatus(null)
    setShowResult(false)
    if (resultTimerRef.current) {
      window.clearTimeout(resultTimerRef.current)
      resultTimerRef.current = null
    }

    try {
      const state = await playRound(betAmount)
      const g = state.active_game
      if (!g?.reel?.length || g.win_index == null) {
        throw new Error('Invalid game response')
      }

      pendingRef.current = {
        status: g.status,
        multiplier: Number(g.multiplier),
        profit: Number(g.profit),
        balance: Number(state.balance),
      }

      // One update: new reel + start 7s slide together (no pre-snap to result)
      setReel(g.reel)
      setWinIndex(g.win_index)
      setSpinId((id) => id + 1)
      setSpinning(true)
    } catch (err) {
      stopSlideTicks()
      setBusy(false)
      setSpinning(false)
      pendingRef.current = null
      setError(err instanceof Error ? err.message : 'Could not play')
    }
  }

  function handleBetChange(value: number) {
    if (Number.isNaN(value)) return
    setBetAmount(Math.max(0, Math.min(value, 100000)))
  }

  if (loading) {
    return (
      <div className="app">
        <div className="ambient" aria-hidden />
        <p className="footer-note">Loading Pin Stop…</p>
      </div>
    )
  }

  return (
    <div className="app">
      <div className="ambient" aria-hidden />
      <header className="top-brand">
        <div className="brand-left">
          <span className="brand-mark" aria-hidden />
          <h1>Pin Stop</h1>
        </div>
        <div className="balance-chip top-balance" title="Your Gundu wallet">
          <span>Balance</span>
          <strong>{formatMoney(balance)}</strong>
        </div>
      </header>
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
        <section className="board-wrap">
          <Reel
            reel={reel}
            winIndex={winIndex}
            spinning={spinning}
            spinId={spinId}
            onSpinEnd={handleSpinEnd}
          />
          <div className="bets-live">
            <span className="live-dot" />
            Bets: {betsOnline}
          </div>
          {showResult && lastMultiplier != null && (
            <div className="result-overlay" aria-live="polite">
              <span className="result-label">Result</span>
              <strong>{formatMultiplier(lastMultiplier)}</strong>
              {lastProfit != null && (
                <span className={lastProfit >= 0 ? 'profit' : 'loss'}>
                  {lastProfit >= 0 ? '+' : ''}
                  {formatMoney(lastProfit)}
                </span>
              )}
            </div>
          )}
        </section>
      </main>
      {error && <p className="footer-note error-note">{error}</p>}
    </div>
  )
}
