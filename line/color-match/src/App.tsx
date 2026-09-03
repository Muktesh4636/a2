import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSession, getSession, loadPlayerId, placePlay, savePlayerId } from './api'
import {
  ANIM_MS,
  DEFAULT_BET,
  PAYLINE_ROW,
  buildReelStrip,
  type ColorId,
} from './gameConfig'
import { Reel } from './Reel'
import {
  playBetSound,
  playResultSound,
  playSpinSound,
  playStopSound,
  stopSpinSound,
  unlockGameAudio,
} from './gameSounds'

const CELL = 68
const GAP = 10
const STEP = CELL + GAP

function money(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function stopOffset(stripLen: number): number {
  const centerIndex = stripLen - 3
  return -(centerIndex - PAYLINE_ROW) * STEP
}

export default function App() {
  const initialStrips = useMemo(
    () => [buildReelStrip('green'), buildReelStrip('yellow'), buildReelStrip('purple')],
    [],
  )
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [balance, setBalance] = useState(0)
  const [bet, setBet] = useState(DEFAULT_BET)
  const [strips, setStrips] = useState<ColorId[][]>(initialStrips)
  const [offsets, setOffsets] = useState(() =>
    initialStrips.map((s) => stopOffset(s.length)),
  )
  const [spinning, setSpinning] = useState(false)
  const [animate, setAnimate] = useState(false)
  const [lastPayout, setLastPayout] = useState<number | null>(null)
  const [lastMult, setLastMult] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [auto, setAuto] = useState(false)

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
        if (alive) setError(e instanceof Error ? e.message : 'Server offline (:8006)')
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const clamp = (v: number) =>
    setBet(Math.min(Math.max(1, Math.round(v * 100) / 100), Math.max(1, balance)))

  const onPlay = useCallback(async () => {
    if (!playerId || spinning || bet > balance || bet < 1) return
    unlockGameAudio()
    playBetSound()
    setSpinning(true)
    setAnimate(false)
    setLastPayout(null)
    setLastMult(null)
    setError(null)
    setBalance((b) => b - bet)

    setOffsets((prev) => prev.map((o) => o + STEP * 18))

    try {
      const r = await placePlay(playerId, bet)
      const nextCenters = r.reels as ColorId[]
      const nextStrips = nextCenters.map((c) => buildReelStrip(c))

      requestAnimationFrame(() => {
        setStrips(nextStrips)
        setOffsets(nextStrips.map((s) => stopOffset(s.length) + STEP * 22))
        requestAnimationFrame(() => {
          setAnimate(true)
          setOffsets(nextStrips.map((s) => stopOffset(s.length)))
          playSpinSound(ANIM_MS)
        })
      })

      window.setTimeout(() => {
        stopSpinSound()
        playStopSound()
        playResultSound(Number(r.payout) > 0)
        setLastMult(Number(r.multiplier))
        setLastPayout(Number(r.payout))
        setBalance(Number(r.balance))
        setSpinning(false)
        setAnimate(false)
      }, ANIM_MS)
    } catch (e) {
      stopSpinSound()
      setBalance((b) => b + bet)
      setSpinning(false)
      setAnimate(false)
      setError(e instanceof Error ? e.message : 'Failed')
    }
  }, [playerId, spinning, bet, balance])

  useEffect(() => {
    if (!auto || spinning || !ready || bet > balance) return
    const t = window.setTimeout(() => void onPlay(), 800)
    return () => window.clearTimeout(t)
  }, [auto, spinning, ready, onPlay, bet, balance])

  const titleLetters = [
    ['C', '#22c55e'],
    ['O', '#eab308'],
    ['L', '#a855f7'],
    ['O', '#3b82f6'],
    ['R', '#22d3ee'],
  ] as const

  const winText =
    lastPayout !== null && lastPayout > 0 ? `₹${money(lastPayout)}` : '--'

  return (
    <div className="cm-app">
      <header className="cm-topbar">
        <div className="cm-balance">
          <span className="cm-bal-dot" />
          ₹{money(balance)} INR
          <span className="cm-bal-caret">▾</span>
        </div>
        <div className="cm-avatar" aria-hidden />
      </header>

      {error && <div className="banner error">{error}</div>}
      {!ready && !error && <div className="banner">Connecting…</div>}

      <div className="cm-title-block">
        <h1 className="cm-title">
          {titleLetters.map(([ch, c], i) => (
            <span key={i} style={{ color: c }}>
              {ch}
            </span>
          ))}{' '}
          <span className="cm-title-match">MATCH</span>
        </h1>
        <p className="cm-sub">✦ MATCH 3 COLORS ✦</p>
      </div>

      <div className={`cm-machine${spinning ? ' spinning' : ''}`}>
        <div className="cm-reels">
          {strips.map((strip, i) => (
            <Reel
              key={i}
              strip={strip}
              offsetY={offsets[i]}
              spinning={animate}
              cellSize={CELL}
              gap={GAP}
            />
          ))}
          <div className="cm-payline" aria-hidden>
            <span className="cm-pay-dot" />
            <span className="cm-pay-line" />
            <span className="cm-pay-dot" />
          </div>
        </div>
      </div>

      <div className="cm-stats">
        <div className="cm-stat">
          <span className="cm-stat-label">🏆 PAYOUT</span>
          <span className="cm-stat-value accent">
            {lastMult !== null && lastMult > 0 ? `${lastMult.toFixed(2)}x` : '--'}
          </span>
        </div>
        <div className="cm-stat">
          <span className="cm-stat-label">🎁 WIN</span>
          <span className={`cm-stat-value${lastPayout && lastPayout > 0 ? ' win' : ''}`}>
            {winText}
          </span>
        </div>
      </div>

      <div className="cm-controls">
        <div className="cm-bet-box">
          <button
            type="button"
            className="cm-round-btn"
            disabled={spinning || !ready}
            onClick={() => clamp(bet - 1)}
          >
            −
          </button>
          <div className="cm-bet-mid">
            <span className="cm-bet-label">BET</span>
            <span className="cm-bet-val">{bet.toFixed(2)} INR</span>
          </div>
          <button
            type="button"
            className="cm-round-btn"
            disabled={spinning || !ready}
            onClick={() => clamp(bet + 1)}
          >
            +
          </button>
        </div>

        <button
          type="button"
          className={`cm-auto${auto ? ' on' : ''}`}
          disabled={!ready}
          onClick={() => setAuto((a) => !a)}
        >
          <span className="cm-auto-icon">↻</span>
          AUTO
        </button>

        <button
          type="button"
          className="cm-spin"
          disabled={spinning || !ready || bet > balance}
          onPointerDown={() => unlockGameAudio()}
          onClick={() => void onPlay()}
        >
          <span>SPIN</span>
          <span className="cm-spin-icon">↻</span>
        </button>
      </div>
    </div>
  )
}
