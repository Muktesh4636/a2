import { useEffect, useState } from 'react'
import { Board } from './components/Board'
import { Controls } from './components/Controls'
import {
  fetchPlayer,
  newRound,
  placeBet,
  selectBox,
  type ApiCell,
  type ApiGame,
} from './api/client'
import { formatMoney } from './game/format'
import './App.css'
import { fetchGunduWalletBalance } from './gunduWallet'
import {
  playBetSound,
  playLoseSound,
  playRevealSound,
  playTapSound,
  playWinSound,
  unlockGameAudio,
} from './gameSounds'

const ROWS = 6
const COLS = 5
const PICK = 4

function emptyBoard(): ApiCell[] {
  return Array.from({ length: ROWS * COLS }, (_, index) => ({
    index,
    selected: false,
    multiplier: null,
    highlight: false,
  }))
}



export default function App() {
  const [balance, setBalance] = useState(10000)
  const [betAmount, setBetAmount] = useState(100)
  const [board, setBoard] = useState<ApiCell[]>(emptyBoard)
  const [status, setStatus] = useState<ApiGame['status'] | 'idle'>('idle')
  const [selected, setSelected] = useState<number[]>([])
  const [totalMultiplier, setTotalMultiplier] = useState(0)
  const [payout, setPayout] = useState(0)
  const [profit, setProfit] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function applyGame(game: ApiGame) {
    setBalance(Number(game.balance))
    if (Number(game.bet_amount) > 0) setBetAmount(Number(game.bet_amount))
    setBoard(game.board)
    setStatus(game.status)
    setSelected(game.selected)
    setTotalMultiplier(Number(game.total_multiplier))
    setPayout(Number(game.payout))
    setProfit(Number(game.profit))
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const player = await fetchPlayer()
        if (cancelled) return
        const gBal = await fetchGunduWalletBalance()
        setBalance(gBal != null ? gBal : Number(player.balance))
        if (player.active_game) applyGame(player.active_game)
        else setStatus('selecting')
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load')
          setStatus('selecting')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleToggle(index: number) {
    if (busy || (status !== 'selecting' && status !== 'idle')) return
    unlockGameAudio()
    playTapSound()
    setBusy(true)
    setError(null)
    try {
      const game = await selectBox(index)
      applyGame(game)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not select box')
    } finally {
      setBusy(false)
    }
  }

  async function handleBet() {
    if (busy || selected.length !== PICK) return
    unlockGameAudio()
    playBetSound()
    setBusy(true)
    setError(null)
    try {
      const game = await placeBet(betAmount)
      applyGame(game)
      if (game.status === 'settled') {
        playRevealSound()
        if (Number(game.profit) > 0) playWinSound()
        else playLoseSound()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not place bet')
    } finally {
      setBusy(false)
    }
  }

  async function handleNewRound() {
    if (busy) return
    unlockGameAudio()
    playTapSound()
    setBusy(true)
    setError(null)
    try {
      const game = await newRound()
      applyGame(game)
      setBetAmount((b) => (b > 0 ? b : 100))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start round')
    } finally {
      setBusy(false)
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
        <p className="footer-note">Loading Pick 4…</p>
      </div>
    )
  }

  return (
    <div className="app">
      <div className="ambient" aria-hidden />
      <header className="top-brand">
        <div className="brand-left">
          <span className="brand-mark" aria-hidden />
          <h1>Pick 4</h1>
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
          selectedCount={selected.length}
          pickCount={PICK}
          status={status}
          totalMultiplier={totalMultiplier}
          payout={payout}
          profit={profit}
          onBetChange={handleBetChange}
          onBet={handleBet}
          onNewRound={handleNewRound}
        />
        <Board
          board={board}
          cols={COLS}
          status={status}
          totalMultiplier={totalMultiplier}
          payout={payout}
          onToggle={handleToggle}
          onUnlockAudio={unlockGameAudio}
        />
      </main>
      {error && <p className="footer-note error-note">{error}</p>}
      {status === 'settled' && (
        <p className="footer-note">
          Round settled. Payout {formatMoney(payout)}. Play again to pick 4 new boxes.
        </p>
      )}
    </div>
  )
}
