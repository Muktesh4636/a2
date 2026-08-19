import { useState, useEffect, useRef } from 'react'
import './App.css'
import GameField from './GameField'
import { api, readAccessToken } from './api'
import { playJump, unlockAudio, isMusicOn, setMusicOn } from './sounds'

const ASSET = (p) => `${import.meta.env.BASE_URL}${String(p).replace(/^\//, '')}`

const TOTAL = 24
const MIN_BET = 10
const MAX_BET = 500
const QUICK = [10, 20, 50, 100]

const MULTS = {
  easy:     [1.03,1.07,1.12,1.17,1.23,1.29,1.36,1.44,1.52,1.61,1.71,1.81,1.92,2.04,2.17,2.30,2.45,2.60,2.76,2.94,3.12,3.32,3.53,3.75],
  medium:   [1.12,1.28,1.47,1.70,1.98,2.31,2.70,3.16,3.70,4.34,5.10,6.00,7.07,8.34,9.85,11.64,13.77,16.30,19.30,22.85,27.07,32.08,38.02,45.08],
  hard:     [1.23,1.55,1.98,2.56,3.36,4.45,5.95,8.03,10.92,14.97,20.66,28.70,40.12,56.40,79.80,113.4,161.8,231.6,332.8,480.0,694.5,1008,1468,2144],
  hardcore: [1.63,2.80,5.00,9.31,18.0,36.1,74.5,157,339,748,1690,3910,9280,22600,56500,145000,382000,1035000,2880000,8230000,24100000,72500000,224000000,710000000],
}

const DIFF_OPTIONS = [
  { id: 'easy', label: 'Easy', heat: 1, color: '#3dd68c', hint: 'Lower risk' },
  { id: 'medium', label: 'Medium', heat: 2, color: '#f0c14b', hint: 'Balanced' },
  { id: 'hard', label: 'Hard', heat: 3, color: '#ff8a3d', hint: 'Higher risk' },
  { id: 'hardcore', label: 'Hardcore', heat: 4, color: '#ff4d6d', hint: 'Max heat' },
]

const FAKE = [
  { user: 'WorthOtter45', flag: 'ca' },
  { user: '29545666--7b', flag: 'in' },
  { user: 'LuckyFox99', flag: 'us' },
  { user: 'ProGamer22', flag: 'br' },
  { user: 'egg***88', flag: 'in' },
  { user: 'Kimmstarr', flag: 'nl' },
  { user: '62NiftyStint', flag: 'gb' },
  { user: '26286699--27e', flag: 'in' },
  { user: 'RajaWin***', flag: 'in' },
  { user: 'NightOwl_7', flag: 'de' },
  { user: 'SpinKing21', flag: 'ph' },
  { user: 'mystic***9', flag: 'us' },
  { user: 'ApexHunter', flag: 'au' },
  { user: 'bet***404', flag: 'ng' },
  { user: 'GoldenEgg88', flag: 'in' },
  { user: 'FoxTrail12', flag: 'ca' },
  { user: 'lucky***x', flag: 'bd' },
  { user: 'TurboDash', flag: 'br' },
  { user: 'neon_piper', flag: 'jp' },
  { user: 'CashCow99', flag: 'za' },
  { user: '7b--884512', flag: 'in' },
  { user: 'SkyRocket', flag: 'mx' },
  { user: 'play***77', flag: 'pk' },
  { user: 'NovaBlast', flag: 'fr' },
]

const AVATAR_COLORS = [
  '#c0392b', '#2980b9', '#27ae60', '#8e44ad', '#d35400',
  '#16a085', '#c0398b', '#2c3e50', '#e67e22', '#1abc9c',
]

function randomWin() {
  const roll = Math.random()
  if (roll < 0.55) return +(Math.random() * 80 + 5).toFixed(2)
  if (roll < 0.85) return +(Math.random() * 400 + 80).toFixed(2)
  return +(Math.random() * 2000 + 400).toFixed(2)
}

function nextLive(prev) {
  let u = FAKE[Math.floor(Math.random() * FAKE.length)]
  for (let i = 0; i < 6 && prev && u.user === prev.user; i++) {
    u = FAKE[Math.floor(Math.random() * FAKE.length)]
  }
  const letter = (u.user.replace(/[^a-zA-Z]/g, '')[0] || 'P').toUpperCase()
  return {
    ...u,
    amount: randomWin(),
    letter,
    color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  }
}

function blankRoad(diff) {
  const m = MULTS[diff] || MULTS.easy
  return Array.from({ length: TOTAL }, (_, i) => ({
    safe: true,
    mult: m[i] ?? m[m.length - 1],
    revealed: false,
  }))
}

function applyRevealed(road, revealed) {
  const next = road.map((t) => ({ ...t }))
  for (const tile of revealed || []) {
    const i = tile.index
    if (i >= 0 && i < next.length) {
      next[i] = { safe: !!tile.safe, mult: Number(tile.mult), revealed: true }
    }
  }
  return next
}

export default function App() {
  const [balance, setBalance] = useState(0)
  const [bet, setBet] = useState(20)
  const [diff, setDiff] = useState('easy')
  const [state, setState] = useState('idle')
  const [step, setStep] = useState(0)
  const [road, setRoad] = useState(() => blankRoad('easy'))
  const [anim, setAnim] = useState('idle')
  const [result, setResult] = useState(null)
  const [auto, setAuto] = useState(false)
  const [online, setOnline] = useState(1425)
  const [live, setLive] = useState(() => nextLive(null))
  const [fieldReady, setFieldReady] = useState(false)
  const [diffOpen, setDiffOpen] = useState(false)
  const [authReady, setAuthReady] = useState(false)
  const [authError, setAuthError] = useState('')
  const [musicOn, setMusicOnUi] = useState(isMusicOn)
  const busy = useRef(false)
  const fieldRef = useRef(null)
  const stepRef = useRef(0)
  const roadRef = useRef(road)
  const liveRef = useRef(live)
  const diffRef = useRef(null)
  const roundIdRef = useRef(null)
  const betRef = useRef(bet)
  roadRef.current = road
  stepRef.current = step
  liveRef.current = live
  betRef.current = bet

  useEffect(() => {
    const arm = () => unlockAudio()
    document.addEventListener('pointerdown', arm, { capture: true })
    document.addEventListener('touchstart', arm, { capture: true })
    return () => {
      document.removeEventListener('pointerdown', arm, { capture: true })
      document.removeEventListener('touchstart', arm, { capture: true })
    }
  }, [])

  useEffect(() => {
    if (!diffOpen) return
    const onDoc = (e) => {
      if (!diffRef.current?.contains(e.target)) setDiffOpen(false)
    }
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [diffOpen])

  useEffect(() => {
    if (state === 'playing') setDiffOpen(false)
  }, [state])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!readAccessToken()) {
        setAuthError('Login required — open Chicken Road from the app')
        setAuthReady(true)
        return
      }
      try {
        const me = await api('/me/')
        if (cancelled) return
        setBalance(Number(me.balance) || 0)
        if (me.active_round) {
          roundIdRef.current = me.active_round.round_id
          const r = applyRevealed(blankRoad(me.active_round.difficulty || 'easy'), me.active_round.revealed)
          roadRef.current = r
          setRoad(r)
          setDiff(me.active_round.difficulty || 'easy')
          setBet(Number(me.active_round.bet) || 20)
          setStep(Number(me.active_round.step) || 0)
          stepRef.current = Number(me.active_round.step) || 0
          setState('playing')
        }
        setAuthError('')
      } catch (e) {
        if (!cancelled) setAuthError(e.message || 'Login required')
      } finally {
        if (!cancelled) setAuthReady(true)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const curMult = step > 0 ? road[step - 1].mult : 1
  const winAmt = Math.round(bet * curMult)
  const activeDiff = DIFF_OPTIONS.find(d => d.id === diff) || DIFF_OPTIONS[0]

  function pickDiff(id) {
    if (state === 'playing' || state === 'returning') return
    setDiff(id)
    const r = blankRoad(id)
    roadRef.current = r
    setRoad(r)
    setDiffOpen(false)
  }

  function clampBet(v) {
    return Math.min(Math.max(Math.round(v) || MIN_BET, MIN_BET), Math.min(MAX_BET, Math.floor(balance)))
  }

  function playReveal(index, tile, { dead, finished, mult }) {
    playJump()
    setAnim(index === 0 ? 'jump' : 'go')
    const nextStep = index + 1
    stepRef.current = nextStep
    setStep(nextStep)
    fieldRef.current?.moveToStep?.(nextStep)

    setTimeout(() => {
      setRoad(prev => {
        const next = prev.map((o, i) => (i === index ? { ...o, safe: !!tile.safe, mult: Number(tile.mult), revealed: true } : o))
        roadRef.current = next
        return next
      })

      if (dead) {
        setAnim('dead')
        fieldRef.current?.playDeathFire?.(nextStep)
        // Keep Go/Cash/Play hidden while fried; only show Play after she gets home
        setTimeout(() => {
          setResult({ won: false, net: -betRef.current, mult: 0, total: 0 })
          roundIdRef.current = null
          setState('returning')
          setStep(0)
          stepRef.current = 0
          setAnim('go')
          fieldRef.current?.moveToStep?.(0)
          setTimeout(() => {
            setAnim('idle')
            setState('ended')
            busy.current = false
          }, 1000)
        }, 1600)
        return
      }

      setAnim('idle')
      if (finished) {
        busy.current = false
        const total = Math.round(Number(mult) * betRef.current)
        setResult({ won: true, net: total - betRef.current, mult: Number(mult), total })
        setState('ended')
        roundIdRef.current = null
        return
      }

      busy.current = false
      if (auto) {
        setTimeout(() => {
          if (!busy.current && state === 'playing') goNext()
        }, 600)
      }
    }, 500)
  }

  async function startGame() {
    if (busy.current || bet > balance || !fieldReady || !authReady || authError) return
    busy.current = true
    setResult(null)
    try {
      const data = await api('/start/', {
        method: 'POST',
        body: { bet, difficulty: diff },
      })
      if (typeof data.balance === 'number') setBalance(data.balance)
      roundIdRef.current = data.round_id
      const r = applyRevealed(blankRoad(diff), data.revealed)
      roadRef.current = r
      setRoad(r)
      setStep(0)
      stepRef.current = 0
      setAnim('idle')
      setState('playing')

      const last = (data.revealed || [])[0]
      if (last) {
        setTimeout(() => {
          playReveal(0, last, {
            dead: !!data.burned,
            finished: data.status === 'won',
            mult: data.result?.mult ?? last.mult,
          })
          if (data.result?.won && typeof data.balance === 'number') setBalance(data.balance)
        }, 280)
      } else {
        busy.current = false
      }
    } catch (e) {
      busy.current = false
      setAuthError(e.message || 'Bet failed')
    }
  }

  async function goNext() {
    if (state !== 'playing' || busy.current || !roundIdRef.current) return
    busy.current = true
    try {
      const data = await api(`/${roundIdRef.current}/go/`, { method: 'POST', body: {} })
      if (typeof data.balance === 'number') setBalance(data.balance)
      const revealed = data.revealed || []
      const last = revealed[revealed.length - 1]
      if (!last) {
        busy.current = false
        return
      }
      playReveal(last.index, last, {
        dead: !!data.burned,
        finished: data.status === 'won',
        mult: data.result?.mult ?? last.mult,
      })
      if (data.result?.won && typeof data.balance === 'number') setBalance(data.balance)
    } catch (e) {
      busy.current = false
      setAuthError(e.message || 'Move failed')
    }
  }

  async function cashOut() {
    if (state !== 'playing' || busy.current || stepRef.current === 0 || !roundIdRef.current) return
    busy.current = true
    try {
      const data = await api(`/${roundIdRef.current}/cashout/`, { method: 'POST', body: {} })
      if (typeof data.balance === 'number') setBalance(data.balance)
      const mult = data.result?.mult ?? curMult
      const total = data.result?.total ?? Math.round(bet * mult)
      setResult({ won: true, net: data.result?.net ?? (total - bet), mult, total })
      setState('ended')
      roundIdRef.current = null
    } catch (e) {
      setAuthError(e.message || 'Cash out failed')
    } finally {
      busy.current = false
    }
  }

  function reset() {
    setState('idle')
    setStep(0)
    stepRef.current = 0
    setAnim('idle')
    const r = blankRoad(diff)
    roadRef.current = r
    setRoad(r)
    setResult(null)
    roundIdRef.current = null
    busy.current = false
    setAuthError('')
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header__logo">
          <img src={ASSET('assets/logo_mobile.svg')} alt="Chicken Road" />
        </div>
        <div className="header__right">
          <div className="header__balance">
            {Math.round(balance).toLocaleString('en-IN')}
          </div>
          <button
            className={`header__icon${musicOn ? '' : ' header__icon--muted'}`}
            type="button"
            aria-label={musicOn ? 'Mute music' : 'Unmute music'}
            title={musicOn ? 'Music on' : 'Music off'}
            onClick={() => {
              const next = !musicOn
              setMusicOn(next)
              setMusicOnUi(next)
              if (next) unlockAudio()
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path fill="currentColor" d="M4 9v6h3.5L12 19.5V4.5L7.5 9H4zm11.5 3c0-1.8-1-3.4-2.5-4.2v8.4c1.5-.8 2.5-2.4 2.5-4.2z"/>
            </svg>
          </button>
        </div>
      </header>

      {authError ? (
        <div style={{ background: '#3a1520', color: '#ffb4c0', padding: '8px 12px', fontSize: 13, textAlign: 'center' }}>
          {authError}
        </div>
      ) : null}

      <div className="stage">
        <div className="live-members">
          <div className="live-members__pill">
            <span className="live-members__dot" />
            <span>{online}</span>
          </div>
        </div>
        <div className="live">
          <div className="live__entry" key={live.id}>
            <div className="live__avatar" style={{ background: live.color }}>
              {live.letter}
            </div>
            <img className="live__flag" src={`https://flagcdn.com/w40/${live.flag}.png`} alt="" />
            <span className="live__user">{live.user}</span>
            <span className="live__amt">+₹{Math.round(live.amount).toLocaleString('en-IN')}</span>
          </div>
        </div>

        <GameField
          ref={fieldRef}
          road={road}
          step={step}
          anim={anim}
          playing={state === 'playing' || state === 'returning'}
          onReady={() => setFieldReady(true)}
        />
      </div>

      <div className="betbar">
        <div className="betbar__input-row">
          <input
            className="betbar__input"
            type="number"
            value={bet}
            disabled={state === 'playing'}
            onChange={e => setBet(clampBet(+e.target.value))}
          />
        </div>

        <div className="betbar__quicks">
          {QUICK.map(q => (
            <button
              key={q}
              className="betbar__q"
              disabled={state === 'playing'}
              onClick={() => setBet(clampBet(q))}
            >
              <span>{q}</span>
              <img src={ASSET('assets/inr.svg')} alt="" />
            </button>
          ))}
        </div>

        <div className={`diff${diffOpen ? ' diff--open' : ''}${state === 'playing' || state === 'returning' ? ' diff--disabled' : ''}`} ref={diffRef}>
          <button
            type="button"
            className="diff__trigger"
            disabled={state === 'playing' || state === 'returning'}
            aria-haspopup="listbox"
            aria-expanded={diffOpen}
            onClick={() => setDiffOpen(o => !o)}
          >
            <span className="diff__heat" aria-hidden>
              {Array.from({ length: 4 }, (_, i) => (
                <span
                  key={i}
                  className={`diff__pip${i < activeDiff.heat ? ' diff__pip--on' : ''}`}
                  style={i < activeDiff.heat ? { background: activeDiff.color } : undefined}
                />
              ))}
            </span>
            <span className="diff__label" style={{ color: activeDiff.color }}>{activeDiff.label}</span>
            <span className="diff__chev" aria-hidden />
          </button>

          {diffOpen && (
            <div className="diff__menu" role="listbox" aria-label="Difficulty">
              {DIFF_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  role="option"
                  aria-selected={diff === opt.id}
                  className={`diff__option${diff === opt.id ? ' diff__option--active' : ''}`}
                  onClick={() => pickDiff(opt.id)}
                >
                  <span className="diff__heat" aria-hidden>
                    {Array.from({ length: 4 }, (_, i) => (
                      <span
                        key={i}
                        className={`diff__pip${i < opt.heat ? ' diff__pip--on' : ''}`}
                        style={i < opt.heat ? { background: opt.color } : undefined}
                      />
                    ))}
                  </span>
                  <span className="diff__option-text">
                    <span className="diff__option-name" style={{ color: opt.color }}>{opt.label}</span>
                    <span className="diff__option-hint">{opt.hint}</span>
                  </span>
                  {diff === opt.id && <span className="diff__check" aria-hidden>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="betbar__actions">
          {state === 'idle' && (
            <button className="betbar__play" onClick={startGame} disabled={!fieldReady}>
              {fieldReady ? 'Play' : 'Loading...'}
            </button>
          )}
          {state === 'playing' && step === 0 && (
            <button className="betbar__play" disabled>Play</button>
          )}
          {state === 'playing' && step > 0 && anim !== 'dead' && (
            <div className="betbar__dual">
              <button className="betbar__cash" onClick={cashOut}>
                Cash Out<br />₹{Math.round(winAmt).toLocaleString('en-IN')}
              </button>
              <button className="betbar__go" onClick={goNext}>Go</button>
            </div>
          )}
          {state === 'returning' && (
            <button className="betbar__play" disabled>Returning...</button>
          )}
          {state === 'ended' && (
            <button className="betbar__play" onClick={reset}>Play</button>
          )}
        </div>
      </div>

      {result?.won && state === 'ended' && (
        <div className="overlay" onClick={reset}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 48 }}>🥚</div>
            <div className="modal__title modal__title--win">You Win!</div>
            <div className="modal__amt modal__amt--win">
              +₹{Math.round(result.net).toLocaleString('en-IN')}
            </div>
            <button className="modal__btn" onClick={reset}>Play Again</button>
          </div>
        </div>
      )}
    </div>
  )
}
