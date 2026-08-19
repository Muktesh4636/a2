import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSession, getSession, loadPlayerId, placePlay, savePlayerId } from './api'
import { DEFAULT_BET, MAX_PICKS, MIN_PICKS, POOL, tableFor } from './gameConfig'

function money(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function randomPicks(count: number) {
  const pool = Array.from({ length: POOL }, (_, i) => i + 1)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, count).sort((a, b) => a - b)
}

export default function App() {
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [balance, setBalance] = useState(0)
  const [bet, setBet] = useState(DEFAULT_BET)
  const [picks, setPicks] = useState<number[]>([])
  const [drawn, setDrawn] = useState<number[]>([])
  const [hits, setHits] = useState<number[]>([])
  const [playing, setPlaying] = useState(false)
  const [lastMult, setLastMult] = useState<number | null>(null)
  const [lastPayout, setLastPayout] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  const table = useMemo(() => tableFor(Math.max(picks.length, 1)), [picks.length])
  const maxRow = table[table.length - 1]
  const hasResult = drawn.length > 0

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
        if (alive) setError(e instanceof Error ? e.message : 'Server offline (:8009)')
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const resetResult = () => {
    setDrawn([])
    setHits([])
    setLastMult(null)
    setLastPayout(null)
  }

  const toggle = (n: number) => {
    if (playing) return
    resetResult()
    setPicks((prev) => {
      if (prev.includes(n)) return prev.filter((x) => x !== n)
      if (prev.length >= MAX_PICKS) return prev
      return [...prev, n].sort((a, b) => a - b)
    })
  }

  const onPlay = useCallback(async () => {
    if (!playerId || playing || bet > balance || picks.length < MIN_PICKS) return
    setPlaying(true)
    setError(null)
    setLastMult(null)
    setLastPayout(null)
    setDrawn([])
    setHits([])
    setBalance((b) => b - bet)
    try {
      const r = await placePlay(playerId, bet, picks)
      setDrawn(r.drawn)
      setHits(r.hits)
      setLastMult(Number(r.multiplier))
      setLastPayout(Number(r.payout))
      setBalance(Number(r.balance))
    } catch (e) {
      setBalance((b) => b + bet)
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setPlaying(false)
    }
  }, [playerId, playing, bet, balance, picks])

  const cellClass = (n: number) => {
    const selected = picks.includes(n)
    const isHit = hits.includes(n)
    const isDrawn = drawn.includes(n)
    if (isHit) return 'keno-cell hit'
    if (selected && hasResult) return 'keno-cell miss'
    if (isDrawn) return 'keno-cell drawn'
    if (selected) return 'keno-cell selected'
    return 'keno-cell'
  }

  return (
    <div className="keno-app">
      <header className="keno-top">
        <div className="keno-logo">stake</div>
        <div className="keno-balance">
          ₹{money(balance)} INR
          <button type="button" className="keno-plus" aria-label="Add">
            +
          </button>
        </div>
        <button type="button" className="keno-menu" aria-label="Menu">
          ☰
        </button>
      </header>

      {error && <div className="banner error">{error}</div>}
      {!ready && !error && <div className="banner">Connecting…</div>}

      <div className="keno-title">
        <h1>KENO</h1>
        <p>- PICK -</p>
      </div>

      <div className="keno-legend">
        <span>
          <i className="dot selected" /> Your pick
        </span>
        <span>
          <i className="dot hit" /> Hit (win)
        </span>
        <span>
          <i className="dot drawn" /> Drawn
        </span>
      </div>

      <div className="keno-grid">
        {Array.from({ length: POOL }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            className={cellClass(n)}
            disabled={!ready || playing}
            onClick={() => toggle(n)}
          >
            {n}
          </button>
        ))}
      </div>

      <div className="keno-pick-bar">
        <div className="keno-pick-count">
          <strong>{picks.length}</strong>
          <span>/ {MAX_PICKS} selected</span>
        </div>
        <div className="keno-pick-actions">
          <button
            type="button"
            disabled={!ready || playing}
            onClick={() => {
              resetResult()
              setPicks(randomPicks(6))
            }}
          >
            Auto 6
          </button>
          <button
            type="button"
            disabled={!ready || playing || picks.length === 0}
            onClick={() => {
              resetResult()
              setPicks([])
            }}
          >
            Clear
          </button>
        </div>
      </div>

      <p className="keno-hint">Tap numbers to select · Match more drawn numbers to win more</p>

      {hasResult && (
        <div className="keno-draw-box">
          <div className="keno-draw-title">Drawn numbers</div>
          <div className="keno-draw-list">
            {drawn.map((n) => (
              <span key={n} className={hits.includes(n) ? 'chip hit' : 'chip'}>
                {n}
              </span>
            ))}
          </div>
          <div className={`keno-result-line${(lastPayout ?? 0) > 0 ? ' win' : ''}`}>
            You hit <strong>{hits.length}</strong>
            {hits.length > 0 ? ` (${hits.join(', ')})` : ''} ·{' '}
            <strong>{lastMult?.toFixed(2)}x</strong> ·{' '}
            {(lastPayout ?? 0) > 0 ? `+₹${money(lastPayout!)}` : 'No win'}
          </div>
        </div>
      )}

      <div className="keno-panel">
        <div className="keno-bet-row">
          <div>
            <label className="keno-field-label" htmlFor="bet">
              Bet Amount
            </label>
            <div className="keno-bet">
              <span>₹</span>
              <input
                id="bet"
                type="number"
                min={1}
                value={bet}
                disabled={!ready || playing}
                onChange={(e) =>
                  setBet(Math.min(Math.max(1, Number(e.target.value) || 1), Math.floor(balance) || 1))
                }
              />
              <span>INR</span>
            </div>
          </div>
          <div className="keno-max-pay">
            <span className="keno-field-label">Max for {picks.length || 0} picks</span>
            <strong>{maxRow ? `${maxRow.multiplier.toFixed(2)}x` : '—'}</strong>
          </div>
        </div>

        <div className="keno-table">
          <div className="keno-table-head">
            <span>HITS</span>
            <span>PAYOUT</span>
          </div>
          {table.map((row) => (
            <div
              key={row.hits}
              className={`keno-table-row${row.hits === picks.length ? ' active' : ''}${
                hasResult && hits.length === row.hits ? ' result' : ''
              }`}
            >
              <span>{row.hits} hit{row.hits === 1 ? '' : 's'}</span>
              <span>{row.multiplier.toFixed(2)}x</span>
            </div>
          ))}
        </div>
      </div>

      <button
        type="button"
        className="keno-play"
        disabled={!ready || playing || picks.length < MIN_PICKS || bet > balance}
        onClick={() => void onPlay()}
      >
        {playing ? 'DRAWING…' : picks.length < MIN_PICKS ? 'SELECT NUMBERS' : 'PLAY'}
      </button>
    </div>
  )
}
