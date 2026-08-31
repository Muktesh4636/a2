import { installCasinoBack } from './casinoBack'
installCasinoBack('aviator')
import './style.css'
import * as api from './api'

const ASSET = import.meta.env.BASE_URL
type Phase = 'waiting' | 'flying' | 'crashed'

let audioCtx: AudioContext | null = null
let noiseBuf: AudioBuffer | null = null
let awayBuf: AudioBuffer | null = null
let noiseNode: AudioBufferSourceNode | null = null
let awayNode: AudioBufferSourceNode | null = null
let buffersLoading: Promise<void> | null = null

function getAudioCtx() {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  if (!audioCtx) audioCtx = new AC()
  if (audioCtx.state === 'suspended') void audioCtx.resume()
  return audioCtx
}

async function loadFlightBuffers() {
  const ctx = getAudioCtx()
  if (noiseBuf && awayBuf) return
  if (!buffersLoading) {
    buffersLoading = (async () => {
      const [noiseRaw, awayRaw] = await Promise.all([
        fetch(`${ASSET}sounds/airplane-noise.mp3`).then((r) => r.arrayBuffer()),
        fetch(`${ASSET}sounds/plane-flyaway-1-3.mp3`).then((r) => r.arrayBuffer()),
      ])
      noiseBuf = await ctx.decodeAudioData(noiseRaw.slice(0))
      awayBuf = await ctx.decodeAudioData(awayRaw.slice(0))
    })()
  }
  await buffersLoading
}

function stopNode(node: AudioBufferSourceNode | null) {
  if (!node) return
  try {
    node.stop()
  } catch (_) {}
}

const flyAwayOnce = new Audio(`${ASSET}sounds/plane-flyaway-1-3.mp3`)
flyAwayOnce.preload = 'auto'
flyAwayOnce.loop = false
flyAwayOnce.volume = 1

const isPreviewMode = (() => {
  try {
    return new URLSearchParams(location.search).has('preview')
  } catch (_) {
    return false
  }
})()
let audioSilenced = isPreviewMode

function stopAllGameAudio() {
  audioSilenced = true
  stopNode(noiseNode)
  stopNode(awayNode)
  noiseNode = null
  awayNode = null
  try {
    flyAwayOnce.pause()
    flyAwayOnce.currentTime = 0
    flyAwayOnce.muted = true
  } catch (_) {}
  if (audioCtx) {
    try {
      void audioCtx.suspend()
    } catch (_) {}
  }
}

function silenceGameAudio(on: boolean) {
  if (on) {
    stopAllGameAudio()
    return
  }
  audioSilenced = false
  try {
    flyAwayOnce.muted = false
  } catch (_) {}
  if (audioCtx && audioCtx.state === 'suspended') {
    try {
      void audioCtx.resume()
    } catch (_) {}
  }
}

;(window as any).stopGameAudio = stopAllGameAudio
;(window as any).silenceGameAudio = silenceGameAudio

function startFlyingSound() {
  if (audioSilenced || isPreviewMode) return
  const ctx = getAudioCtx()
  flyAwayOnce.pause()
  flyAwayOnce.currentTime = 0
  void loadFlightBuffers().then(() => {
    if (audioSilenced || isPreviewMode || !noiseBuf) return
    stopNode(noiseNode)
    stopNode(awayNode)
    noiseNode = null
    awayNode = null
    const src = ctx.createBufferSource()
    src.buffer = noiseBuf
    src.loop = true
    const gain = ctx.createGain()
    gain.gain.value = 0.5
    src.connect(gain)
    gain.connect(ctx.destination)
    src.start()
    noiseNode = src
  })
}

function startFlyAwaySound() {
  if (audioSilenced || isPreviewMode) return
  stopNode(noiseNode)
  stopNode(awayNode)
  noiseNode = null
  awayNode = null
  flyAwayOnce.loop = false
  flyAwayOnce.muted = false
  flyAwayOnce.volume = 1
  try {
    flyAwayOnce.pause()
    flyAwayOnce.currentTime = 0
  } catch (_) {}
  const p = flyAwayOnce.play()
  if (p && typeof p.catch === 'function') {
    p.catch(() => {
      const ctx = getAudioCtx()
      void loadFlightBuffers().then(() => {
        if (audioSilenced || isPreviewMode || !awayBuf) return
        const src = ctx.createBufferSource()
        src.buffer = awayBuf
        src.loop = false
        const gain = ctx.createGain()
        gain.gain.value = 1
        src.connect(gain)
        gain.connect(ctx.destination)
        src.start()
        awayNode = src
      })
    })
  }
}

function armFlightAudio() {
  if (audioSilenced || isPreviewMode) return
  getAudioCtx()
  flyAwayOnce.muted = true
  const unlock = flyAwayOnce.play()
  if (unlock && typeof unlock.then === 'function') {
    void unlock
      .then(() => {
        flyAwayOnce.pause()
        flyAwayOnce.currentTime = 0
        flyAwayOnce.muted = false
      })
      .catch(() => {
        flyAwayOnce.muted = false
      })
  } else {
    flyAwayOnce.muted = false
  }
  void loadFlightBuffers().then(() => {
    if (phase === 'flying' && !noiseNode) startFlyingSound()
  })
}


window.addEventListener('pageshow', () => {
  if (isPreviewMode) return
  if (document.visibilityState !== 'visible') return
  audioSilenced = false
  try {
    flyAwayOnce.muted = false
  } catch (_) {}
})

document.addEventListener('pointerdown', armFlightAudio, { capture: true })
document.addEventListener('touchstart', armFlightAudio, { capture: true })
type Tab = 'all' | 'prev' | 'top'

interface BetPanel {
  amount: number
  mode: 'bet' | 'auto'
  autoCashout: number
  autoEnabled: boolean
  /** Stake locked for the current / next round */
  pending: boolean
  active: boolean
  cashed: boolean
  cashMult: number
}

interface LiveBet {
  name: string
  amount: number
  cashout: number | null
  win: number | null
}

/** Flight path — runs toward the far corner; plane center stays inset so the full sprite fits */
const P0 = { x: 0, y: 54 }
const P1 = { x: 55, y: 48 }
const P2 = { x: 92, y: 8 }
const BOTTOM_Y = 54
/** Plane size in CSS px — kept outside stretched SVG so it isn’t warped */
const PLANE_CSS_W = 96
const VIEW_W = 100
const VIEW_H = 56
/** Positive = sprite already pitched nose-up; added to path angle to cancel it */
const PLANE_ART_TILT = 14

const WAIT_MS = 5000
const CRASH_HOLD_MS = 3200
/** How long the plane takes to exit the stage after bust */
const FLY_AWAY_MS = 1100
/** Multiplier growth: ~e^(k t) feel used by crash games */
const GROWTH = 0.06
const MIN_BET = 10
const MAX_BET = 10000
const CURRENCY = 'INR'

const NAMES = [
  'd***7', 'a***k', 'r***9', 's***m', 'p***2', 'v***l', 'n***4', 'k***x',
  'm***8', 'j***p', 't***3', 'b***y', 'h***1', 'c***w', 'g***5', 'u***q',
  'x***2', 'z***f', 'q***1', 'w***9', 'e***3', 'y***7', 'i***6', 'o***4',
  'l***0', 'f***8', 'd***d', 's***s', 'a***a', 'b***b', 'c***c', 'n***n',
]

const BET_AMOUNTS = [10, 20, 40, 50, 80, 100, 150, 200, 300, 500, 800, 1000, 2000, 5000]

function randomLiveBet(): LiveBet {
  return {
    name: NAMES[Math.floor(Math.random() * NAMES.length)],
    amount: BET_AMOUNTS[Math.floor(Math.random() * BET_AMOUNTS.length)],
    cashout: null,
    win: null,
  }
}

function avatarHue(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return h
}

function avatarIndex(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h
}

/** Real photo avatar filling the full circle — stable per player name */
function betsAvatarHtml(name: string) {
  const h = avatarIndex(name)
  const gender = h % 2 === 0 ? 'm' : 'w'
  const id = h % 20
  const src = `/casino/avatars/${gender}${id}.jpg`
  const ring = `hsl(${avatarHue(name)} 70% 48%)`
  return `<i class="bets-av" style="box-shadow:0 0 0 1.5px ${ring}"><img src="${src}" alt="" width="22" height="22" loading="lazy" decoding="async" /></i>`
}



function round2(n: number) {
  return Math.round(n * 100) / 100
}

function formatMoney(n: number) {
  return n.toFixed(2)
}

function formatMult(m: number) {
  return `${m.toFixed(2)}x`
}

function multiplierColorClass(m: number) {
  if (m < 2) return 'low'
  if (m < 10) return 'mid'
  return 'high'
}

/** Classic crash sampling with ~3% house edge */
function sampleCrashPoint() {
  const r = Math.random()
  const e = 0.97
  const raw = Math.floor((100 * e) / (1 - r)) / 100
  return Math.max(1.0, Math.min(raw, 999.99))
}

function multFromElapsed(elapsedSec: number) {
  return Math.exp(growthRate * elapsedSec)
}

/** Path advances with flight time — nearly to the end of the stage. */
function progressFromElapsed(elapsedSec: number) {
  return Math.min(0.92, 1 - Math.exp(-elapsedSec * 0.15))
}

function quadPoint(t: number) {
  const u = 1 - t
  return {
    x: u * u * P0.x + 2 * u * t * P1.x + t * t * P2.x,
    y: u * u * P0.y + 2 * u * t * P1.y + t * t * P2.y,
  }
}

function quadTangent(t: number) {
  const u = 1 - t
  return {
    x: 2 * u * (P1.x - P0.x) + 2 * t * (P2.x - P1.x),
    y: 2 * u * (P1.y - P0.y) + 2 * t * (P2.y - P1.y),
  }
}

function quadLeftSplit(t: number) {
  const u = 1 - t
  return {
    p1: { x: u * P0.x + t * P1.x, y: u * P0.y + t * P1.y },
    p2: quadPoint(t),
  }
}

function softBob(now: number, flying: boolean) {
  if (!flying) return { dx: 0, dy: 0, tilt: 0 }
  /** Slow up / down weave (SVG +y is down) — gentle, not jittery */
  const dy =
    Math.sin(now * 0.0011) * 2.2 +
    Math.sin(now * 0.0007) * 1.3
  return {
    dx: Math.sin(now * 0.0009) * 0.35,
    dy,
    tilt: Math.sin(now * 0.001) * 1.2 + Math.sin(now * 0.0006) * 0.6,
  }
}

const seedHistory = [1.31, 1.13, 7.3, 6.11, 1.96, 1.0, 1.75, 1.33, 1.08, 1.05, 6.92, 1.3]
let history = [...seedHistory]
let balance = 5000
let phase: Phase = 'waiting'
let phaseStarted = performance.now()
let flightStart = 0
let crashPoint = 2
let lastProgress = 0
let lastPose = { x: 0, y: BOTTOM_Y, angle: 0, nx: 1, ny: 0 }
let flyAway: { x: number; y: number; angle: number; nx: number; ny: number; started: number } | null =
  null
let currentMult = 1
let activeTab: Tab = 'all'
let liveBets: LiveBet[] = []
let previousBets: LiveBet[] = []
let topWins: LiveBet[] = []
let liveBetTarget = 60
let lastTrickleAt = 0
/** Server round id — crash point comes from Django */
let serverRoundId: string | null = null
let apiReady = false
let growthRate = GROWTH
let waitMs = WAIT_MS

const panels: BetPanel[] = [
  {
    amount: 20,
    mode: 'bet',
    autoCashout: 2,
    autoEnabled: false,
    pending: false,
    active: false,
    cashed: false,
    cashMult: 0,
  },
]

const app = document.querySelector<HTMLDivElement>('#app')!

function panelHtml(i: number) {
  const p = panels[i]
  return `
  <div class="bet-panel" data-panel="${i}">
    <div class="bet-panel-header">
      <div class="mode-toggle" data-panel="${i}">
        <button type="button" class="${p.mode === 'bet' ? 'active' : ''}" data-mode="bet">Bet</button>
        <button type="button" class="${p.mode === 'auto' ? 'active' : ''}" data-mode="auto">Auto</button>
      </div>
    </div>
    <div class="bet-row">
      <div class="amount-controls">
        <div class="amount-stepper">
          <button type="button" class="step-btn" data-delta="-1">−</button>
          <input class="amount-input" type="text" value="${formatMoney(p.amount)}" inputmode="decimal" />
          <button type="button" class="step-btn" data-delta="1">+</button>
        </div>
        <div class="presets">
          <button type="button" data-preset="100">100</button>
          <button type="button" data-preset="200">200</button>
          <button type="button" data-preset="500">500</button>
          <button type="button" data-preset="1000">1,000</button>
        </div>
        <div class="auto-cashout-row ${p.mode === 'auto' ? '' : 'hidden'}">
          <label>Auto Cash Out</label>
          <input class="auto-cashout-input" type="text" value="${formatMoney(p.autoCashout)}" />
          <button type="button" class="auto-toggle ${p.autoEnabled ? 'on' : ''}" data-auto-toggle>Off</button>
        </div>
      </div>
      <button type="button" class="bet-action" data-action>
        <span class="action-label">Bet</span>
        <small class="action-sub">${formatMoney(p.amount)} ${CURRENCY}</small>
      </button>
    </div>
  </div>`
}

app.innerHTML = `
<header class="header">
  <div class="logo">Aviator</div>
  <div class="header-right">
    <span class="balance" id="balance">${formatMoney(balance)} ${CURRENCY}</span>
    <button type="button" class="menu-btn" aria-label="Menu"><span></span></button>
  </div>
</header>

<div class="history-wrap">
  <div class="history" id="history"></div>
  <button type="button" class="history-more" aria-label="More history">⋯</button>
</div>

<div class="stage-wrap" id="stageWrap">
  <div class="stage-bg"></div>
  <svg class="flight-svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id="trailGradient" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" style="stop-color:#e61e26;stop-opacity:0.92" />
        <stop offset="45%" style="stop-color:#b8141c;stop-opacity:0.82" />
        <stop offset="100%" style="stop-color:#5c0a10;stop-opacity:0.65" />
      </linearGradient>
    </defs>
    <path id="trailFill" class="trail-fill" d="" />
    <path id="trailLine" class="trail-line" d="" />
  </svg>
  <img
    id="planeFly"
    class="plane-fly"
    src="${ASSET}plane.png"
    alt=""
    width="${PLANE_CSS_W}"
    height="${Math.round(PLANE_CSS_W * 0.55)}"
    draggable="false"
  />
  <div class="multiplier-layer">
    <div class="status-line" id="statusLine">Waiting for next round</div>
    <div class="multiplier-value" id="multiplierDisplay">1.00x</div>
    <div class="wait-bar" id="waitBar"><div class="wait-bar-fill" id="waitFill"></div></div>
  </div>
  <div class="players-badge">
    <div class="avatar-stack">
      <span class="av"></span><span class="av"></span><span class="av"></span>
    </div>
    <span class="player-count" id="playerCount">1,240</span>
  </div>
</div>

<div class="bet-panels">
  ${panelHtml(0)}
</div>

<nav class="footer-tabs">
  <button type="button" class="active" data-tab="all">All Bets</button>
  <button type="button" data-tab="prev">Previous</button>
  <button type="button" data-tab="top">Top</button>
</nav>
<div class="bets-list" id="betsList"></div>
<p class="demo-note">Demo play money only — not connected to any casino.</p>
`

const historyEl = document.getElementById('history')!
const multiplierDisplay = document.getElementById('multiplierDisplay')!
const statusLine = document.getElementById('statusLine')!
const waitBar = document.getElementById('waitBar')!
const waitFill = document.getElementById('waitFill')!
const trailFill = document.querySelector('#trailFill') as SVGPathElement
const trailLine = document.querySelector('#trailLine') as SVGPathElement
const planeFly = document.getElementById('planeFly') as HTMLImageElement
const stageWrap = document.getElementById('stageWrap')!
const playerCountEl = document.getElementById('playerCount')!
const balanceEl = document.getElementById('balance')!
const betsListEl = document.getElementById('betsList')!

function renderHistory() {
  historyEl.innerHTML = history
    .slice(-14)
    .reverse()
    .map((m) => `<span class="history-pill ${multiplierColorClass(m)}">${formatMult(m)}</span>`)
    .join('')
}

function renderBalance() {
  balanceEl.textContent = `${formatMoney(balance)} ${CURRENCY}`
}

function renderBetsList() {
  let rows: LiveBet[] = []
  if (activeTab === 'all') rows = liveBets
  else if (activeTab === 'prev') rows = previousBets
  else rows = topWins

  const totalAmt = rows.reduce((s, b) => s + b.amount, 0)
  const cashed = rows.filter((b) => b.win != null && b.win > 0).length
  const allBtn = document.querySelector('.footer-tabs [data-tab="all"]') as HTMLButtonElement | null
  if (allBtn && activeTab === 'all') {
    allBtn.textContent = `All Bets ${rows.length || ''}`
  } else if (allBtn) {
    allBtn.textContent = 'All Bets'
  }

  if (!rows.length) {
    betsListEl.innerHTML = `<div class="bets-empty">Waiting for players…</div>`
    return
  }

  betsListEl.innerHTML = `
    <div class="bets-summary">
      <span><strong>${rows.length}</strong> players</span>
      <span>${formatMoney(totalAmt)} ${CURRENCY}</span>
      ${activeTab === 'all' && cashed ? `<span class="bets-cashed">${cashed} cashed out</span>` : ''}
    </div>
    <div class="bets-head">
      <span>Player</span><span>Bet</span><span>X</span><span>Win</span>
    </div>
    ${rows
      .slice(0, 80)
      .map(
        (b) => `
      <div class="bets-row ${b.win && b.win > 0 ? 'won' : ''}">
        <span class="bets-name">${betsAvatarHtml(b.name)}${b.name}</span>
        <span>${formatMoney(b.amount)}</span>
        <span class="${b.cashout != null ? 'bets-x' : ''}">${b.cashout != null ? formatMult(b.cashout) : '—'}</span>
        <span class="bets-win">${b.win != null && b.win > 0 ? formatMoney(b.win) : '—'}</span>
      </div>`
      )
      .join('')}`
}

function updatePanelUI(i: number) {
  const panel = document.querySelector(`.bet-panel[data-panel="${i}"]`) as HTMLElement
  const p = panels[i]
  if (!panel || !p) return
  const action = panel.querySelector('[data-action]') as HTMLButtonElement
  const label = action.querySelector('.action-label') as HTMLElement
  const sub = action.querySelector('.action-sub') as HTMLElement
  const autoRow = panel.querySelector('.auto-cashout-row') as HTMLElement
  const autoToggle = panel.querySelector('[data-auto-toggle]') as HTMLButtonElement

  autoRow.classList.toggle('hidden', p.mode !== 'auto')
  autoToggle.classList.toggle('on', p.autoEnabled)
  autoToggle.textContent = p.autoEnabled ? 'On' : 'Off'

  action.classList.remove('cashout', 'waiting', 'disabled')

  if (phase === 'flying' && p.active && !p.cashed) {
    action.classList.add('cashout')
    label.textContent = 'Cash Out'
    sub.textContent = `${formatMoney(p.amount * currentMult)} ${CURRENCY}`
  } else if (p.pending) {
    action.classList.add('waiting')
    label.textContent = 'Cancel'
    sub.textContent = `${formatMoney(p.amount)} ${CURRENCY}`
  } else if (p.cashed) {
    action.classList.add('disabled')
    label.textContent = 'Cashed'
    sub.textContent = `${formatMult(p.cashMult)}`
  } else if (phase === 'flying' || phase === 'crashed') {
    action.classList.add('waiting')
    label.textContent = 'Bet'
    sub.textContent = `${formatMoney(p.amount)} ${CURRENCY}`
  } else {
    label.textContent = 'Bet'
    sub.textContent = `${formatMoney(p.amount)} ${CURRENCY}`
  }
}

function updateAllPanels() {
  for (let i = 0; i < panels.length; i++) updatePanelUI(i)
}

function placePlane(px: number, py: number, angle: number, opacity = 1) {
  planeFly.style.left = `${(px / VIEW_W) * 100}%`
  planeFly.style.top = `${(py / VIEW_H) * 100}%`
  planeFly.style.opacity = String(opacity)
  planeFly.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`
}

function freezeTrail(progress: number, tipX: number, tipY: number) {
  const t = Math.max(0.004, Math.min(1, progress))
  const { p1 } = quadLeftSplit(t)
  trailFill.setAttribute(
    'd',
    `M ${P0.x} ${BOTTOM_Y} L ${P0.x} ${P0.y} Q ${p1.x} ${p1.y} ${tipX} ${tipY} L ${tipX} ${BOTTOM_Y} Z`
  )
  trailLine.setAttribute('d', `M ${P0.x} ${P0.y} Q ${p1.x} ${p1.y} ${tipX} ${tipY}`)
}

function clearTrail() {
  trailFill.setAttribute('d', '')
  trailLine.setAttribute('d', '')
}

function setPlane(progress: number, now: number, flying: boolean) {
  const t = Math.max(0, Math.min(1, progress))
  const p = quadPoint(t)
  const tan = quadTangent(t)
  const bob = softBob(now, flying)
  const pathWave = flying ? Math.sin(t * Math.PI * 1.15) * 1.2 * Math.min(1, t * 2.5) : 0
  const len = Math.hypot(tan.x, tan.y) || 1
  const nx = tan.x / len
  const ny = tan.y / len
  /**
   * From 2.5x, slight back pull only — still lets the plane reach the far side.
   */
  let backPull = 0
  if (flying && currentMult > 2.5) {
    const over = Math.min(1, Math.log(currentMult / 2.5) / Math.log(10))
    backPull = over * 2.2
  }
  let px = p.x + bob.dx - nx * backPull
  let py = p.y + bob.dy + pathWave - ny * backPull

  const stageW = Math.max(stageWrap.clientWidth, 1)
  const stageH = Math.max(stageWrap.clientHeight, 1)
  const planeViewW = (PLANE_CSS_W / stageW) * VIEW_W
  const planeViewH = ((PLANE_CSS_W * 0.55) / stageH) * VIEW_H
  /**
   * Allow travel to the end of the stage; only keep a thin margin so the
   * full plane (not 3/4) stays visible against overflow:hidden.
   */
  const marginX = planeViewW * 0.48
  const marginY = planeViewH * 0.48
  px = Math.min(VIEW_W - marginX, Math.max(marginX * 0.2, px))
  py = Math.min(VIEW_H - marginY * 0.35, Math.max(marginY * 0.4, py))
  py = Math.min(BOTTOM_Y - 1.5, py)

  let bx = ny
  let by = -nx
  if (by < 0) {
    bx = -bx
    by = -by
  }

  const back = planeViewW * 0.28
  const belly = planeViewH * 0.08
  const tipX = px - nx * back + bx * belly
  const tipY = py - ny * back + by * belly

  const pathAngle = (Math.atan2(tan.y, tan.x) * 180) / Math.PI
  const desiredUp = Math.min(20, Math.max(8, -pathAngle * 0.42))
  const angle = PLANE_ART_TILT - desiredUp + bob.tilt * 0.2

  if (t >= 0.004) {
    freezeTrail(t, tipX, tipY)
  } else {
    clearTrail()
  }

  lastPose = { x: px, y: py, angle, nx, ny }
  placePlane(px, py, angle, 1)
}

/** Bust: plane keeps going and exits the stage (4rabet “Flew Away”) */
function updateFlyAway(now: number) {
  if (!flyAway) return
  const elapsed = now - flyAway.started
  const u = Math.min(1, elapsed / FLY_AWAY_MS)
  /** Ease-out acceleration off the top-right */
  const dist = (8 + u * u * 95) * u
  const lift = u * u * 28
  const x = flyAway.x + flyAway.nx * dist * 1.15 + u * 12
  const y = flyAway.y + flyAway.ny * dist - lift
  const angle = flyAway.angle - u * 8
  const opacity = u > 0.55 ? Math.max(0, 1 - (u - 0.55) / 0.45) : 1
  placePlane(x, y, angle, opacity)
}

function spawnLiveBets() {
  liveBetTarget = 55 + Math.floor(Math.random() * 50)
  const seed = 22 + Math.floor(Math.random() * 16)
  liveBets = Array.from({ length: seed }, () => randomLiveBet())
  lastTrickleAt = performance.now()
  renderBetsList()
}

/** Keep adding fake players during wait — same “busy room” feel as Spribe/4rabet */
function trickleLiveBets(now: number) {
  if (liveBets.length >= liveBetTarget) return
  if (now - lastTrickleAt < 140 + Math.random() * 220) return
  lastTrickleAt = now
  const n = 1 + Math.floor(Math.random() * 3)
  for (let i = 0; i < n && liveBets.length < liveBetTarget; i++) {
    liveBets.unshift(randomLiveBet())
  }
  // Cap visible feed length like the real game
  if (liveBets.length > 120) liveBets.length = 120
  if (activeTab === 'all') renderBetsList()
  playerCountEl.textContent = String(liveBets.length + 800 + Math.floor(Math.random() * 400)).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ','
  )
}

function simulateBotCashouts(mult: number) {
  let changed = false
  for (const b of liveBets) {
    if (b.cashout != null) continue
    const target = 1.05 + Math.random() * Math.min(mult * 0.9, 12)
    if (mult >= target && Math.random() < 0.1) {
      b.cashout = round2(Math.min(target, mult))
      b.win = round2(b.amount * b.cashout)
      changed = true
    }
  }
  if (changed && activeTab === 'all') {
    // Winners bubble toward the top of the feed
    liveBets.sort((a, b) => {
      const aw = a.win && a.win > 0 ? 1 : 0
      const bw = b.win && b.win > 0 ? 1 : 0
      if (aw !== bw) return bw - aw
      return 0
    })
    renderBetsList()
  }
}

function finalizeRoundBets() {
  for (const b of liveBets) {
    if (b.cashout == null) {
      b.cashout = null
      b.win = 0
    }
  }
  previousBets = liveBets
    .filter((b) => b.win != null)
    .sort((a, b) => (b.win ?? 0) - (a.win ?? 0))
    .slice(0, 30)

  for (const b of liveBets) {
    if (b.win && b.win > 0) {
      topWins.push({ ...b })
    }
  }
  topWins = topWins
    .sort((a, b) => (b.win ?? 0) - (a.win ?? 0))
    .slice(0, 40)

  // Lose uncashed player stakes (already deducted on bet)
  for (const p of panels) {
    if (p.active && !p.cashed) {
      p.active = false
    }
  }
  renderBetsList()
}

function applyPlayerBalance(balanceStr: string, currency?: string) {
  balance = round2(Number(balanceStr))
  if (currency) {
    // currency kept in CURRENCY constant for labels; balance is source of truth
  }
  renderBalance()
}

function applyHistory(list: number[]) {
  if (list.length) {
    history = list.slice().reverse()
    renderHistory()
  }
}

async function initFromServer() {
  try {
    const data = await api.bootstrap()
    applyPlayerBalance(data.player.balance, data.player.currency)
    applyHistory(data.history)
    serverRoundId = data.round.id
    waitMs = data.round.wait_ms || WAIT_MS
    growthRate = data.round.growth || GROWTH
    apiReady = true
  } catch (err) {
    console.warn('API offline — running local demo mode', err)
    apiReady = false
  }
}

function placeBet(i: number) {
  const p = panels[i]
  if (phase !== 'waiting') return

  if (apiReady) {
    void (async () => {
      try {
        const auto = p.mode === 'auto' && p.autoEnabled ? p.autoCashout : undefined
        const data = await api.placeBet(i, p.amount, auto)
        applyPlayerBalance(data.player.balance)
        if (data.bet.status === 'cancelled') {
          p.pending = false
          p.active = false
        } else if (data.bet.status === 'pending') {
          p.pending = true
          p.cashed = false
          p.active = false
          p.cashMult = 0
        }
        updatePanelUI(i)
      } catch (err) {
        console.warn(err)
      }
    })()
    return
  }

  if (p.pending) {
    balance = round2(balance + p.amount)
    p.pending = false
    renderBalance()
    updatePanelUI(i)
    return
  }
  if (balance < p.amount) return
  balance = round2(balance - p.amount)
  p.pending = true
  p.cashed = false
  p.active = false
  p.cashMult = 0
  renderBalance()
  updatePanelUI(i)
}

function cashOut(i: number) {
  const p = panels[i]
  if (!(phase === 'flying' && p.active && !p.cashed)) return

  if (apiReady) {
    const mult = round2(currentMult)
    void (async () => {
      try {
        const data = await api.cashOut(i, mult)
        applyPlayerBalance(data.player.balance)
        p.cashed = true
        p.active = false
        p.cashMult = Number(data.bet.cashout_mult ?? mult)
        updatePanelUI(i)
      } catch (err) {
        console.warn(err)
      }
    })()
    return
  }

  p.cashed = true
  p.active = false
  p.cashMult = round2(currentMult)
  const win = round2(p.amount * p.cashMult)
  balance = round2(balance + win)
  renderBalance()
  updatePanelUI(i)
}

function onAction(i: number) {
  const p = panels[i]
  if (phase === 'flying' && p.active && !p.cashed) {
    cashOut(i)
    return
  }
  if (phase === 'waiting') {
    placeBet(i)
  }
}

function lockPendingBets() {
  for (const p of panels) {
    if (p.pending) {
      p.pending = false
      p.active = true
      p.cashed = false
      p.cashMult = 0
    }
  }
  updateAllPanels()
}

function checkAutoCashouts() {
  for (let i = 0; i < panels.length; i++) {
    const p = panels[i]
    if (
      p.mode === 'auto' &&
      p.autoEnabled &&
      p.active &&
      !p.cashed &&
      currentMult >= p.autoCashout
    ) {
      cashOut(i)
    }
  }
}

function wirePanel(i: number) {
  const panel = document.querySelector(`.bet-panel[data-panel="${i}"]`) as HTMLElement
  const p = panels[i]

  panel.querySelectorAll('.mode-toggle button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = (btn as HTMLElement).dataset.mode as 'bet' | 'auto'
      p.mode = mode
      panel.querySelectorAll('.mode-toggle button').forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')
      updatePanelUI(i)
    })
  })

  panel.querySelectorAll('.step-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (p.pending || p.active) return
      const delta = Number((btn as HTMLElement).dataset.delta)
      const step = p.amount >= 500 ? 100 : p.amount >= 100 ? 50 : 10
      p.amount = Math.min(MAX_BET, Math.max(MIN_BET, round2(p.amount + delta * step)))
      ;(panel.querySelector('.amount-input') as HTMLInputElement).value = formatMoney(p.amount)
      updatePanelUI(i)
    })
  })

  panel.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (p.pending || p.active) return
      p.amount = Number((btn as HTMLElement).dataset.preset)
      ;(panel.querySelector('.amount-input') as HTMLInputElement).value = formatMoney(p.amount)
      updatePanelUI(i)
    })
  })

  const amountInput = panel.querySelector('.amount-input') as HTMLInputElement
  amountInput.addEventListener('change', () => {
    if (p.pending || p.active) {
      amountInput.value = formatMoney(p.amount)
      return
    }
    const v = Number(amountInput.value.replace(/,/g, ''))
    if (!Number.isFinite(v)) {
      amountInput.value = formatMoney(p.amount)
      return
    }
    p.amount = Math.min(MAX_BET, Math.max(MIN_BET, round2(v)))
    amountInput.value = formatMoney(p.amount)
    updatePanelUI(i)
  })

  const autoInput = panel.querySelector('.auto-cashout-input') as HTMLInputElement
  autoInput.addEventListener('change', () => {
    const v = Number(autoInput.value)
    p.autoCashout = Number.isFinite(v) ? Math.max(1.01, round2(v)) : 2
    autoInput.value = formatMoney(p.autoCashout)
  })

  panel.querySelector('[data-auto-toggle]')!.addEventListener('click', () => {
    p.autoEnabled = !p.autoEnabled
    updatePanelUI(i)
  })

  panel.querySelector('[data-action]')!.addEventListener('click', () => onAction(i))
}

document.querySelectorAll('.footer-tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.footer-tabs button').forEach((b) => b.classList.remove('active'))
    btn.classList.add('active')
    activeTab = (btn as HTMLElement).dataset.tab as Tab
    renderBetsList()
  })
})

wirePanel(0)
renderHistory()
renderBalance()
spawnLiveBets()
updateAllPanels()

function beginWaiting(now: number) {
  phase = 'waiting'
  phaseStarted = now
  currentMult = 1
  flyAway = null
  clearTrail()
  waitBar.classList.remove('hidden')
  statusLine.classList.remove('hidden')
  statusLine.textContent = 'Waiting for next round'
  stopNode(noiseNode)
  noiseNode = null
  multiplierDisplay.classList.remove('crashed')
  multiplierDisplay.textContent = '1.00x'
  placePlane(P0.x, P0.y, PLANE_ART_TILT - 10, 1)
  setPlane(0, now, false)
  spawnLiveBets()

  if (apiReady) {
    void (async () => {
      try {
        const data = await api.newRound()
        serverRoundId = data.round.id
        waitMs = data.round.wait_ms || WAIT_MS
        growthRate = data.round.growth || GROWTH
        applyPlayerBalance(data.player.balance)
        applyHistory(data.history)
      } catch (err) {
        console.warn(err)
      }
    })()
  }

  for (let i = 0; i < panels.length; i++) {
    const p = panels[i]
    p.cashed = false
    p.active = false
    p.cashMult = 0
    if (!apiReady && p.mode === 'auto' && p.autoEnabled && !p.pending && balance >= p.amount) {
      balance = round2(balance - p.amount)
      p.pending = true
    }
  }
  renderBalance()
  updateAllPanels()
}

function beginFlying(now: number) {
  flightStart = now
  phase = 'flying'
  flyAway = null
  waitBar.classList.add('hidden')
  statusLine.classList.add('hidden')
  multiplierDisplay.classList.remove('crashed')
  planeFly.style.opacity = '1'
  startFlyingSound()
  /** Hold crash until server crash_point arrives */
  crashPoint = 99999

  if (apiReady && serverRoundId) {
    const heldRound = serverRoundId
    const safety = window.setTimeout(() => {
      if (phase === 'flying' && crashPoint >= 99999) {
        crashPoint = sampleCrashPoint()
        if (crashPoint < 1.01) crashPoint = 1.0
        lockPendingBets()
        updateAllPanels()
      }
    }, 3500)
    void (async () => {
      try {
        const data = await api.startRound(heldRound)
        window.clearTimeout(safety)
        serverRoundId = data.round.id
        crashPoint = Number(data.round.crash_point)
        if (!(crashPoint >= 1)) crashPoint = sampleCrashPoint()
        growthRate = data.round.growth || GROWTH
        applyPlayerBalance(data.player.balance)
        for (const b of data.bets) {
          if (b.status === 'active' || b.status === 'pending') {
            const p = panels[b.panel]
            if (p) {
              p.pending = false
              p.active = true
              p.amount = Number(b.amount)
              p.cashed = false
              p.cashMult = 0
            }
          }
        }
        lockPendingBets()
        updateAllPanels()
      } catch (err) {
        window.clearTimeout(safety)
        console.warn(err)
        crashPoint = sampleCrashPoint()
        if (crashPoint < 1.01) crashPoint = 1.0
        lockPendingBets()
        updateAllPanels()
      }
    })()
    return
  }

  crashPoint = sampleCrashPoint()
  if (crashPoint < 1.01) crashPoint = 1.0
  lockPendingBets()
}

function beginCrash(now: number) {
  phase = 'crashed'
  phaseStarted = now
  currentMult = crashPoint
  lastProgress = progressFromElapsed((now - flightStart) / 1000)
  setPlane(lastProgress, now, false)
  flyAway = {
    x: lastPose.x,
    y: lastPose.y,
    angle: lastPose.angle,
    nx: lastPose.nx,
    ny: lastPose.ny,
    started: now,
  }
  history = [...history, crashPoint].slice(-30)
  renderHistory()
  multiplierDisplay.textContent = formatMult(crashPoint)
  multiplierDisplay.classList.add('crashed')
  statusLine.textContent = 'Flew Away!'
  statusLine.classList.remove('hidden')
  startFlyAwaySound()
  finalizeRoundBets()
  updateAllPanels()

  if (apiReady && serverRoundId) {
    void (async () => {
      try {
        const data = await api.crashRound(serverRoundId!)
        applyPlayerBalance(data.player.balance)
        applyHistory(data.history)
      } catch (err) {
        console.warn(err)
      }
    })()
  }
}

function loop(now: number) {
  try {
    if (phase === 'waiting') {
      const elapsed = now - phaseStarted
      const u = Math.min(1, elapsed / Math.max(1, waitMs))
      waitFill.style.width = `${(1 - u) * 100}%`
      statusLine.textContent = `Waiting for next round`
      setPlane(0, now, false)
      trickleLiveBets(now)

      if (elapsed >= waitMs) {
        beginFlying(now)
      }
    } else if (phase === 'flying') {
      const elapsedSec = (now - flightStart) / 1000
      currentMult = multFromElapsed(elapsedSec)

      if (currentMult >= crashPoint) {
        currentMult = crashPoint
        beginCrash(now)
      } else {
        lastProgress = progressFromElapsed(elapsedSec)
        multiplierDisplay.textContent = formatMult(currentMult)
        setPlane(lastProgress, now, true)
        checkAutoCashouts()
        simulateBotCashouts(currentMult)
        updateAllPanels()
        playerCountEl.textContent = String(
          1200 + Math.floor(lastProgress * 800) + Math.floor((now / 300) % 80)
        )
      }
    } else if (phase === 'crashed') {
      updateFlyAway(now)
      if (now - phaseStarted >= CRASH_HOLD_MS) {
        beginWaiting(now)
      }
    }
  } catch (err) {
    console.warn('tick error', err)
  }
}

function startGameLoop() {
  if ((window as unknown as { __aviatorLoop?: number }).__aviatorLoop) return
  ;(window as unknown as { __aviatorLoop?: number }).__aviatorLoop = window.setInterval(() => {
    loop(performance.now())
  }, 50)
}

void (async () => {
  try {
    await initFromServer()
  } catch (err) {
    console.warn(err)
  }
  try {
    beginWaiting(performance.now())
  } catch (err) {
    console.warn('beginWaiting failed', err)
  }
  startGameLoop()
})()
