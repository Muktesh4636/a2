import { useCallback, useEffect, useState } from 'react'
import {
  createSession,
  getSession,
  loadPlayerId,
  placePlay,
  savePlayerId,
} from './api'
import { BetPanel } from './BetPanel'
import {
  ANIM_MS,
  DEFAULT_BET,
  ZONES,
  type MultiplierKey,
} from './gameConfig'
import { MultiplierBar } from './MultiplierBar'
import { offsetForTarget, Track } from './Track'

export default function App() {
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [balance, setBalance] = useState(0)
  const [bet, setBet] = useState(DEFAULT_BET)
  const [cycleWidth, setCycleWidth] = useState(360)
  const [stripOffset, setStripOffset] = useState(0)
  const [scrolling, setScrolling] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [lastMultiplier, setLastMultiplier] = useState<MultiplierKey | null>(
    null,
  )
  const [lastPayout, setLastPayout] = useState<number | null>(null)
  const [highlighted, setHighlighted] = useState<MultiplierKey | null>(null)
  const [resultColor, setResultColor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Idle: center the strip so a mid zone sits under the fixed arrow
    setStripOffset(offsetForTarget(50, cycleWidth, 0))
  }, [cycleWidth])

  useEffect(() => {
    let alive = true

    async function boot() {
      setError(null)
      try {
        let id = loadPlayerId()
        let session = null as Awaited<ReturnType<typeof createSession>> | null

        if (id) {
          try {
            session = await getSession(id)
          } catch {
            session = null
            id = null
          }
        }

        if (!session) {
          session = await createSession()
          id = session.player_id
          savePlayerId(id)
        }

        if (!alive) return
        setPlayerId(id)
        setBalance(Number(session.balance))
        setReady(true)
      } catch (e) {
        if (!alive) return
        try {
          await new Promise((r) => setTimeout(r, 600))
          const session = await createSession()
          if (!alive) return
          savePlayerId(session.player_id)
          setPlayerId(session.player_id)
          setBalance(Number(session.balance))
          setReady(true)
        } catch {
          setError(
            e instanceof Error
              ? e.message
              : 'Could not reach the game server. Is Django running on :8002?',
          )
        }
      }
    }

    void boot()
    return () => {
      alive = false
    }
  }, [])

  const onPlay = useCallback(async () => {
    if (!playerId || playing || bet > balance || bet < 1) return

    setPlaying(true)
    setScrolling(false)
    setLastMultiplier(null)
    setLastPayout(null)
    setHighlighted(null)
    setResultColor(null)
    setError(null)
    setBalance((b) => b - bet)

    // Snap strip to start (no transition)
    setStripOffset(offsetForTarget(8, cycleWidth, 0))

    try {
      const result = await placePlay(playerId, bet)
      const mult = Number(result.multiplier) as MultiplierKey
      const payout = Number(result.payout)
      const target = result.target_position
      const finalOffset = offsetForTarget(target, cycleWidth, 4)

      requestAnimationFrame(() => {
        setScrolling(true)
        requestAnimationFrame(() => {
          setStripOffset(finalOffset)
        })
      })

      window.setTimeout(() => {
        setBalance(Number(result.balance))
        setLastMultiplier(mult)
        setLastPayout(payout)
        setHighlighted(mult)
        setResultColor(result.color)
        setPlaying(false)
        setScrolling(false)
      }, ANIM_MS)
    } catch (e) {
      setBalance((b) => b + bet)
      setPlaying(false)
      setScrolling(false)
      setError(e instanceof Error ? e.message : 'Play failed')
    }
  }, [playerId, playing, bet, balance, cycleWidth])

  return (
    <div className="app">
      <header className="brand">
        <h1>Stop Bar</h1>
        <p>Bet. Colors scroll. Arrow stops the win.</p>
      </header>

      {error && <div className="banner error">{error}</div>}
      {!ready && !error && <div className="banner">Connecting…</div>}

      <main className="stage">
        <Track
          zones={ZONES}
          stripOffset={stripOffset}
          playing={scrolling}
          resultMultiplier={lastMultiplier}
          resultColor={resultColor}
          resultPayout={lastPayout}
          onWidth={setCycleWidth}
        />
        <MultiplierBar highlighted={highlighted} />
        <BetPanel
          balance={balance}
          bet={bet}
          busy={playing || !ready}
          playing={playing}
          onBetChange={setBet}
          onPlay={() => void onPlay()}
          lastPayout={lastPayout}
          lastMultiplier={lastMultiplier}
        />
      </main>
    </div>
  )
}
