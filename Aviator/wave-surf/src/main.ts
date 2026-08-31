import { installCasinoBack } from './casinoBack'
installCasinoBack('shark-bite')
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
const GROWTH = 0.054
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
  // Steady glide along the swell (not a rocket climb)
  return Math.min(0.92, 1 - Math.exp(-elapsedSec * 0.085))
}

/** Smooth cruise with gentle up/down — not only climbing */
const WAVE_X0 = 4
const WAVE_X1 = 93
const WAVE_BASE = 70
const WAVE_RISE = 10
const WAVE_AMP = 5.5
const WAVE_OMEGA = Math.PI * 2 * 1.15
const BOTTOM_Y = 100

function flightPoint(t: number) {
  const u = Math.max(0, Math.min(1, t))
  const x = WAVE_X0 + (WAVE_X1 - WAVE_X0) * u
  const ease = u * u * (3 - 2 * u)
  // Mild overall lift + clear up/down undulation
  const bob = Math.sin(WAVE_OMEGA * u) * WAVE_AMP
  const y = WAVE_BASE - WAVE_RISE * ease - bob
  return { x, y }
}

function flightTangent(t: number) {
  const u = Math.max(0, Math.min(1, t))
  const dx = WAVE_X1 - WAVE_X0
  const dEase = 6 * u * (1 - u)
  const dBob = Math.cos(WAVE_OMEGA * u) * WAVE_OMEGA * WAVE_AMP
  const dy = -WAVE_RISE * dEase - dBob
  return { x: dx, y: dy }
}

function buildWaveTrail(t: number) {
  const clamped = Math.max(0, Math.min(1, t))
  const steps = Math.max(12, Math.ceil(clamped * 64))
  let line = ''
  let fill = `M ${WAVE_X0} ${BOTTOM_Y}`
  for (let i = 0; i <= steps; i++) {
    const u = (i / steps) * clamped
    const p = flightPoint(u)
    if (i === 0) {
      line = `M ${p.x.toFixed(2)} ${p.y.toFixed(2)}`
      fill += ` L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`
    } else {
      line += ` L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`
      fill += ` L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`
    }
  }
  const tip = flightPoint(clamped)
  fill += ` L ${tip.x.toFixed(2)} ${BOTTOM_Y} Z`
  return { line, fill, tip }
}

let smoothAngle = 0
let smoothX = WAVE_X0
let smoothY = WAVE_BASE

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
let lastPose = { x: 3, y: 66, angle: -8, nx: 0.9, ny: -0.1 }
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
  <div class="logo">Shark Bite</div>
  <span class="balance" id="balance">${formatMoney(balance)} ${CURRENCY}</span>
</header>

<div class="history-wrap">
  <div class="history" id="history"></div>
</div>

<div class="stage-wrap" id="stageWrap">
  <canvas id="skyCanvas" class="sky-canvas" aria-hidden="true"></canvas>
  <div class="stage-logo">Shark Bite</div>
  <svg class="flight-svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id="trailGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" style="stop-color:#2dd4bf;stop-opacity:0.14" />
        <stop offset="55%" style="stop-color:#14b8a6;stop-opacity:0.05" />
        <stop offset="100%" style="stop-color:#070b14;stop-opacity:0" />
      </linearGradient>
      <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" style="stop-color:#0d9488;stop-opacity:0.2" />
        <stop offset="55%" style="stop-color:#2dd4bf;stop-opacity:0.55" />
        <stop offset="100%" style="stop-color:#5eead4;stop-opacity:0.7" />
      </linearGradient>
    </defs>
    <path id="trailFill" class="trail-fill" d="" />
    <path id="trailLine" class="trail-line" d="" />
  </svg>
  <canvas id="jetFly" class="jet-fly shark-craft" width="280" height="112" aria-hidden="true"></canvas>
  <div class="multiplier-layer">
    <div class="status-line" id="statusLine">Circling…</div>
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
<p class="demo-note">Shark Bite demo — play money only. Same crash loop as Aviator / Jet.</p>
`

const historyEl = document.getElementById('history')!
const multiplierDisplay = document.getElementById('multiplierDisplay')!
const statusLine = document.getElementById('statusLine')!
const waitBar = document.getElementById('waitBar')!
const waitFill = document.getElementById('waitFill')!
const trailFill = document.querySelector('#trailFill') as SVGPathElement
const trailLine = document.querySelector('#trailLine') as SVGPathElement
const jetFly = document.getElementById('jetFly') as HTMLCanvasElement
const sharkCtx = jetFly.getContext('2d')!
const skyCanvas = document.getElementById('skyCanvas') as HTMLCanvasElement
const skyCtx = skyCanvas.getContext('2d')!
const playerCountEl = document.getElementById('playerCount')!
const balanceEl = document.getElementById('balance')!
const betsListEl = document.getElementById('betsList')!
const stageWrap = document.getElementById('stageWrap')!

const sharkImg = new Image()
let sharkReady = false
sharkImg.onload = () => {
  sharkReady = true
  paintSharkFrame(performance.now(), false, 0)
}
sharkImg.src = `${ASSET}shark.png`

function resizeSharkCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const cssW = 150
  const cssH = 60
  jetFly.style.width = `${cssW}px`
  jetFly.style.height = `${cssH}px`
  jetFly.width = Math.floor(cssW * dpr)
  jetFly.height = Math.floor(cssH * dpr)
  sharkCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

/** Realistic carangiform swim — traveling body wave, head stable, tail drives */
let swimYaw = 0
let swimSide = 0

function paintSharkFrame(now: number, flying: boolean, progress: number) {
  const w = 150
  const h = 60
  sharkCtx.clearRect(0, 0, w, h)
  if (!sharkReady) return

  const t = now * 0.001
  // Cruise ~0.7 Hz — slow enough to read as swim, not buzz
  const hz = flying ? 0.68 + progress * 0.12 : 0.38
  const omega = Math.PI * 2 * hz
  // Soft power accents every few beats (not a hard metronome flick)
  const power = 0.75 + 0.25 * (0.5 + 0.5 * Math.sin(omega * t * 0.33))
  const baseAmp = (flying ? 4.0 : 1.8) * power

  const slices = 36
  const iw = sharkImg.naturalWidth
  const ih = sharkImg.naturalHeight
  const drawH = h * 0.92
  const drawW = drawH * (iw / Math.max(1, ih))
  const ox = (w - drawW) / 2
  const oy = (h - drawH) / 2 + Math.sin(omega * t) * (flying ? 0.55 : 0.2)
  const sliceSrc = iw / slices
  const sliceDst = drawW / slices

  // Whole-body yaw / side slip from the swim cycle (head-led)
  swimYaw = Math.sin(omega * t) * (flying ? 2.4 : 1.1)
  swimSide = Math.sin(omega * t - 0.4) * (flying ? 0.35 : 0.12)

  for (let i = 0; i < slices; i++) {
    const along = i / (slices - 1) // 0 = tail (left), 1 = nose (right)
    const s = 1 - along // 0 at nose → 1 at tail
    // Amplitude grows toward caudal fin; traveling wave head → tail
    const amp = baseAmp * Math.pow(s, 1.65)
    const sway = amp * Math.sin(omega * t - s * 2.55)
    // Tiny stretch on the drive side of the stroke
    const stretch = 1 + Math.cos(omega * t - s * 2.55) * 0.01 * Math.pow(s, 2)
    sharkCtx.drawImage(
      sharkImg,
      i * sliceSrc,
      0,
      sliceSrc + 0.7,
      ih,
      ox + i * sliceDst,
      oy + sway,
      sliceDst * stretch + 0.45,
      drawH,
    )
  }
}

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

interface WaterBubble {
  x: number
  y: number
  r: number
  speed: number
  drift: number
  phase: number
  alpha: number
}

const skyClouds: SkyCloud[] = []
const waterBubbles: WaterBubble[] = []
let lastLoopNow = performance.now()
const cloudImgs: (HTMLImageElement | null)[] = [null, null]
let skyReady = false
const blurCache = new Map<string, HTMLCanvasElement>()

function initWaterBubbles() {
  waterBubbles.length = 0
  for (let i = 0; i < 28; i++) {
    waterBubbles.push({
      x: Math.random(),
      y: 0.52 + Math.random() * 0.46,
      r: 1.2 + Math.random() * 2.8,
      speed: 0.035 + Math.random() * 0.055,
      drift: (Math.random() - 0.5) * 0.04,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.25 + Math.random() * 0.45,
    })
  }
}

function updateWaterBubbles(dt: number) {
  for (const b of waterBubbles) {
    b.y -= b.speed * dt
    b.x += b.drift * dt + Math.sin(performance.now() * 0.002 + b.phase) * 0.0008
    if (b.y < 0.48) {
      b.y = 0.92 + Math.random() * 0.08
      b.x = Math.random()
      b.r = 1.2 + Math.random() * 2.8
      b.speed = 0.035 + Math.random() * 0.055
      b.alpha = 0.25 + Math.random() * 0.45
    }
    if (b.x < -0.05) b.x = 1.05
    if (b.x > 1.05) b.x = -0.05
  }
}

function drawWaterBubbles(w: number, h: number, seaTop: number) {
  for (const b of waterBubbles) {
    const px = b.x * w
    const py = b.y * h
    if (py < seaTop + 4) continue
    const fade = Math.min(1, (py - seaTop) / 28)
    skyCtx.beginPath()
    skyCtx.arc(px, py, b.r, 0, Math.PI * 2)
    skyCtx.strokeStyle = `rgba(186, 255, 250,${b.alpha * fade})`
    skyCtx.lineWidth = 1.1
    skyCtx.stroke()
    skyCtx.beginPath()
    skyCtx.arc(px - b.r * 0.28, py - b.r * 0.28, Math.max(0.6, b.r * 0.28), 0, Math.PI * 2)
    skyCtx.fillStyle = `rgba(255,255,255,${0.35 * b.alpha * fade})`
    skyCtx.fill()
  }
}

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

function initSkyClouds() {
  skyClouds.length = 0
  const specs: Omit<SkyCloud, 'bob' | 'bobSpeed'>[] = [
    { x: -0.12, y: 0.1, speed: 0.035, scale: 0.5, opacity: 0.38, kind: 1, flip: false, blur: 3.5, layer: 'far' },
    { x: 0.5, y: 0.16, speed: 0.042, scale: 0.44, opacity: 0.32, kind: 0, flip: true, blur: 4, layer: 'far' },
    { x: 0.88, y: 0.08, speed: 0.03, scale: 0.4, opacity: 0.3, kind: 1, flip: false, blur: 3, layer: 'far' },
    { x: -0.2, y: 0.3, speed: 0.07, scale: 0.78, opacity: 0.72, kind: 0, flip: false, blur: 0, layer: 'near' },
    { x: 0.4, y: 0.38, speed: 0.085, scale: 0.62, opacity: 0.68, kind: 1, flip: true, blur: 0.5, layer: 'near' },
    { x: 0.78, y: 0.28, speed: 0.078, scale: 0.7, opacity: 0.74, kind: 0, flip: false, blur: 0, layer: 'near' },
  ]
  for (const s of specs) {
    skyClouds.push({
      ...s,
      bob: Math.random() * Math.PI * 2,
      bobSpeed: 0.22 + Math.random() * 0.3,
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
  const bobY = Math.sin(now * 0.001 * c.bobSpeed + c.bob) * (c.layer === 'far' ? 2.5 : 4)
  const aspect = img.naturalHeight / Math.max(1, img.naturalWidth)
  const cw = w * 0.52 * c.scale
  const ch = cw * aspect
  const cx = c.x * w
  const cy = c.y * h + bobY
  skyCtx.save()
  skyCtx.globalAlpha = c.opacity
  skyCtx.translate(cx + cw / 2, cy + ch / 2)
  if (c.flip) skyCtx.scale(-1, 1)
  const src = c.blur > 0.2 ? getBlurredCloud(img, c.blur) : img
  skyCtx.drawImage(src, -cw / 2, -ch / 2, cw, ch)
  skyCtx.restore()
}

function paintSky(now: number) {
  const w = stageWrap.clientWidth
  const h = stageWrap.clientHeight
  if (w < 2 || h < 2) return

  // Night ocean sky
  const sky = skyCtx.createLinearGradient(0, 0, 0, h)
  sky.addColorStop(0, '#050814')
  sky.addColorStop(0.4, '#0a1228')
  sky.addColorStop(0.72, '#0c1a32')
  sky.addColorStop(1, '#061018')
  skyCtx.fillStyle = sky
  skyCtx.fillRect(0, 0, w, h)

  // Soft moon
  const mx = w * 0.82
  const my = h * 0.14
  const moonGlow = skyCtx.createRadialGradient(mx, my, 2, mx, my, 50)
  moonGlow.addColorStop(0, 'rgba(180, 220, 255, 0.35)')
  moonGlow.addColorStop(0.4, 'rgba(45, 212, 191, 0.08)')
  moonGlow.addColorStop(1, 'rgba(0,0,0,0)')
  skyCtx.fillStyle = moonGlow
  skyCtx.fillRect(mx - 55, my - 55, 110, 110)
  skyCtx.beginPath()
  skyCtx.arc(mx, my, 11, 0, Math.PI * 2)
  skyCtx.fillStyle = '#c7e0f5'
  skyCtx.fill()

  // Stars
  skyCtx.fillStyle = 'rgba(255,255,255,0.75)'
  for (let i = 0; i < 40; i++) {
    const sx = ((i * 97) % 100) / 100 * w
    const sy = ((i * 53) % 70) / 100 * h * 0.55
    const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(now * 0.0015 + i))
    skyCtx.globalAlpha = tw
    skyCtx.fillRect(sx, sy, i % 5 === 0 ? 1.6 : 1, i % 5 === 0 ? 1.6 : 1)
  }
  skyCtx.globalAlpha = 1

  // Night clouds (dim teal)
  if (skyReady) {
    for (const c of skyClouds) {
      if (c.layer === 'far') {
        skyCtx.save()
        skyCtx.filter = 'brightness(0.25) saturate(0.5) hue-rotate(160deg)'
        drawCloudSprite(c, now, w, h)
        skyCtx.restore()
      }
    }
  }

  // Distant island on horizon (above the water)
  skyCtx.fillStyle = '#050a12'
  skyCtx.beginPath()
  skyCtx.moveTo(0, h * 0.58)
  skyCtx.lineTo(0, h * 0.52)
  skyCtx.bezierCurveTo(w * 0.15, h * 0.42, w * 0.28, h * 0.5, w * 0.4, h * 0.4)
  skyCtx.bezierCurveTo(w * 0.52, h * 0.32, w * 0.62, h * 0.44, w * 0.75, h * 0.38)
  skyCtx.bezierCurveTo(w * 0.88, h * 0.32, w * 0.95, h * 0.42, w, h * 0.4)
  skyCtx.lineTo(w, h * 0.58)
  skyCtx.closePath()
  skyCtx.fill()

  // Palm silhouettes on the ridge
  function palm(px: number, py: number, scale: number) {
    skyCtx.save()
    skyCtx.translate(px, py)
    skyCtx.scale(scale, scale)
    skyCtx.fillStyle = '#03060c'
    skyCtx.beginPath()
    skyCtx.moveTo(-2, 0)
    skyCtx.quadraticCurveTo(0, -40, 2, -70)
    skyCtx.quadraticCurveTo(4, -40, 3, 0)
    skyCtx.closePath()
    skyCtx.fill()
    for (const ang of [-0.9, -0.4, 0.15, 0.55, 1.0]) {
      skyCtx.save()
      skyCtx.translate(1, -68)
      skyCtx.rotate(ang)
      skyCtx.beginPath()
      skyCtx.moveTo(0, 0)
      skyCtx.quadraticCurveTo(18, -6, 36, 4)
      skyCtx.quadraticCurveTo(18, 2, 0, 4)
      skyCtx.closePath()
      skyCtx.fill()
      skyCtx.restore()
    }
    skyCtx.restore()
  }
  palm(w * 0.18, h * 0.5, 0.65)
  palm(w * 0.28, h * 0.48, 0.9)
  palm(w * 0.72, h * 0.42, 0.75)
  palm(w * 0.82, h * 0.4, 1.0)

  // —— Calm ocean (no stacked wave bands) ——
  const seaTop = h * 0.5
  const waterGrad = skyCtx.createLinearGradient(0, seaTop, 0, h)
  waterGrad.addColorStop(0, '#0a3a4a')
  waterGrad.addColorStop(0.35, '#083848')
  waterGrad.addColorStop(1, '#041820')
  skyCtx.fillStyle = waterGrad
  skyCtx.fillRect(0, seaTop, w, h - seaTop)

  // Soft moon reflection
  const shimmer = skyCtx.createLinearGradient(mx - 30, seaTop, mx + 30, h)
  shimmer.addColorStop(0, 'rgba(180, 220, 255, 0.1)')
  shimmer.addColorStop(0.45, 'rgba(45, 212, 191, 0.05)')
  shimmer.addColorStop(1, 'rgba(0,0,0,0)')
  skyCtx.fillStyle = shimmer
  skyCtx.fillRect(mx - 40, seaTop, 80, h - seaTop)

  // Single quiet horizon line
  const t = now * 0.001
  skyCtx.beginPath()
  for (let i = 0; i <= 32; i++) {
    const x = (i / 32) * w
    const y = seaTop + 2 + Math.sin(t * 0.6 + i * 0.25) * 1.2
    if (i === 0) skyCtx.moveTo(x, y)
    else skyCtx.lineTo(x, y)
  }
  skyCtx.strokeStyle = 'rgba(94, 234, 212, 0.2)'
  skyCtx.lineWidth = 1.2
  skyCtx.stroke()

  drawWaterBubbles(w, h, seaTop)

  // Soft teal haze over water
  const glow = skyCtx.createLinearGradient(0, seaTop, 0, h)
  glow.addColorStop(0, 'rgba(45, 212, 191, 0.08)')
  glow.addColorStop(0.4, 'rgba(45, 212, 191, 0.03)')
  glow.addColorStop(1, 'rgba(0,0,0,0)')
  skyCtx.fillStyle = glow
  skyCtx.fillRect(0, seaTop, w, h - seaTop)
}

function updateSkyClouds(dt: number) {
  for (const c of skyClouds) {
    c.x += c.speed * dt
    if (c.x > 1.2) {
      c.x = -0.55 - Math.random() * 0.2
      c.y = c.layer === 'far' ? 0.06 + Math.random() * 0.14 : 0.26 + Math.random() * 0.22
    }
  }
}

initSkyClouds()
initWaterBubbles()
loadSkyAssets()
resizeSkyCanvas()
resizeSharkCanvas()
window.addEventListener('resize', () => {
  resizeSkyCanvas()
  resizeSharkCanvas()
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
  paintSharkFrame(now, flying, t)

  const p = flightPoint(t)
  const tan = flightTangent(t)
  const len = Math.hypot(tan.x, tan.y) || 1
  const nx = tan.x / len
  const ny = tan.y / len

  const ease = flying ? 0.14 : 1
  smoothX += (p.x + swimSide - smoothX) * ease
  smoothY += (p.y - smoothY) * ease
  let px = smoothX
  let py = smoothY

  const stageW = Math.max(stageWrap.clientWidth, 1)
  const stageH = Math.max(stageWrap.clientHeight, 1)
  const marginX = (150 / stageW) * VIEW_W * 0.45
  const marginY = (60 / stageH) * VIEW_H * 0.35
  px = Math.min(VIEW_W - marginX, Math.max(marginX, px))
  py = Math.min(VIEW_H - marginY, Math.max(50, py))

  const pathAngle = (Math.atan2(tan.y, tan.x) * 180) / Math.PI
  const targetAngle = Math.max(-12, Math.min(10, pathAngle * 0.42 + swimYaw * 0.45))
  smoothAngle += (targetAngle - smoothAngle) * (flying ? 0.1 : 1)

  if (t >= 0.01) {
    const trail = buildWaveTrail(t)
    trailLine.setAttribute('d', trail.line)
    trailFill.setAttribute('d', trail.fill)
  } else {
    trailLine.setAttribute('d', '')
    trailFill.setAttribute('d', '')
  }

  lastPose = { x: px, y: py, angle: smoothAngle, nx, ny }
  placeJet(px, py, smoothAngle, 1, false)
  jetFly.classList.toggle('hunting', flying)
}

function updateFlyAway(now: number) {
  if (!flyAway) return
  const u = Math.min(1, (now - flyAway.started) / FLY_AWAY_MS)
  const x = flyAway.x + u * 22
  const y = flyAway.y + u * u * 36 + u * 8
  const opacity = u > 0.3 ? Math.max(0, 1 - (u - 0.3) / 0.7) : 1
  paintSharkFrame(now, true, 1)
  placeJet(x, y, flyAway.angle + u * 40, opacity, false)
  jetFly.classList.remove('hunting')
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
  statusLine.classList.remove('hunting-status')
  statusLine.textContent = 'Circling…'
  multiplierDisplay.classList.remove('crashed')
  multiplierDisplay.textContent = ''
  placeWaitJet(1)
  jetFly.classList.remove('hunting')
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
  const start = flightPoint(0)
  smoothX = start.x
  smoothY = start.y
  smoothAngle = 0
  waitBar.classList.add('hidden')
  statusLine.classList.remove('hidden')
  statusLine.classList.add('hunting-status')
  statusLine.textContent = '↗ Hunting!'
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
  statusLine.textContent = 'Chummed!'
  statusLine.classList.remove('hidden')
  statusLine.classList.remove('hunting-status')
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
  updateWaterBubbles(dt)
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
