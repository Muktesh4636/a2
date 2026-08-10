import { useEffect, useState } from 'react'
import { Board } from './components/Board'
import { Controls } from './components/Controls'
import {
  cashOut,
  fetchPlayer,
  revealTile,
  startGame,
  type ApiGame,
} from './api/client'
import {
  formatMoney,
  type Cell,
  type GameStatus,
} from './game/logic'
import './App.css'
import { fetchGunduWalletBalance } from './gunduWallet'

function emptyBoard(): Cell[] {
  return Array.from({ length: 25 }, () => ({
    content: 'gem' as const,
    state: 'hidden' as const,
  }))
}

function boardFromApi(game: ApiGame): Cell[] {
  return game.board.map((cell) => {
    if (cell.content === 'hidden') {
      return { content: 'gem', state: 'hidden' }
    }
    return {
      content: cell.content,
      state: cell.state === 'revealed' ? 'revealed' : 'hidden',
    }
  })
}

function statusFromApi(game: ApiGame | null): GameStatus {
  if (!game) return 'idle'
  return game.status
}


async function loadGunduWallet(setBalance: (n: number) => void) {
  const bal = await fetchGunduWalletBalance()
  if (bal != null) setBalance(bal)
}

export default function App() {
  const [balance, setBalance] = useState(10000)
  const [betAmount, setBetAmount] = useState(100)
  const [mineCount, setMineCount] = useState(3)
  const [board, setBoard] = useState<Cell[]>(emptyBoard)
  const [status, setStatus] = useState<GameStatus>('idle')
  const [gemsFound, setGemsFound] = useState(0)
  const [triggeredMine, setTriggeredMine] = useState<number | null>(null)
  const [multiplier, setMultiplier] = useState(1)
  const [profit, setProfit] = useState(0)
  const [gameId, setGameId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function applyGame(game: ApiGame) {
    setGameId(game.id)
    setBalance(Number(game.balance))
    void loadGunduWallet(setBalance)
    setBetAmount(Number(game.bet_amount))
    setMineCount(game.mine_count)
    setBoard(boardFromApi(game))
    setStatus(statusFromApi(game))
    setGemsFound(game.gems_found)
    setTriggeredMine(game.triggered_mine)
    setMultiplier(Number(game.multiplier))
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
        if (player.active_game) {
          applyGame(player.active_game)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load player')
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
    setBusy(true)
    setError(null)
    try {
      const game = await startGame(betAmount, mineCount)
      applyGame(game)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start game')
    } finally {
      setBusy(false)
    }
  }

  async function handleReveal(index: number) {
    if (busy || status !== 'playing' || !gameId) return
    setBusy(true)
    setError(null)
    try {
      const game = await revealTile(gameId, index)
      applyGame(game)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reveal tile')
    } finally {
      setBusy(false)
    }
  }

  async function handleCashOut() {
    if (busy || status !== 'playing' || !gameId || gemsFound <= 0) return
    setBusy(true)
    setError(null)
    try {
      const game = await cashOut(gameId)
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

  if (loading) {
    return (
      <div className="app">
        <div className="ambient" aria-hidden />
        <p className="footer-note">Loading Mines…</p>
      </div>
    )
  }

  return (
    <div className="app">
      <div className="ambient" aria-hidden />
      <header className="top-brand">
        <div className="brand-left">
          <span className="brand-mark" aria-hidden />
          <h1>Mines</h1>
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
          mineCount={mineCount}
          gemsFound={gemsFound}
          multiplier={multiplier}
          profit={profit}
          status={status}
          onBetChange={handleBetChange}
          onMineCountChange={setMineCount}
          onStart={handleStart}
          onCashOut={handleCashOut}
        />
        <Board
          board={board}
          status={status}
          triggeredMine={triggeredMine}
          onReveal={handleReveal}
        />
      </main>
      {error && <p className="footer-note error-note">{error}</p>}
      {(status === 'lost' || status === 'cashed' || status === 'won') && (
        <p className="footer-note">
          {status === 'lost'
            ? `Lost ${formatMoney(betAmount)}. Place a new bet to play again.`
            : `Round over. Balance: ${formatMoney(balance)}.`}
        </p>
      )}
    </div>
  )
}
