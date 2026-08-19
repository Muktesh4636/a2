import { useCallback, useEffect, useRef, useState } from 'react'
import {
  cashOut,
  createSession,
  getSession,
  loadPlayerId,
  savePlayerId,
  startRound,
  tickRound,
} from './api'
import { CLIMB_RATE, DEFAULT_BET, TICK_MS } from './gameConfig'

function money(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function App() {
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [balance, setBalance] = useState(0)
  const [bet, setBet] = useState(DEFAULT_BET)
  const [roundId, setRoundId] = useState<string | null>(null)
  const [mult, setMult] = useState(1)
  const [status, setStatus] = useState<'idle' | 'riding' | 'cashed' | 'crashed'>('idle')
  const [lastPayout, setLastPayout] = useState<number | null>(null)
  const [points, setPoints] = useState<number[]>([1])
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)

  const multRef = useRef(1)
  const roundRef = useRef<string | null>(null)
  const timerRef = useRef<number | null>(null)
  const checkingRef = useRef(false)

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
        setReady(true)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Server offline (:8008)')
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const stopTimer = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const onStart = useCallback(async () => {
    if (!playerId || busy || status === 'riding' || bet > balance) return
    setBusy(true)
    setError(null)
    setLastPayout(null)
    try {
      const r = await startRound(playerId, bet)
      setRoundId(r.round_id)
      roundRef.current = r.round_id
      setBalance(Number(r.balance))
      multRef.current = 1
      setMult(1)
      setPoints([1])
      setStatus('riding')

      timerRef.current = window.setInterval(() => {
        const next = Math.round((multRef.current + CLIMB_RATE * (TICK_MS / 1000)) * 100) / 100
        multRef.current = next
        setMult(next)
        setPoints((p) => [...p, next].slice(-80))

        // Ask server if this multiplier crashed (no crash point leaked)
        if (!checkingRef.current && roundRef.current) {
          checkingRef.current = true
          void tickRound(roundRef.current, next)
            .then((t) => {
              if (t.status === 'crashed') {
                stopTimer()
                setStatus('crashed')
                setLastPayout(0)
                setRoundId(null)
                roundRef.current = null
              }
            })
            .catch(() => {})
            .finally(() => {
              checkingRef.current = false
            })
        }
      }, TICK_MS)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start')
    } finally {
      setBusy(false)
    }
  }, [playerId, busy, status, bet, balance])

  const onCashOut = useCallback(async () => {
    if (!roundId || status !== 'riding' || busy) return
    setBusy(true)
    const m = multRef.current
    stopTimer()
    try {
      const r = await cashOut(roundId, m)
      setBalance(Number(r.balance))
      setLastPayout(Number(r.payout))
      setStatus('cashed')
      setRoundId(null)
      roundRef.current = null
      setMult(Number(r.multiplier))
    } catch (e) {
      setStatus('crashed')
      setLastPayout(0)
      setRoundId(null)
      roundRef.current = null
      setError(e instanceof Error ? e.message : 'Cash out failed')
    } finally {
      setBusy(false)
    }
  }, [roundId, status, busy])

  useEffect(() => () => stopTimer(), [])

  const clamp = (v: number) => setBet(Math.min(balance, Math.max(1, Math.round(v * 100) / 100)))

  const w = 360
  const h = 160
  const maxY = Math.max(2, ...points, mult)
  const path = points
    .map((v, i) => {
      const x = (i / Math.max(1, points.length - 1)) * (w - 20) + 10
      const y = h - 10 - ((v - 1) / (maxY - 1 || 1)) * (h - 30)
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`
    })
    .join(' ')

  return (
    <div className="app">
      <header className="brand">
        <h1>Wave Surf</h1>
        <p>Ride the wave. Cash out before it crashes.</p>
      </header>
      {error && <div className="banner error">{error}</div>}
      {!ready && !error && <div className="banner">Connecting…</div>}

      <main className="stage">
        <div className={`mult-hero status-${status}`}>
          <span className="mult-big">{mult.toFixed(2)}x</span>
          <span className="mult-sub">
            {status === 'riding'
              ? 'Riding…'
              : status === 'crashed'
                ? 'Crashed'
                : status === 'cashed'
                  ? 'Cashed out'
                  : 'Ready'}
          </span>
        </div>

        <svg className="wave-chart" viewBox={`0 0 ${w} ${h}`} aria-hidden>
          <path
            d={path || 'M 10 150'}
            fill="none"
            stroke="#22d3ee"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>

        {status === 'crashed' && <div className="banner error">Wave crashed — bet lost</div>}
        {status === 'cashed' && lastPayout !== null && lastPayout > 0 && (
          <div className="banner win">Cashed +₹{money(lastPayout)}</div>
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
                {lastPayout === null
                  ? '—'
                  : lastPayout > 0
                    ? `+₹${money(lastPayout)}`
                    : '₹0.00'}
              </span>
            </div>
          </div>

          {status !== 'riding' ? (
            <>
              <div className="bet-controls">
                <label className="bet-label" htmlFor="bet">
                  Bet amount
                </label>
                <div className="bet-input-row">
                  <button
                    type="button"
                    className="chip"
                    disabled={busy || !ready}
                    onClick={() => clamp(bet / 2)}
                  >
                    ½
                  </button>
                  <div className="bet-field">
                    <span className="bet-currency">₹</span>
                    <input
                      id="bet"
                      type="number"
                      min={1}
                      value={bet}
                      disabled={busy || !ready}
                      onChange={(e) => clamp(Number(e.target.value) || 1)}
                    />
                  </div>
                  <button
                    type="button"
                    className="chip"
                    disabled={busy || !ready}
                    onClick={() => clamp(bet * 2)}
                  >
                    2×
                  </button>
                </div>
              </div>
              <button
                type="button"
                className="spin-btn"
                disabled={busy || !ready || bet > balance}
                onClick={() => void onStart()}
              >
                Bet
              </button>
            </>
          ) : (
            <button
              type="button"
              className="spin-btn cashout"
              disabled={busy || mult < 1.01}
              onClick={() => void onCashOut()}
            >
              Cash out {mult.toFixed(2)}x
            </button>
          )}
        </div>
      </main>
    </div>
  )
}
