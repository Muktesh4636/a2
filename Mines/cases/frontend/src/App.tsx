import { useCallback, useEffect, useRef, useState } from 'react'
import { Controls } from './components/Controls'
import { Reel } from './components/Reel'
import { fetchPlayer, playRound, type ReelBox } from './api/client'
import { formatMoney, formatMultiplier } from './game/format'
import './App.css'
import { fetchGunduWalletBalance } from './gunduWallet'

const RESULT_HOLD_MS = 4000

const DEMO_REEL: ReelBox[] = [
  { multiplier: '0.50', tone: 'cyan' },
  { multiplier: '1.40', tone: 'cyan' },
  { multiplier: '0.02', tone: 'slate' },
  { multiplier: '3.50', tone: 'red' },
  { multiplier: '2.20', tone: 'blue' },
  { multiplier: '20.00', tone: 'gold' },
  { multiplier: '1.00', tone: 'cyan' },
  { multiplier: '5.00', tone: 'red' },
  { multiplier: '0.20', tone: 'slate' },
  { multiplier: '1.80', tone: 'blue' },
  { multiplier: '2.80', tone: 'blue' },
  { multiplier: '10.00', tone: 'red' },
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
  const [winIndex, setWinIndex] = useState<number | null>(null)
  const [spinning, setSpinning] = useState(false)
  const [opened, setOpened] = useState(false)
  const [spinId, setSpinId] = useState(0)
  const [showResult, setShowResult] = useState(false)
  const [lastProfit, setLastProfit] = useState<number | null>(null)
  const [lastMultiplier, setLastMultiplier] = useState<number | null>(null)
  const [lastStatus, setLastStatus] = useState<'won' | 'lost' | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
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
          setOpened(true)
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
    // Stop first so the pinned box is locked under the pin, then open only that one
    setSpinning(false)
    requestAnimationFrame(() => {
      setOpened(true)
      const pending = pendingRef.current
      if (pending) {
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
    })
  }, [])

  async function handlePlay() {
    if (busy || betAmount <= 0 || betAmount > balance) return
    setBusy(true)
    setError(null)
    setLastStatus(null)
    setShowResult(false)
    setOpened(false)
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

      setReel(g.reel)
      setWinIndex(g.win_index)
      setSpinId((id) => id + 1)
      setSpinning(true)
    } catch (err) {
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
        <p className="footer-note">Loading Vault…</p>
      </div>
    )
  }

  return (
    <div className="app">
      <div className="ambient" aria-hidden />
      <header className="top-brand">
        <div className="brand-left">
          <span className="brand-mark" aria-hidden />
          <h1>Vault</h1>
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
            opened={opened}
            spinId={spinId}
            onSpinEnd={handleSpinEnd}
          />
          {showResult && lastMultiplier != null && (
            <div className="result-overlay" aria-live="polite">
              <span className="result-label">Opened</span>
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
