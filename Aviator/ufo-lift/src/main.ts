import { installCasinoBack } from './casinoBack'
installCasinoBack('ufo-lift')
import './style.css'
import * as api from './api'

const ASSET = import.meta.env.BASE_URL
type Phase = 'waiting' | 'flying' | 'crashed'
type Tab = 'all' | 'prev' | 'top'

interface BetPanel {
  amount: number
  mode: 'bet' | 'auto'
  autoCashout: number
  autoEnabled: boolean
  pending: boolean
  active: boolean
  cashed: boolean
  cashMult: number
  remaining: number
}

interface LiveBet {
  name: string
  amount: number
  cashout: number | null
  win: number | null
}

const WAIT_MS = 5000
const CRASH_HOLD_MS = 3000
const FLY_AWAY_MS = 1100
const GROWTH = 0.057
const MIN_BET = 10
const MAX_BET = 10000
const CURRENCY = 'INR'
const VIEW_W = 100
const VIEW_H = 100

const NAMES = [
  'z***4', 'k***r', 'm***9', 'n***x', 'a***7', 's***p', 'v***2', 'r***h',
  't***1', 'b***w', 'c***8', 'j***l', 'd***3', 'h***q',
]

function round2(n: number) {
  return Math.round(n * 100) / 100
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


function formatMoney(n: number) {
  return n.toFixed(2)
}

function formatMult(m: number) {
  return `${m.toFixed(2)}x`
}

function multiplierColorClass(m: number) {
  if (m < 2) return 'low'
  if (m < 10) return 'mid'
  if (m < 50) return 'high'
  return 'hot'
}

function sampleCrashPoint() {
  const r = Math.random()
  const e = 0.97
  const raw = Math.floor((100 * e) / (1 - r)) / 100
  return Math.max(1.0, Math.min(raw, 999.99))
}

function multFromElapsed(elapsedSec: number) {
  return Math.exp(growthRate * elapsedSec)
}

function progressFromElapsed(elapsedSec: number) {
  return Math.min(0.9, 1 - Math.exp(-elapsedSec * 0.145))
}

/** UFO Lift flight arc — desert night abduction climb */
const P0 = { x: 2, y: 82 }
const P1 = { x: 42, y: 70 }
const P2 = { x: 94, y: 14 }
const BOTTOM_Y = 100

function flightPoint(t: number) {
  const u = 1 - Math.max(0, Math.min(1, t))
  const s = 1 - u
  return {
    x: u * u * P0.x + 2 * u * s * P1.x + s * s * P2.x,
    y: u * u * P0.y + 2 * u * s * P1.y + s * s * P2.y,
  }
}

function flightTangent(t: number) {
  const clamped = Math.max(0, Math.min(1, t))
  const u = 1 - clamped
  const s = clamped
  return {
    x: 2 * u * (P1.x - P0.x) + 2 * s * (P2.x - P1.x),
    y: 2 * u * (P1.y - P0.y) + 2 * s * (P2.y - P1.y),
  }
}

function quadLeftSplit(t: number) {
  const clamped = Math.max(0, Math.min(1, t))
  const u = 1 - clamped
  const s = clamped
  return {
    p1: { x: u * P0.x + s * P1.x, y: u * P0.y + s * P1.y },
    p2: flightPoint(clamped),
  }
}

/** UFO hover — level saucer float (SVG +y is down) */
function softBob(now: number, flying: boolean) {
  if (!flying) return { dx: 0, dy: 0, tilt: 0 }
  const dy =
    Math.sin(now * 0.00135) * 1.8 +
    Math.sin(now * 0.0006) * 0.9
  return {
    dx: Math.sin(now * 0.00075) * 0.4,
    dy,
    tilt: Math.sin(now * 0.0009) * 1.4,
  }
}

const seedHistory = [2.04, 1.18, 5.6, 1.41, 3.77, 1.09, 14.2, 1.88, 2.65, 7.1]
let history = [...seedHistory]
let balance = 5000
let phase: Phase = 'waiting'
let phaseStarted = performance.now()
let flightStart = 0
let crashPoint = 2
let lastProgress = 0
let currentMult = 1
let activeTab: Tab = 'all'
let liveBets: LiveBet[] = []
let previousBets: LiveBet[] = []
let topWins: LiveBet[] = []
let lastPose = { x: 2, y: 82, angle: -12, nx: 0.5, ny: -0.85 }
let flyAway: { x: number; y: number; angle: number; nx: number; ny: number; started: number } | null =
  null
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
    remaining: 0,
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
    <div class="bet-body">
      <div class="amount-block">
        <div class="amount-row">
          <button type="button" data-step="-1">−</button>
          <input data-amount value="${formatMoney(p.amount)}" inputmode="decimal" />
          <button type="button" data-step="1">+</button>
        </div>
        <div class="presets">
          <button type="button" data-preset="10">10</button>
          <button type="button" data-preset="20">20</button>
          <button type="button" data-preset="50">50</button>
          <button type="button" data-preset="100">100</button>
        </div>
      </div>
      <div class="action-split" data-split>
        <button type="button" class="action-btn" data-action>
          <span data-label>Bet</span>
          <span class="sub" data-sub>${formatMoney(p.amount)} ${CURRENCY}</span>
        </button>
        <button type="button" class="half-btn" data-half disabled>50%</button>
      </div>
    </div>
    <div class="auto-row" data-auto-row style="${p.mode === 'auto' ? '' : 'display:none'}">
      <span>Auto Cash Out</span>
      <button type="button" class="auto-toggle" data-auto-toggle>Off</button>
      <input data-auto-mult value="${formatMoney(p.autoCashout)}" inputmode="decimal" />
    </div>
  </div>`
}

app.innerHTML = `
<header class="header">
  <div class="logo">UFO Lift</div>
  <span class="balance" id="balance">${formatMoney(balance)} ${CURRENCY}</span>
</header>

<div class="history-wrap">
  <div class="history" id="history"></div>
</div>

<div class="stage-wrap" id="stageWrap">
  <canvas id="skyCanvas" class="sky-canvas" aria-hidden="true"></canvas>
  <div class="stage-logo">UFO Lift</div>
  <svg class="flight-svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id="trailGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" style="stop-color:#4ade80;stop-opacity:0.28" />
        <stop offset="45%" style="stop-color:#22d3ee;stop-opacity:0.1" />
        <stop offset="100%" style="stop-color:#0b0614;stop-opacity:0.02" />
      </linearGradient>
      <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" style="stop-color:#22d3ee;stop-opacity:0.25" />
        <stop offset="55%" style="stop-color:#4ade80;stop-opacity:0.55" />
        <stop offset="100%" style="stop-color:#a855f7;stop-opacity:0.65" />
      </linearGradient>
    </defs>
    <path id="trailFill" class="trail-fill" d="" />
    <path id="trailLine" class="trail-line" d="" />
  </svg>
  <img id="jetFly" class="jet-fly" src="${ASSET}ufo.png" alt="" width="118" draggable="false" />
  <div class="multiplier-layer">
    <div class="status-line" id="statusLine">Scanning sector</div>
    <div class="multiplier-value" id="multiplierDisplay"></div>
    <div class="wait-bar" id="waitBar"><div class="wait-bar-fill" id="waitFill"></div></div>
  </div>
  <div class="players-badge">
    <div class="avatar-stack"><span class="av"></span><span class="av"></span><span class="av"></span></div>
    <span id="playerCount">1,108</span>
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
<p class="demo-note">UFO Lift demo — play money only. Same crash loop as Aviator / Jet.</p>
`

const historyEl = document.getElementById('history')!
const multiplierDisplay = document.getElementById('multiplierDisplay')!
const statusLine = document.getElementById('statusLine')!
const waitBar = document.getElementById('waitBar')!
const waitFill = document.getElementById('waitFill')!
const trailFill = document.querySelector('#trailFill') as SVGPathElement
const trailLine = document.querySelector('#trailLine') as SVGPathElement
const jetFly = document.getElementById('jetFly') as HTMLImageElement
const skyCanvas = document.getElementById('skyCanvas') as HTMLCanvasElement
const skyCtx = skyCanvas.getContext('2d')!
const playerCountEl = document.getElementById('playerCount')!
const balanceEl = document.getElementById('balance')!
const betsListEl = document.getElementById('betsList')!
const stageWrap = document.getElementById('stageWrap')!

interface SkyCloud {
  x: number
  y: number
  speed: number
  scale: number
  opacity: number
  bob: number
  bobSpeed: number
  kind: 0 | 1
  flip: boolean
  blur: number
  layer: 'far' | 'near'
}

interface Star {
  x: number
  y: number
  r: number
  phase: number
  speed: number
}

const skyClouds: SkyCloud[] = []
const stars: Star[] = []
let lastLoopNow = performance.now()
const cloudImgs: (HTMLImageElement | null)[] = [null, null]
let skyReady = false
const blurCache = new Map<string, HTMLCanvasElement>()

function loadSkyAssets() {
  let left = 2
  ;[`${ASSET}cloud-a.png`, `${ASSET}cloud-b.png`].forEach((src, i) => {
    const img = new Image()
    img.onload = () => {
      cloudImgs[i] = img
      left -= 1
      if (left === 0) {
        skyReady = true
        paintSky(performance.now())
      }
    }
    img.src = src
  })
}

function initStars() {
  stars.length = 0
  for (let i = 0; i < 56; i++) {
    stars.push({
      x: Math.random(),
      y: Math.random() * 0.72,
      r: 0.4 + Math.random() * 1.4,
      phase: Math.random() * Math.PI * 2,
      speed: 0.8 + Math.random() * 2.2,
    })
  }
}

function initSkyClouds() {
  skyClouds.length = 0
  const specs: Omit<SkyCloud, 'bob' | 'bobSpeed'>[] = [
    { x: -0.1, y: 0.12, speed: 0.02, scale: 0.55, opacity: 0.18, kind: 1, flip: false, blur: 4, layer: 'far' },
    { x: 0.48, y: 0.18, speed: 0.025, scale: 0.48, opacity: 0.14, kind: 0, flip: true, blur: 5, layer: 'far' },
    { x: 0.85, y: 0.1, speed: 0.018, scale: 0.4, opacity: 0.12, kind: 1, flip: false, blur: 3.5, layer: 'far' },
    { x: -0.2, y: 0.34, speed: 0.04, scale: 0.72, opacity: 0.22, kind: 0, flip: false, blur: 1, layer: 'near' },
    { x: 0.42, y: 0.4, speed: 0.048, scale: 0.6, opacity: 0.2, kind: 1, flip: true, blur: 1.5, layer: 'near' },
    { x: 0.8, y: 0.3, speed: 0.042, scale: 0.68, opacity: 0.24, kind: 0, flip: false, blur: 0.5, layer: 'near' },
  ]
  for (const s of specs) {
    skyClouds.push({
      ...s,
      bob: Math.random() * Math.PI * 2,
      bobSpeed: 0.18 + Math.random() * 0.25,
    })
  }
}

function getBlurredCloud(img: HTMLImageElement, blur: number): HTMLCanvasElement {
  const key = `${img.src}|${blur.toFixed(1)}`
  const hit = blurCache.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const ctx = c.getContext('2d')!
  if (blur > 0.2) ctx.filter = `blur(${blur}px)`
  ctx.drawImage(img, 0, 0)
  blurCache.set(key, c)
  return c
}

function resizeSkyCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = stageWrap.clientWidth
  const h = stageWrap.clientHeight
  skyCanvas.width = Math.max(1, Math.floor(w * dpr))
  skyCanvas.height = Math.max(1, Math.floor(h * dpr))
  skyCanvas.style.width = `${w}px`
  skyCanvas.style.height = `${h}px`
  skyCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function drawCloudSprite(c: SkyCloud, now: number, w: number, h: number) {
  const img = cloudImgs[c.kind]
  if (!img) return
  const bobY = Math.sin(now * 0.001 * c.bobSpeed + c.bob) * (c.layer === 'far' ? 2 : 3.5)
  const aspect = img.naturalHeight / Math.max(1, img.naturalWidth)
  const cw = w * 0.55 * c.scale
  const ch = cw * aspect
  const cx = c.x * w
  const cy = c.y * h + bobY
  skyCtx.save()
  skyCtx.globalAlpha = c.opacity
  skyCtx.translate(cx + cw / 2, cy + ch / 2)
  if (c.flip) skyCtx.scale(-1, 1)
  // Night tint — cool purple-gray clouds
  skyCtx.filter = 'brightness(0.35) saturate(0.4) hue-rotate(220deg)'
  const src = c.blur > 0.2 ? getBlurredCloud(img, c.blur) : img
  skyCtx.drawImage(src, -cw / 2, -ch / 2, cw, ch)
  skyCtx.restore()
}

function paintSky(now: number) {
  const w = stageWrap.clientWidth
  const h = stageWrap.clientHeight
  if (w < 2 || h < 2) return

  const sky = skyCtx.createLinearGradient(0, 0, 0, h)
  sky.addColorStop(0, '#0a0618')
  sky.addColorStop(0.35, '#12082a')
  sky.addColorStop(0.7, '#1a1020')
  sky.addColorStop(1, '#2a1a12')
  skyCtx.fillStyle = sky
  skyCtx.fillRect(0, 0, w, h)

  // Nebula washes
  const nebula = skyCtx.createRadialGradient(w * 0.72, h * 0.2, 4, w * 0.72, h * 0.2, w * 0.45)
  nebula.addColorStop(0, 'rgba(126, 58, 242, 0.28)')
  nebula.addColorStop(0.45, 'rgba(88, 28, 180, 0.1)')
  nebula.addColorStop(1, 'rgba(0,0,0,0)')
  skyCtx.fillStyle = nebula
  skyCtx.fillRect(0, 0, w, h)

  const nebula2 = skyCtx.createRadialGradient(w * 0.2, h * 0.35, 2, w * 0.2, h * 0.35, w * 0.35)
  nebula2.addColorStop(0, 'rgba(34, 211, 238, 0.1)')
  nebula2.addColorStop(1, 'rgba(0,0,0,0)')
  skyCtx.fillStyle = nebula2
  skyCtx.fillRect(0, 0, w, h)

  // Stars
  for (const s of stars) {
    const twinkle = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(now * 0.001 * s.speed + s.phase))
    skyCtx.beginPath()
    skyCtx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2)
    skyCtx.fillStyle = `rgba(255,255,255,${0.35 + twinkle * 0.55})`
    skyCtx.fill()
  }

  // Moon
  const mx = w * 0.78
  const my = h * 0.16
  const moonGlow = skyCtx.createRadialGradient(mx, my, 2, mx, my, 42)
  moonGlow.addColorStop(0, 'rgba(233, 213, 255, 0.55)')
  moonGlow.addColorStop(0.4, 'rgba(168, 85, 247, 0.12)')
  moonGlow.addColorStop(1, 'rgba(0,0,0,0)')
  skyCtx.fillStyle = moonGlow
  skyCtx.fillRect(mx - 48, my - 48, 96, 96)
  skyCtx.beginPath()
  skyCtx.arc(mx, my, 13, 0, Math.PI * 2)
  const moon = skyCtx.createRadialGradient(mx - 3, my - 3, 1, mx, my, 13)
  moon.addColorStop(0, '#f5e8ff')
  moon.addColorStop(1, '#c4b5fd')
  skyCtx.fillStyle = moon
  skyCtx.fill()

  if (skyReady) {
    for (const c of skyClouds) {
      if (c.layer === 'far') drawCloudSprite(c, now, w, h)
    }
    for (const c of skyClouds) {
      if (c.layer === 'near') drawCloudSprite(c, now, w, h)
    }
  }

  // Desert dunes
  const duneFar = skyCtx.createLinearGradient(0, h * 0.62, 0, h)
  duneFar.addColorStop(0, 'rgba(90, 55, 35, 0.45)')
  duneFar.addColorStop(1, 'rgba(55, 30, 18, 0.7)')
  skyCtx.fillStyle = duneFar
  skyCtx.beginPath()
  skyCtx.moveTo(0, h)
  skyCtx.lineTo(0, h * 0.78)
  skyCtx.bezierCurveTo(w * 0.18, h * 0.64, w * 0.35, h * 0.76, w * 0.52, h * 0.68)
  skyCtx.bezierCurveTo(w * 0.7, h * 0.6, w * 0.88, h * 0.74, w, h * 0.7)
  skyCtx.lineTo(w, h)
  skyCtx.closePath()
  skyCtx.fill()

  const duneNear = skyCtx.createLinearGradient(0, h * 0.78, 0, h)
  duneNear.addColorStop(0, 'rgba(70, 40, 22, 0.75)')
  duneNear.addColorStop(1, 'rgba(35, 18, 12, 0.95)')
  skyCtx.fillStyle = duneNear
  skyCtx.beginPath()
  skyCtx.moveTo(0, h)
  skyCtx.lineTo(0, h * 0.9)
  skyCtx.bezierCurveTo(w * 0.22, h * 0.84, w * 0.4, h * 0.94, w * 0.58, h * 0.86)
  skyCtx.bezierCurveTo(w * 0.78, h * 0.8, w * 0.92, h * 0.9, w, h * 0.86)
  skyCtx.lineTo(w, h)
  skyCtx.closePath()
  skyCtx.fill()

  // Alien ground glow
  const glow = skyCtx.createRadialGradient(w * 0.45, h * 0.92, 4, w * 0.45, h * 0.92, w * 0.55)
  glow.addColorStop(0, 'rgba(74, 222, 128, 0.18)')
  glow.addColorStop(0.5, 'rgba(74, 222, 128, 0.05)')
  glow.addColorStop(1, 'rgba(0,0,0,0)')
  skyCtx.fillStyle = glow
  skyCtx.fillRect(0, h * 0.55, w, h * 0.45)
}

function updateSkyClouds(dt: number) {
  for (const c of skyClouds) {
    c.x += c.speed * dt
    if (c.x > 1.2) {
      c.x = -0.55 - Math.random() * 0.2
      c.y = c.layer === 'far' ? 0.08 + Math.random() * 0.14 : 0.28 + Math.random() * 0.2
    }
  }
}

initStars()
initSkyClouds()
loadSkyAssets()
resizeSkyCanvas()
window.addEventListener('resize', () => {
  resizeSkyCanvas()
  paintSky(performance.now())
})

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

  if (!rows.length) {
    betsListEl.innerHTML = `<div class="bets-empty">No bets yet</div>`
    return
  }

  betsListEl.innerHTML = `
    <div class="bets-head"><span>User</span><span>Bet</span><span>x</span><span>Win</span></div>
    ${rows
      .slice(0, 24)
      .map(
        (b) => `<div class="bets-row${b.win != null ? ' won' : ''}">
      <span class="bets-name">${betsAvatarHtml(b.name)}${b.name}</span>
      <span>${formatMoney(b.amount)}</span>
      <span>${b.cashout != null ? formatMult(b.cashout) : '—'}</span>
      <span>${b.win != null ? formatMoney(b.win) : '—'}</span>
    </div>`
      )
      .join('')}
  `
}

function updatePanelUI(i: number) {
  const p = panels[i]
  const panel = document.querySelector(`.bet-panel[data-panel="${i}"]`) as HTMLElement
  const action = panel.querySelector('[data-action]') as HTMLButtonElement
  const label = panel.querySelector('[data-label]') as HTMLElement
  const sub = panel.querySelector('[data-sub]') as HTMLElement
  const half = panel.querySelector('[data-half]') as HTMLButtonElement
  const split = panel.querySelector('[data-split]') as HTMLElement
  const autoRow = panel.querySelector('[data-auto-row]') as HTMLElement
  const autoToggle = panel.querySelector('[data-auto-toggle]') as HTMLButtonElement

  autoRow.style.display = p.mode === 'auto' ? '' : 'none'
  autoToggle.textContent = p.autoEnabled ? 'On' : 'Off'
  autoToggle.classList.toggle('on', p.autoEnabled)

  action.className = 'action-btn'
  half.disabled = true
  split.classList.remove('is-cashout')

  if (phase === 'flying' && p.active && !p.cashed) {
    action.classList.add('cashout')
    split.classList.add('is-cashout')
    label.textContent = 'Cashout'
    sub.textContent = `${formatMoney(p.remaining * currentMult)} ${CURRENCY}`
    half.disabled = p.remaining < p.amount * 0.5
  } else if (p.pending) {
    action.classList.add('pending')
    label.textContent = 'Cancel'
    sub.textContent = `${formatMoney(p.amount)} ${CURRENCY}`
  } else if (p.cashed) {
    action.classList.add('disabled')
    label.textContent = 'Cashed'
    sub.textContent = formatMult(p.cashMult)
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

function placeJet(x: number, y: number, angle: number, opacity = 1, waiting = false) {
  jetFly.classList.toggle('waiting', waiting)
  jetFly.style.left = `${(x / VIEW_W) * 100}%`
  jetFly.style.top = `${(y / VIEW_H) * 100}%`
  jetFly.style.opacity = waiting ? '0' : String(opacity)
  jetFly.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`
}

function placeWaitJet(remaining: number) {
  const barW = 42
  const tipX = 50 - barW / 2 + barW * Math.max(0.08, Math.min(1, remaining))
  placeJet(tipX, 58.5, 0, 1, true)
}

function setJet(progress: number, now: number, flying: boolean) {
  const t = Math.max(0, Math.min(1, progress))
  const p = flightPoint(t)
  const tan = flightTangent(t)
  const bob = softBob(now, flying)
  const pathWave = flying ? Math.sin(t * Math.PI * 1.15) * 1.2 * Math.min(1, t * 2.5) : 0
  const len = Math.hypot(tan.x, tan.y) || 1
  const nx = tan.x / len
  const ny = tan.y / len
  let px = p.x + bob.dx
  let py = p.y + bob.dy + pathWave

  const stageW = Math.max(stageWrap.clientWidth, 1)
  const stageH = Math.max(stageWrap.clientHeight, 1)
  const marginX = (118 / stageW) * VIEW_W * 0.48
  const marginY = (46 / stageH) * VIEW_H * 0.48
  px = Math.min(VIEW_W - marginX, Math.max(marginX, px))
  py = Math.min(VIEW_H - marginY, Math.max(marginY, py))

  const tipX = px - nx * 6
  const tipY = py - ny * 6
  const lineTipX = px - nx * 1.1
  const lineTipY = py - ny * 1.1
  const pathAngle = (Math.atan2(tan.y, tan.x) * 180) / Math.PI
  // Saucers stay nearly level
  const angle = Math.max(-8, Math.min(6, pathAngle * 0.12 + bob.tilt * 0.35))

  if (t >= 0.008) {
    const { p1 } = quadLeftSplit(t)
    trailLine.setAttribute('d', `M ${P0.x} ${P0.y} Q ${p1.x} ${p1.y} ${lineTipX} ${lineTipY}`)
    trailFill.setAttribute(
      'd',
      `M ${P0.x} ${BOTTOM_Y} L ${P0.x} ${P0.y} Q ${p1.x} ${p1.y} ${tipX} ${tipY} L ${tipX} ${BOTTOM_Y} Z`
    )
  } else {
    trailLine.setAttribute('d', '')
    trailFill.setAttribute('d', '')
  }

  lastPose = { x: px, y: py, angle, nx, ny }
  placeJet(px, py, angle, 1, false)
  jetFly.classList.toggle('hovering', flying)
}

function updateFlyAway(now: number) {
  if (!flyAway) return
  const u = Math.min(1, (now - flyAway.started) / FLY_AWAY_MS)
  const dist = u * u * 70
  const x = flyAway.x + flyAway.nx * dist + u * 20
  const y = flyAway.y + flyAway.ny * dist - u * 32
  const opacity = u > 0.4 ? Math.max(0, 1 - (u - 0.4) / 0.6) : 1
  placeJet(x, y, flyAway.angle + Math.sin(u * 10) * 4, opacity, false)
  jetFly.classList.remove('hovering')
}

function spawnLiveBets() {
  const count = 40 + Math.floor(Math.random() * 40)
  liveBets = Array.from({ length: count }, () => ({
    name: NAMES[Math.floor(Math.random() * NAMES.length)],
    amount: [10, 20, 50, 100, 200, 500][Math.floor(Math.random() * 6)],
    cashout: null,
    win: null,
  }))
  renderBetsList()
}

function simulateBotCashouts(mult: number) {
  for (const b of liveBets) {
    if (b.cashout != null) continue
    const target = 1.05 + Math.random() * Math.min(mult * 0.9, 10)
    if (mult >= target && Math.random() < 0.07) {
      b.cashout = round2(Math.min(target, mult))
      b.win = round2(b.amount * b.cashout)
    }
  }
  if (activeTab === 'all') renderBetsList()
}

function finalizeRoundBets() {
  for (const b of liveBets) {
    if (b.cashout == null) b.win = 0
  }
  previousBets = liveBets
    .filter((b) => b.win != null)
    .sort((a, b) => (b.win ?? 0) - (a.win ?? 0))
    .slice(0, 60)
  for (const b of liveBets) {
    if (b.win && b.win > 0) topWins.push({ ...b })
  }
  topWins = topWins.sort((a, b) => (b.win ?? 0) - (a.win ?? 0)).slice(0, 80)
  for (const p of panels) {
    if (p.active && !p.cashed) p.active = false
  }
  renderBetsList()
}

function applyPlayerBalance(balanceStr: string) {
  balance = round2(Number(balanceStr))
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
    applyPlayerBalance(data.player.balance)
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
          p.remaining = 0
        } else if (data.bet.status === 'pending') {
          p.pending = true
          p.cashed = false
          p.active = false
          p.cashMult = 0
          p.remaining = p.amount
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
  p.remaining = p.amount
  renderBalance()
  updatePanelUI(i)
}

function cashOut(i: number, fraction = 1) {
  const p = panels[i]
  if (!(phase === 'flying' && p.active && !p.cashed)) return

  if (apiReady && fraction >= 1) {
    const mult = round2(currentMult)
    void (async () => {
      try {
        const data = await api.cashOut(i, mult)
        applyPlayerBalance(data.player.balance)
        p.cashed = true
        p.active = false
        p.remaining = 0
        p.cashMult = Number(data.bet.cashout_mult ?? mult)
        updatePanelUI(i)
      } catch (err) {
        console.warn(err)
      }
    })()
    return
  }

  const stake = round2(p.remaining * fraction)
  if (stake <= 0) return
  const win = round2(stake * currentMult)
  balance = round2(balance + win)
  p.remaining = round2(p.remaining - stake)
  p.cashMult = round2(currentMult)
  if (p.remaining <= 0.01 || fraction >= 1) {
    p.cashed = true
    p.active = false
    p.remaining = 0
  }
  renderBalance()
  updatePanelUI(i)
}

function lockPendingBets() {
  for (const p of panels) {
    if (p.pending) {
      p.pending = false
      p.active = true
      p.cashed = false
      p.cashMult = 0
      p.remaining = p.amount
    }
  }
  updateAllPanels()
}

function checkAutoCashouts() {
  for (let i = 0; i < panels.length; i++) {
    const p = panels[i]
    if (p.mode === 'auto' && p.autoEnabled && p.active && !p.cashed && currentMult >= p.autoCashout) {
      cashOut(i, 1)
    }
  }
}

function wirePanel(i: number) {
  const panel = document.querySelector(`.bet-panel[data-panel="${i}"]`) as HTMLElement
  const p = panels[i]

  panel.querySelectorAll('.mode-toggle button').forEach((btn) => {
    btn.addEventListener('click', () => {
      p.mode = (btn as HTMLElement).dataset.mode as 'bet' | 'auto'
      panel.querySelectorAll('.mode-toggle button').forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')
      updatePanelUI(i)
    })
  })

  panel.querySelectorAll('[data-step]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const step = Number((btn as HTMLElement).dataset.step)
      p.amount = Math.min(MAX_BET, Math.max(MIN_BET, round2(p.amount + step * 10)))
      ;(panel.querySelector('[data-amount]') as HTMLInputElement).value = formatMoney(p.amount)
      updatePanelUI(i)
    })
  })

  panel.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      p.amount = Number((btn as HTMLElement).dataset.preset)
      ;(panel.querySelector('[data-amount]') as HTMLInputElement).value = formatMoney(p.amount)
      updatePanelUI(i)
    })
  })

  const amountInput = panel.querySelector('[data-amount]') as HTMLInputElement
  amountInput.addEventListener('change', () => {
    const v = Number(amountInput.value)
    p.amount = Number.isFinite(v) ? Math.min(MAX_BET, Math.max(MIN_BET, round2(v))) : MIN_BET
    amountInput.value = formatMoney(p.amount)
    updatePanelUI(i)
  })

  panel.querySelector('[data-action]')!.addEventListener('click', () => {
    if (phase === 'flying' && p.active && !p.cashed) cashOut(i, 1)
    else if (phase === 'waiting') placeBet(i)
  })

  panel.querySelector('[data-half]')!.addEventListener('click', () => {
    cashOut(i, 0.5)
  })

  panel.querySelector('[data-auto-toggle]')!.addEventListener('click', () => {
    p.autoEnabled = !p.autoEnabled
    updatePanelUI(i)
  })

  const autoMult = panel.querySelector('[data-auto-mult]') as HTMLInputElement
  autoMult.addEventListener('change', () => {
    const v = Number(autoMult.value)
    p.autoCashout = Number.isFinite(v) ? Math.max(1.01, round2(v)) : 2
    autoMult.value = formatMoney(p.autoCashout)
  })
}

document.querySelectorAll('.footer-tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.footer-tabs button').forEach((b) => b.classList.remove('active'))
    btn.classList.add('active')
    activeTab = (btn as HTMLElement).dataset.tab as Tab
    renderBetsList()
  })
})

function beginWaiting(now: number) {
  phase = 'waiting'
  phaseStarted = now
  currentMult = 1
  flyAway = null
  trailFill.setAttribute('d', '')
  trailLine.setAttribute('d', '')
  waitBar.classList.remove('hidden')
  statusLine.classList.remove('hidden')
  statusLine.textContent = 'Scanning sector'
  multiplierDisplay.classList.remove('crashed')
  multiplierDisplay.textContent = ''
  placeWaitJet(1)
  jetFly.classList.remove('hovering')
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

  for (const p of panels) {
    p.cashed = false
    p.active = false
    p.cashMult = 0
    p.remaining = 0
    if (!apiReady && p.mode === 'auto' && p.autoEnabled && !p.pending && balance >= p.amount) {
      balance = round2(balance - p.amount)
      p.pending = true
      p.remaining = p.amount
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
  multiplierDisplay.textContent = '1.00x'
  jetFly.style.opacity = '1'
  crashPoint = 99999

  if (apiReady && serverRoundId) {
    void (async () => {
      try {
        const data = await api.startRound(serverRoundId!)
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
              p.remaining = p.amount
            }
          }
        }
        lockPendingBets()
        updateAllPanels()
      } catch (err) {
        console.warn(err)
        crashPoint = sampleCrashPoint()
        if (crashPoint < 1.01) crashPoint = 1.0
        lockPendingBets()
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
  setJet(lastProgress, now, false)
  flyAway = { ...lastPose, started: now }
  history = [...history, crashPoint].slice(-30)
  renderHistory()
  multiplierDisplay.textContent = formatMult(crashPoint)
  multiplierDisplay.classList.add('crashed')
  statusLine.textContent = 'Vanished!'
  statusLine.classList.remove('hidden')
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
  const dt = Math.min(0.05, (now - lastLoopNow) / 1000)
  lastLoopNow = now
  updateSkyClouds(dt)
  paintSky(now)

  if (phase === 'waiting') {
    const elapsed = now - phaseStarted
    const remaining = 1 - Math.min(1, elapsed / waitMs)
    waitFill.style.width = `${remaining * 100}%`
    placeWaitJet(remaining)
    playerCountEl.textContent = String(850 + Math.floor((now / 400) % 1100))
    if (elapsed >= waitMs) beginFlying(now)
  } else if (phase === 'flying') {
    const elapsedSec = (now - flightStart) / 1000
    currentMult = multFromElapsed(elapsedSec)
    if (currentMult >= crashPoint) {
      currentMult = crashPoint
      beginCrash(now)
    } else {
      lastProgress = progressFromElapsed(elapsedSec)
      multiplierDisplay.textContent = formatMult(currentMult)
      setJet(lastProgress, now, true)
      checkAutoCashouts()
      simulateBotCashouts(currentMult)
      updateAllPanels()
      playerCountEl.textContent = String(1050 + Math.floor(lastProgress * 720))
    }
  } else {
    updateFlyAway(now)
    if (now - phaseStarted >= CRASH_HOLD_MS) beginWaiting(now)
  }
}

wirePanel(0)
spawnLiveBets()
renderHistory()
renderBalance()
renderBetsList()
updateAllPanels()
void (async () => {
  try { await initFromServer() } catch (err) { console.warn(err) }
  try { beginWaiting(performance.now()) } catch (err) { console.warn(err) }
  if (!(window as unknown as { __crashLoop?: number }).__crashLoop) {
    ;(window as unknown as { __crashLoop?: number }).__crashLoop = window.setInterval(() => {
      try { loop(performance.now()) } catch (err) { console.warn('tick error', err) }
    }, 50)
  }
})()
