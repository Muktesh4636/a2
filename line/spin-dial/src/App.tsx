import { useCallback, useEffect, useState } from 'react'
import { createSession, getSession, loadPlayerId, placePlay, savePlayerId } from './api'
import { BetPanel } from './BetPanel'
import { ANIM_MS, DEFAULT_BET, SEGMENTS, type MultiplierKey } from './gameConfig'
import { Dial } from './Dial'
import { MultiplierBar } from './MultiplierBar'

/** Pointer is fixed at 90° (top). Rotate dial so segment angle lands at 90. */
function rotationForAngle(targetAngle: number, base: number) {
  const spins = 4 + Math.floor(Math.random() * 2)
  const desired = 90 - targetAngle
  const normalized = ((base % 360) + 360) % 360
  let delta = ((desired % 360) + 360) % 360 - normalized
  if (delta <= 0) delta += 360
  return base + spins * 360 + delta
}

export default function App() {
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [balance, setBalance] = useState(0)
  const [bet, setBet] = useState(DEFAULT_BET)
  const [rotation, setRotation] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const [lastMultiplier, setLastMultiplier] = useState<MultiplierKey | null>(null)
  const [lastPayout, setLastPayout] = useState<number | null>(null)
  const [highlighted, setHighlighted] = useState<MultiplierKey | null>(null)
  const [resultColor, setResultColor] = useState<string | null>(null)
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
        if (alive) setError(e instanceof Error ? e.message : 'Server offline (:8003)')
      }
    })()
    return () => { alive = false }
  }, [])

  const onPlay = useCallback(async () => {
    if (!playerId || spinning || bet > balance || bet < 1) return
    setSpinning(true)
    setLastMultiplier(null)
    setLastPayout(null)
    setHighlighted(null)
    setResultColor(null)
    setError(null)
    setBalance((b) => b - bet)
    try {
      const result = await placePlay(playerId, bet)
      const mult = Number(result.multiplier) as MultiplierKey
      setRotation((r) => rotationForAngle(result.target_angle, r))
      window.setTimeout(() => {
        setBalance(Number(result.balance))
        setLastMultiplier(mult)
        setLastPayout(Number(result.payout))
        setHighlighted(mult)
        setResultColor(result.color)
        setSpinning(false)
      }, ANIM_MS)
    } catch (e) {
      setBalance((b) => b + bet)
      setSpinning(false)
      setError(e instanceof Error ? e.message : 'Play failed')
    }
  }, [playerId, spinning, bet, balance])

  return (
    <div className="app">
      <header className="brand">
        <h1>Spin Dial</h1>
        <p>Bet. Dial spins. Arrow picks the color.</p>
      </header>
      {error && <div className="banner error">{error}</div>}
      {!ready && !error && <div className="banner">Connecting…</div>}
      <main className="stage">
        <Dial
          segments={SEGMENTS}
          rotation={rotation}
          spinning={spinning}
          resultMultiplier={lastMultiplier}
          resultColor={resultColor}
          resultPayout={lastPayout}
        />
        <MultiplierBar highlighted={highlighted} />
        <BetPanel
          balance={balance}
          bet={bet}
          busy={spinning || !ready}
          playing={spinning}
          onBetChange={setBet}
          onPlay={() => void onPlay()}
          lastPayout={lastPayout}
          lastMultiplier={lastMultiplier}
        />
      </main>
    </div>
  )
}
