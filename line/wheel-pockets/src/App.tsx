import { useCallback, useEffect, useState } from 'react'
import { createSession, getSession, loadPlayerId, placePlay, savePlayerId } from './api'
import { ANIM_MS, DEFAULT_BET, MAX_MULT, POCKETS, type Mult } from './gameConfig'
import { playSpinSound, stopSpinSound } from './spinSound'

const SIZE = 360
const CX = SIZE / 2
const CY = SIZE / 2
const R_OUTER = 158
const R_INNER = 46
const R_LABEL = 112
const R_RIM = 168
/** Center first pocket (100x) under the pointer at rest */
const INITIAL_ROTATION = -(POCKETS[0].span / 2)

function polar(deg: number, r: number) {
  const rad = ((deg - 90) * Math.PI) / 180
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) }
}

/** Donut slice between inner and outer radius. */
function slice(start: number, span: number) {
  const a0 = start
  const a1 = start + span
  const o0 = polar(a0, R_OUTER)
  const o1 = polar(a1, R_OUTER)
  const i0 = polar(a0, R_INNER)
  const i1 = polar(a1, R_INNER)
  return [
    `M ${o0.x} ${o0.y}`,
    `A ${R_OUTER} ${R_OUTER} 0 0 1 ${o1.x} ${o1.y}`,
    `L ${i1.x} ${i1.y}`,
    `A ${R_INNER} ${R_INNER} 0 0 0 ${i0.x} ${i0.y}`,
    'Z',
  ].join(' ')
}

function money(n: number) {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

function moneyFull(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function rotationFor(target: number, base: number) {
  const spins = 5 + Math.floor(Math.random() * 2)
  const desired = ((-target % 360) + 360) % 360
  const norm = ((base % 360) + 360) % 360
  let delta = desired - norm
  if (delta <= 0) delta += 360
  return base + spins * 360 + delta
}

export default function App() {
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [balance, setBalance] = useState(0)
  const [bet, setBet] = useState(DEFAULT_BET)
  const [rotation, setRotation] = useState(INITIAL_ROTATION)
  const [spinning, setSpinning] = useState(false)
  const [lastMult, setLastMult] = useState<Mult | null>(null)
  const [lastPayout, setLastPayout] = useState<number | null>(null)
  const [auto, setAuto] = useState(false)
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
        setReady(true)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Server offline (:8007)')
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const clamp = (v: number) =>
    setBet(Math.min(Math.max(1, Math.round(v)), Math.max(1, Math.floor(balance))))

  const onPlay = useCallback(async () => {
    if (!playerId || spinning || bet > balance || bet < 1) return
    setSpinning(true)
    playSpinSound()
    setLastMult(null)
    setLastPayout(null)
    setError(null)
    setBalance((b) => b - bet)
    try {
      const r = await placePlay(playerId, bet)
      setRotation((prev) => rotationFor(r.target_angle, prev))
      window.setTimeout(() => {
        stopSpinSound()
        setBalance(Number(r.balance))
        setLastMult(Number(r.multiplier) as Mult)
        setLastPayout(Number(r.payout))
        setSpinning(false)
      }, ANIM_MS)
    } catch (e) {
      stopSpinSound()
      setBalance((b) => b + bet)
      setSpinning(false)
      setError(e instanceof Error ? e.message : 'Failed')
    }
  }, [playerId, spinning, bet, balance])

  useEffect(() => {
    if (!auto || spinning || !ready || bet > balance) return
    const t = window.setTimeout(() => void onPlay(), 900)
    return () => window.clearTimeout(t)
  }, [auto, spinning, ready, onPlay, bet, balance])

  const rimStuds = Array.from({ length: 30 }, (_, i) => {
    const a = (i / 30) * 360
    const p = polar(a, R_RIM - 4)
    return <circle key={i} cx={p.x} cy={p.y} r={2.2} fill="#d4a017" />
  })

  return (
    <div className="wp-app">
      <header className="wp-top">
        <button type="button" className="wp-icon-btn" aria-label="Menu">
          ☰
        </button>
        <div className="wp-title-block">
          <h1 className="wp-title">
            <span className="wp-gem">◆</span> WHEEL OF POCKETS <span className="wp-gem">◆</span>
          </h1>
          <div className="wp-badge">Win up to {MAX_MULT}x</div>
        </div>
        <div className="wp-wallet">
          <span className="wp-wallet-ico" aria-hidden />
          ₹{money(balance)}
          <button type="button" className="wp-plus" aria-label="Add">
            +
          </button>
        </div>
      </header>

      <div className="wp-side-row">
        <div className="wp-side">
          <span className="wp-side-ico rewards">🎁</span>
          Rewards
        </div>
        <div className="wp-side">
          <span className="wp-side-ico history">📄</span>
          History
        </div>
      </div>

      {error && <div className="banner error">{error}</div>}
      {!ready && !error && <div className="banner">Connecting…</div>}

      {lastMult !== null && (
        <div className="wp-result">
          <span className="wp-result-mult">{lastMult}x</span>
          {lastPayout !== null && lastPayout > 0 && (
            <span className="wp-result-pay">+₹{moneyFull(lastPayout)}</span>
          )}
        </div>
      )}

      <div className="wp-wheel-stage">
        <div className="wp-pointer" aria-hidden>
          <svg viewBox="0 0 40 36" width="28" height="26">
            <polygon points="20,34 4,4 36,4" fill="#d4a017" stroke="#f5d76e" strokeWidth="1.5" />
          </svg>
        </div>

        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="wp-wheel" width={SIZE} height={SIZE}>
          <defs>
            <radialGradient id="hubGrad" cx="50%" cy="40%" r="60%">
              <stop offset="0%" stopColor="#2a3348" />
              <stop offset="100%" stopColor="#0f1420" />
            </radialGradient>
            <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="1.2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <circle cx={CX} cy={CY} r={R_RIM} fill="#1a2030" stroke="#3d4a63" strokeWidth="6" />
          {rimStuds}

          <g
            className={spinning ? 'wp-rotor spinning' : 'wp-rotor'}
            style={{ transform: `rotate(${rotation}deg)`, transformOrigin: `${CX}px ${CY}px` }}
          >
            {POCKETS.map((p) => {
              const mid = p.start + p.span / 2
              const labelPos = polar(mid, R_LABEL)
              const textAngle = mid > 90 && mid < 270 ? mid + 180 : mid
              return (
                <g key={p.id}>
                  <path
                    d={slice(p.start, p.span)}
                    fill={p.color}
                    stroke="#0b1020"
                    strokeWidth={1.5}
                  />
                  <text
                    x={labelPos.x}
                    y={labelPos.y}
                    fill="#fff"
                    fontSize={p.multiplier >= 100 ? 15 : 14}
                    fontWeight={800}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    transform={`rotate(${textAngle} ${labelPos.x} ${labelPos.y})`}
                    style={{
                      paintOrder: 'stroke',
                      stroke: 'rgba(0,0,0,0.45)',
                      strokeWidth: 2.5,
                    }}
                  >
                    {p.label}
                  </text>
                </g>
              )
            })}
            <circle cx={CX} cy={CY} r={R_INNER - 2} fill="url(#hubGrad)" stroke="#2f3b52" strokeWidth={3} />
            <text
              x={CX}
              y={CY + 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#c9a227"
              fontSize="28"
              fontFamily="Georgia, serif"
              opacity={0.85}
            >
              ♠
            </text>
            <text
              x={CX}
              y={CY + 1}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#0f1420"
              fontSize="11"
              fontWeight={800}
            >
              P
            </text>
          </g>
        </svg>
      </div>

      <div className="wp-controls">
        <div className="wp-bet-row">
          <div className="wp-bet-block">
            <label className="wp-field-label" htmlFor="bet">
              Bet Amount
            </label>
            <div className="wp-bet-field">
              <span>₹</span>
              <input
                id="bet"
                type="number"
                min={1}
                value={bet}
                disabled={spinning || !ready}
                onChange={(e) => clamp(Number(e.target.value) || 1)}
              />
            </div>
          </div>

          <div className="wp-quick">
            <button type="button" disabled={spinning || !ready} onClick={() => clamp(1)}>
              MIN
            </button>
            <button type="button" disabled={spinning || !ready} onClick={() => clamp(bet / 2)}>
              1/2
            </button>
            <button type="button" disabled={spinning || !ready} onClick={() => clamp(bet * 2)}>
              2X
            </button>
            <button
              type="button"
              disabled={spinning || !ready}
              onClick={() => clamp(Math.floor(balance))}
            >
              MAX
            </button>
          </div>

          <div className="wp-auto-block">
            <span className="wp-field-label">Auto Spin</span>
            <button
              type="button"
              className={`wp-auto${auto ? ' on' : ''}`}
              disabled={!ready}
              onClick={() => setAuto((a) => !a)}
            >
              {auto ? 'On' : 'Off'} ▾
            </button>
          </div>
        </div>

        <button
          type="button"
          className="wp-spin"
          disabled={spinning || !ready || bet > balance}
          onClick={() => void onPlay()}
        >
          {spinning ? 'SPINNING…' : 'SPIN'}
        </button>
      </div>
    </div>
  )
}
