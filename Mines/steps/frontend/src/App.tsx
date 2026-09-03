import { useEffect, useState } from 'react'
import { Board } from './components/Board'
import { Controls } from './components/Controls'
import {
  cashOut,
  chooseStep,
  fetchPlayer,
  startGame,
  type ApiCell,
  type ApiGame,
} from './api/client'
import { formatMoney } from './game/format'
import './App.css'
import { fetchGunduWalletBalance } from './gunduWallet'
import {
  playBetSound,
  playCashOutSound,
  playDangerSound,
  playStepSound,
  unlockGameAudio,
} from './gameSounds'

const ROWS = 9
const COLS = 3

function emptyBoard(): ApiCell[][] {
  return Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => ({
      content: 'hidden',
      state: 'hidden',
      active: false,
      chosen: false,
      triggered: false,
    })),
  )
}

function idleBoard(): ApiCell[][] {
  return emptyBoard()
}


async function loadGunduWallet(setBalance: (n: number) => void) {
  const bal = await fetchGunduWalletBalance()
  if (bal != null) setBalance(bal)
}

export default function App() {
  const [balance, setBalance] = useState(10000)
  const [betAmount, setBetAmount] = useState(100)
  const [board, setBoard] = useState<ApiCell[][]>(idleBoard)
  const [status, setStatus] = useState<ApiGame['status'] | 'idle'>('idle')
  const [stepsCleared, setStepsCleared] = useState(0)
  const [multiplier, setMultiplier] = useState(1)
  const [profit, setProfit] = useState(0)
  const [payout, setPayout] = useState(0)
  const [gameId, setGameId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function applyGame(game: ApiGame) {
    setGameId(game.id)
    setBalance(Number(game.balance))
    void loadGunduWallet(setBalance)
    setBetAmount(Number(game.bet_amount))
    setBoard(game.board)
    setStatus(game.status)
    setStepsCleared(game.steps_cleared)
    setMultiplier(Number(game.multiplier))
    setProfit(Number(game.profit))
    setPayout(Number(game.payout))
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const walletP = fetchGunduWalletBalance().catch(() => null)
      try {
        const player = await fetchPlayer()
        if (cancelled) return
        if (player.active_game) applyGame(player.active_game)
        const gBal = await walletP
        if (!cancelled) {
          setBalance(gBal != null ? gBal : Number(player.balance))
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load player')
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

  async function handleStart() {
    if (busy || betAmount <= 0 || betAmount > balance) return
    unlockGameAudio()
    setBusy(true)
    setError(null)
    try {
      const game = await startGame(betAmount)
      playBetSound()
      applyGame(game)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start game')
    } finally {
      setBusy(false)
    }
  }

  async function handleChoose(column: number) {
    if (busy || status !== 'playing' || !gameId) return
    unlockGameAudio()
    setBusy(true)
    setError(null)
    try {
      const game = await chooseStep(gameId, column)
      if (game.status === 'lost') playDangerSound()
      else playStepSound(game.steps_cleared)
      applyGame(game)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not choose step')
    } finally {
      setBusy(false)
    }
  }

  async function handleCashOut() {
    if (busy || status !== 'playing' || !gameId || stepsCleared <= 0) return
    unlockGameAudio()
    setBusy(true)
    setError(null)
    try {
      const game = await cashOut(gameId)
      playCashOutSound()
      applyGame(game)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cash out')
    } finally {
      setBusy(false)
    }
  }

  function handleBetChange(value: number) {
    if (Number.isNaN(value)) return
    setBetAmount(Math.max(0, Math.min(value, 100000)))
  }

  // Only after round ends — mid-game overlay was blocking step clicks
  const showPayout = status === 'cashed' || status === 'won'

  return (
    <div className="app">
      <div className="ambient" aria-hidden />
      <header className="top-brand">
        <div className="brand-left">
          <span className="brand-mark" aria-hidden />
          <h1>Sky Path</h1>
        </div>
        <div className="balance-chip top-balance" title="Your Gundu wallet">
          <span>Balance</span>
          <strong>{formatMoney(balance)}</strong>
        </div>
      </header>
      {loading ? (
        <p className="footer-note">Loading Sky Path…</p>
      ) : (
        <main className="shell">
          <Controls
            balance={balance}
            betAmount={betAmount}
            stepsCleared={stepsCleared}
            multiplier={multiplier}
            profit={profit}
            status={status}
            onBetChange={handleBetChange}
            onStart={handleStart}
            onCashOut={handleCashOut}
          />
          <Board
            board={board}
            status={status}
            multiplier={multiplier}
            payout={payout > 0 ? payout : betAmount * multiplier}
            showPayout={showPayout}
            onChoose={handleChoose}
          />
        </main>
      )}
      {error && <p className="footer-note error-note">{error}</p>}
      {(status === 'lost' || status === 'cashed' || status === 'won') && (
        <p className="footer-note">
          {status === 'lost'
            ? `Lost ${formatMoney(betAmount)}. Place a new bet to climb again.`
            : `Round over. Balance: ${formatMoney(balance)}.`}
        </p>
      )}
    </div>
  )
}
