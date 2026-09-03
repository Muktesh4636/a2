import { useCallback, useEffect, useState } from 'react'
import {
  cashOut,
  createSession,
  getSession,
  loadPlayerId,
  revealTile,
  savePlayerId,
  startRound,
} from './api'
import { DEFAULT_BET, SAFE_MULTIPLIERS, TILE_COUNT, type TileState } from './gameConfig'
import {
  playBetSound,
  playCashOutSound,
  playGemSound,
  playMineSound,
  playTapSound,
  unlockGameAudio,
} from './gameSounds'

function money(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function App() {
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [balance, setBalance] = useState(0)
  const [bet, setBet] = useState(DEFAULT_BET)
  const [roundId, setRoundId] = useState<string | null>(null)
  const [tiles, setTiles] = useState<TileState[]>(() => Array(TILE_COUNT).fill('hidden'))
  const [safeCount, setSafeCount] = useState(0)
  const [multiplier, setMultiplier] = useState(0)
  const [nextMult, setNextMult] = useState<number>(SAFE_MULTIPLIERS[0])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<'idle' | 'active' | 'bust' | 'cashed'>('idle')
  const [lastPayout, setLastPayout] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        let id = loadPlayerId()
        let session = id ? await getSession(id).catch(() => null) : null
        if (!session) {
          session = await createSession()
          id = session.player_id
          savePlayerId(id!)
        }
        if (!alive) return
        setPlayerId(id)
        setBalance(Number(session.balance))
        setReady(true)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Server offline (:8004)')
      }
    })()
    return () => { alive = false }
  }, [])

  const onStart = useCallback(async () => {
    if (!playerId || busy || status === 'active' || bet > balance) return
    unlockGameAudio()
    playBetSound()
    setBusy(true)
    setError(null)
    setLastPayout(null)
    try {
      const r = await startRound(playerId, bet)
      setRoundId(r.round_id)
      setTiles(Array(TILE_COUNT).fill('hidden'))
      setSafeCount(0)
      setMultiplier(0)
      setNextMult(Number(r.next_multiplier))
      setBalance(Number(r.balance))
      setStatus('active')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start')
    } finally {
      setBusy(false)
    }
  }, [playerId, busy, status, bet, balance])

  const onReveal = useCallback(async (index: number) => {
    if (!roundId || busy || status !== 'active' || tiles[index] !== 'hidden') return
    unlockGameAudio()
    playTapSound()
    setBusy(true)
    try {
      const r = await revealTile(roundId, index)
      if (r.status === 'bust' || r.result === 'mine') playMineSound()
      else if (r.result === 'safe') playGemSound()
      setTiles((prev) => {
        const next = [...prev]
        next[index] = r.result
        if (r.tiles) {
          return r.tiles.map((t) => t as TileState)
        }
        return next
      })
      setSafeCount(r.safe_count)
      setMultiplier(Number(r.multiplier))
      if (r.status === 'bust') {
        setStatus('bust')
        setBalance(Number(r.balance))
        setLastPayout(0)
        setRoundId(null)
      } else {
        const nm = SAFE_MULTIPLIERS[r.safe_count]
        setNextMult(nm ?? Number(r.multiplier))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reveal failed')
    } finally {
      setBusy(false)
    }
  }, [roundId, busy, status, tiles])

  const onCashOut = useCallback(async () => {
    if (!roundId || busy || status !== 'active' || safeCount < 1) return
    unlockGameAudio()
    playCashOutSound()
    setBusy(true)
    try {
      const r = await cashOut(roundId)
      setBalance(Number(r.balance))
      setLastPayout(Number(r.payout))
      setStatus('cashed')
      setTiles(r.tiles.map((t) => t as TileState))
      setRoundId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cash out failed')
    } finally {
      setBusy(false)
    }
  }, [roundId, busy, status, safeCount])

  const clamp = (v: number) => setBet(Math.min(balance, Math.max(1, Math.round(v * 100) / 100)))

  return (
    <div className="app">
      <header className="brand">
        <h1>Mines Path</h1>
        <p>Reveal safe tiles. Cash out before a mine.</p>
      </header>
      {error && <div className="banner error">{error}</div>}
      {!ready && !error && <div className="banner">Connecting…</div>}

      <main className="stage">
        <div className="mines-info">
          <div className="pill">Current <strong>{multiplier > 0 ? `${multiplier.toFixed(2)}x` : '—'}</strong></div>
          <div className="pill">Next <strong>{status === 'active' ? `${Number(nextMult).toFixed(2)}x` : '—'}</strong></div>
        </div>

        <div className="tile-row" role="list">
          {tiles.map((t, i) => (
            <button
              key={i}
              type="button"
              role="listitem"
              className={`tile tile-${t}`}
              disabled={busy || status !== 'active' || t !== 'hidden'}
              onPointerDown={() => unlockGameAudio()}
              onClick={() => void onReveal(i)}
            >
              {t === 'hidden' ? '?' : t === 'safe' ? '✓' : '✕'}
            </button>
          ))}
        </div>

        {status === 'bust' && <div className="banner error">Hit a mine — bet lost</div>}
        {status === 'cashed' && lastPayout !== null && (
          <div className="banner win">Cashed out +₹{money(lastPayout)}</div>
        )}

        <div className="bet-panel">
          <div className="stat-row">
            <div className="stat">
              <span className="stat-label">Balance</span>
              <span className="stat-value">₹{money(balance)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Last win</span>
              <span className={`stat-value${lastPayout && lastPayout > 0 ? ' win' : ''}`}>
                {lastPayout === null ? '—' : lastPayout > 0 ? `+₹${money(lastPayout)}` : '₹0.00'}
              </span>
            </div>
          </div>

          {status !== 'active' ? (
            <>
              <div className="bet-controls">
                <label className="bet-label" htmlFor="bet">Bet amount</label>
                <div className="bet-input-row">
                  <button type="button" className="chip" disabled={busy || !ready} onClick={() => clamp(bet / 2)}>½</button>
                  <div className="bet-field">
                    <span className="bet-currency">₹</span>
                    <input id="bet" type="number" min={1} value={bet} disabled={busy || !ready}
                      onChange={(e) => clamp(Number(e.target.value) || 1)} />
                  </div>
                  <button type="button" className="chip" disabled={busy || !ready} onClick={() => clamp(bet * 2)}>2×</button>
                </div>
              </div>
              <button type="button" className="spin-btn" disabled={busy || !ready || bet > balance}
                onClick={() => void onStart()}>
                Bet
              </button>
            </>
          ) : (
            <button
              type="button"
              className="spin-btn cashout"
              disabled={busy || safeCount < 1}
              onClick={() => void onCashOut()}
            >
              Cash out {multiplier > 0 ? `${multiplier.toFixed(2)}x` : ''}
            </button>
          )}
        </div>
      </main>
    </div>
  )
}
