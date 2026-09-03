import { useCallback, useEffect, useState } from 'react'
import {
  cashout,
  createSession,
  getSession,
  guess,
  loadPlayerId,
  savePlayerId,
  startRound,
} from './api'
import { Card3D } from './Card3D'
import { DEFAULT_AUTO, DEFAULT_BET, type Card } from './gameConfig'
import {
  playBetSound,
  playDealSound,
  playFlipSound,
  playResultSound,
  unlockGameAudio,
} from './gameSounds'

const FLIP_MS = 700

function money(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function App() {
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [balance, setBalance] = useState(0)
  const [bet, setBet] = useState(DEFAULT_BET)
  const [autoOut, setAutoOut] = useState(DEFAULT_AUTO)
  const [roundId, setRoundId] = useState<string | null>(null)
  const [card, setCard] = useState<Card | null>(null)
  const [streak, setStreak] = useState(0)
  const [mult, setMult] = useState(0)
  const [busy, setBusy] = useState(false)
  const [flipping, setFlipping] = useState(false)
  const [active, setActive] = useState(false)
  const [best, setBest] = useState(0)
  const [totalWins, setTotalWins] = useState(0)
  const [flash, setFlash] = useState<'win' | 'lose' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        let id = loadPlayerId()
        let s = id ? await getSession(id).catch(() => null) : null
        if (!s) {
          s = await createSession()
          id = s.player_id
          savePlayerId(id!)
        }
        if (!alive) return
        setPlayerId(id)
        setBalance(Number(s.balance))
        setBest(Number(s.best_streak_mult))
        setTotalWins(Number(s.total_wins))
        setReady(true)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Server offline (:8010)')
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const revealCard = (next: Card) =>
    new Promise<void>((resolve) => {
      playDealSound()
      setFlipping(true)
      setCard(next)
      window.setTimeout(() => playFlipSound(), 280)
      window.setTimeout(() => {
        setFlipping(false)
        resolve()
      }, FLIP_MS)
    })

  const onStart = useCallback(async () => {
    if (!playerId || busy || active || bet > balance) return
    unlockGameAudio()
    playBetSound()
    setBusy(true)
    setError(null)
    setFlash(null)
    setCard(null)
    try {
      const r = await startRound(playerId, bet, autoOut)
      setBalance(Number(r.balance))
      setRoundId(r.round_id)
      setStreak(0)
      setMult(0)
      setActive(true)
      await revealCard(r.card)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
      setActive(false)
    } finally {
      setBusy(false)
    }
  }, [playerId, busy, active, bet, balance, autoOut])

  const onGuess = useCallback(
    async (choice: 'higher' | 'lower') => {
      if (!roundId || busy || !active) return
      unlockGameAudio()
      playBetSound()
      setBusy(true)
      setError(null)
      setFlash(null)
      try {
        const r = await guess(roundId, choice)
        await revealCard(r.card)
        setStreak(r.streak)
        setMult(Number(r.multiplier))
        setBalance(Number(r.balance))
        setBest(Number(r.best_streak_mult))
        setTotalWins(Number(r.total_wins))
        if (r.result === 'lose') {
          playResultSound(false)
          setFlash('lose')
          setActive(false)
          setRoundId(null)
        } else if (r.status === 'cashed') {
          playResultSound(true)
          setFlash('win')
          setActive(false)
          setRoundId(null)
        } else {
          playResultSound(true)
          setFlash('win')
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed')
      } finally {
        setBusy(false)
      }
    },
    [roundId, busy, active],
  )

  const onCash = useCallback(async () => {
    if (!roundId || busy || !active || streak < 1) return
    unlockGameAudio()
    setBusy(true)
    try {
      const r = await cashout(roundId)
      setBalance(Number(r.balance))
      setBest(Number(r.best_streak_mult))
      setTotalWins(Number(r.total_wins))
      setMult(Number(r.multiplier))
      playResultSound(true)
      setFlash('win')
      setActive(false)
      setRoundId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }, [roundId, busy, active, streak])

  return (
    <div className="hl-app">
      <header className="hl-top">
        <div className="hl-logo">stake</div>
        <div className="hl-balance">
          ₹{money(balance)} INR
          <button type="button" className="hl-plus" aria-label="Add">
            +
          </button>
        </div>
        <button type="button" className="hl-menu" aria-label="Menu">
          ☰
        </button>
      </header>

      {error && <div className="banner error">{error}</div>}
      {!ready && !error && <div className="banner">Connecting…</div>}

      <div className="hl-title">
        <h1>
          HI<span className="hl-spade">♠</span>LO
        </h1>
        <div className="hl-subline">
          <span />
          CARDS
          <span />
        </div>
        <div className="hl-banner">GUESS HIGHER OR LOWER</div>
      </div>

      <Card3D card={card} flipping={flipping} flash={flash} empty={!card && !flipping} />

      <div className="hl-streak">
        <span className="hl-streak-label">CURRENT STREAK</span>
        <span className="hl-streak-mult">{mult > 0 ? `${mult.toFixed(2)}x` : '—'}</span>
        <span className="hl-streak-label">MULTIPLIER</span>
      </div>

      <div className="hl-actions">
        {!active ? (
          <button
            type="button"
            className="hl-start"
            disabled={!ready || busy || bet > balance}
            onClick={() => void onStart()}
          >
            {busy ? 'DEALING…' : 'DEAL CARD'}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="hl-lower"
              disabled={busy || flipping}
              onClick={() => void onGuess('lower')}
            >
              <span>▾▾</span>
              LOWER
            </button>
            <button
              type="button"
              className="hl-higher"
              disabled={busy || flipping}
              onClick={() => void onGuess('higher')}
            >
              <span>▴▴</span>
              HIGHER
            </button>
          </>
        )}
      </div>

      {active && streak > 0 && (
        <button
          type="button"
          className="hl-cash"
          disabled={busy || flipping}
          onClick={() => void onCash()}
        >
          CASH OUT ₹{money(bet * mult)}
        </button>
      )}

      <div className="hl-controls">
        <div className="hl-field">
          <label htmlFor="bet">BET AMOUNT</label>
          <div className="hl-input">
            <span>₹</span>
            <input
              id="bet"
              type="number"
              min={1}
              value={bet}
              disabled={!ready || active || busy}
              onChange={(e) =>
                setBet(Math.min(Math.max(1, Number(e.target.value) || 1), Math.floor(balance) || 1))
              }
            />
          </div>
        </div>
        <div className="hl-chip" aria-hidden>
          ₹
        </div>
        <div className="hl-field">
          <label htmlFor="auto">AUTO CASH OUT</label>
          <div className="hl-input">
            <input
              id="auto"
              type="number"
              min={0}
              step={0.1}
              value={autoOut}
              disabled={!ready || active || busy}
              onChange={(e) => setAutoOut(Math.max(0, Number(e.target.value) || 0))}
            />
            <span>x</span>
          </div>
        </div>
      </div>

      <footer className="hl-foot">
        <span>🏆 BEST STREAK {best > 0 ? `${best.toFixed(1)}x` : '—'}</span>
        <span className="win">📊 TOTAL WINS ₹{money(totalWins)}</span>
        <span>🕒 RECENT ▾</span>
      </footer>
    </div>
  )
}
