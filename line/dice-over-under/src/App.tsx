import { useCallback, useEffect, useState } from 'react'
import { createSession, getSession, loadPlayerId, placePlay, savePlayerId } from './api'
import {
  ANIM_MS,
  DEFAULT_BET,
  DEFAULT_TARGET,
  MAX_TARGET,
  MIN_TARGET,
  calcMultiplier,
} from './gameConfig'

function money(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function App() {
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [balance, setBalance] = useState(0)
  const [bet, setBet] = useState(DEFAULT_BET)
  const [target, setTarget] = useState(DEFAULT_TARGET)
  const [side, setSide] = useState<'under' | 'over'>('under')
  const [roll, setRoll] = useState<number | null>(null)
  const [displayRoll, setDisplayRoll] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [lastWon, setLastWon] = useState<boolean | null>(null)
  const [lastPayout, setLastPayout] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  const mult = calcMultiplier(target, side)

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
        if (alive) setError(e instanceof Error ? e.message : 'Server offline (:8005)')
      }
    })()
    return () => { alive = false }
  }, [])

  const onPlay = useCallback(async () => {
    if (!playerId || playing || bet > balance || bet < 1) return
    setPlaying(true)
    setError(null)
    setLastWon(null)
    setLastPayout(null)
    setBalance((b) => b - bet)

    // animate rolling numbers
    const tick = window.setInterval(() => {
      setDisplayRoll(Math.random() * 100)
    }, 50)

    try {
      const result = await placePlay(playerId, bet, target, side)
      window.setTimeout(() => {
        window.clearInterval(tick)
        setRoll(result.roll)
        setDisplayRoll(result.roll)
        setLastWon(result.won)
        setLastPayout(Number(result.payout))
        setBalance(Number(result.balance))
        setPlaying(false)
      }, ANIM_MS)
    } catch (e) {
      window.clearInterval(tick)
      setBalance((b) => b + bet)
      setPlaying(false)
      setError(e instanceof Error ? e.message : 'Play failed')
    }
  }, [playerId, playing, bet, balance, target, side])

  const clampBet = (v: number) => setBet(Math.min(balance, Math.max(1, Math.round(v * 100) / 100)))

  return (
    <div className="app">
      <header className="brand">
        <h1>Dice</h1>
        <p>Pick Over or Under. Roll the line.</p>
      </header>
      {error && <div className="banner error">{error}</div>}
      {!ready && !error && <div className="banner">Connecting…</div>}

      <main className="stage">
        <div className={`roll-display${lastWon === true ? ' win' : lastWon === false ? ' lose' : ''}`}>
          <span className="roll-label">Roll</span>
          <span className="roll-value">{displayRoll.toFixed(2)}</span>
        </div>

        <div className="number-line">
          <div className="line-track">
            <div className="line-fill under" style={{ width: `${target}%` }} />
            <div className="line-fill over" style={{ left: `${target}%`, width: `${100 - target}%` }} />
            <div className="line-thumb" style={{ left: `${target}%` }} />
            {roll !== null && (
              <div className="line-result" style={{ left: `${roll}%` }} title={`${roll.toFixed(2)}`} />
            )}
          </div>
          <div className="line-labels">
            <span>0</span>
            <span>{target}</span>
            <span>100</span>
          </div>
        </div>

        <div className="side-row">
          <button
            type="button"
            className={`side-btn${side === 'under' ? ' active under' : ''}`}
            disabled={playing}
            onClick={() => setSide('under')}
          >
            Under
          </button>
          <button
            type="button"
            className={`side-btn${side === 'over' ? ' active over' : ''}`}
            disabled={playing}
            onClick={() => setSide('over')}
          >
            Over
          </button>
        </div>

        <div className="target-row">
          <label htmlFor="target">Target</label>
          <input
            id="target"
            type="range"
            min={MIN_TARGET}
            max={MAX_TARGET}
            value={target}
            disabled={playing}
            onChange={(e) => setTarget(Number(e.target.value))}
          />
          <span className="target-val">{target}</span>
        </div>

        <div className="mult-preview">
          Pays <strong>{mult.toFixed(2)}x</strong>
        </div>

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
          <div className="bet-controls">
            <label className="bet-label" htmlFor="bet">Bet amount</label>
            <div className="bet-input-row">
              <button type="button" className="chip" disabled={playing || !ready} onClick={() => clampBet(bet / 2)}>½</button>
              <div className="bet-field">
                <span className="bet-currency">₹</span>
                <input id="bet" type="number" min={1} value={bet} disabled={playing || !ready}
                  onChange={(e) => clampBet(Number(e.target.value) || 1)} />
              </div>
              <button type="button" className="chip" disabled={playing || !ready} onClick={() => clampBet(bet * 2)}>2×</button>
            </div>
          </div>
          <button type="button" className="spin-btn" disabled={playing || !ready || bet > balance}
            onClick={() => void onPlay()}>
            {playing ? 'Rolling…' : 'Bet'}
          </button>
        </div>
      </main>
    </div>
  )
}
