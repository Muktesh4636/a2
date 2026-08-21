import {
  MULTIPLIERS,
  HIT_CHANCE,
  DIFF_LABEL,
  DIFF_HEAT,
  MIN_BET,
  MAX_BET,
  START_BALANCE,
} from "./multipliers.js";

const API_BASE = (() => {
  const host = location.hostname;
  if (host === "127.0.0.1" || host === "localhost") {
    return "http://127.0.0.1:8001/api/chicken-road-2";
  }
  return `${location.origin}/api/chicken-road-2`;
})();

function readAccessToken() {
  const params = new URLSearchParams(location.search);
  const q =
    params.get("token") ||
    params.get("access_token") ||
    params.get("accessToken") ||
    params.get("access");
  if (q) {
    try { localStorage.setItem("gundu_access_token", q); } catch (_) {}
    return q;
  }
  try {
    return localStorage.getItem("gundu_access_token") || localStorage.getItem("access_token") || "";
  } catch (_) {
    return "";
  }
}

async function api(path, { method = "GET", body, requireAuth = true } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = readAccessToken();
  if (requireAuth) {
    if (!token) throw new Error("Login required — open from the app");
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    const msg = (data && (data.detail || data.error)) || `Request failed (${res.status})`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
}

const jumpSfx = (() => {
  try {
    const a = new Audio(new URL("./static/sounds/jump.mp3", location.href).href);
    a.preload = "auto";
    a.volume = 1;
    return a;
  } catch (_) {
    return null;
  }
})();

let jumpUnlocked = false;

function unlockJumpSound() {
  if (!jumpSfx || jumpUnlocked) return;
  jumpSfx.muted = true;
  const p = jumpSfx.play();
  const done = () => {
    jumpUnlocked = true;
    jumpSfx.muted = false;
  };
  if (p && typeof p.then === "function") {
    void p
      .then(() => {
        jumpSfx.pause();
        jumpSfx.currentTime = 0;
        done();
      })
      .catch(() => done());
  } else {
    done();
  }
}

function playJumpSound() {
  if (!jumpSfx) return;
  try {
    jumpSfx.muted = false;
    jumpSfx.volume = 1;
    const shot = jumpSfx.cloneNode(true);
    shot.volume = 1;
    const p = shot.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => {
        jumpSfx.currentTime = 0;
        void jumpSfx.play().catch(() => {});
      });
    }
  } catch (_) {}
}

document.addEventListener("pointerdown", unlockAudio, { capture: true });
document.addEventListener("touchstart", unlockAudio, { capture: true });

const bgm = (() => {
  try {
    const a = new Audio(new URL("./static/sounds/purity-piano.mp3", location.href).href);
    a.preload = "auto";
    a.loop = true;
    a.volume = 0.32;
    return a;
  } catch (_) {
    return null;
  }
})();

let musicOn = localStorage.getItem("chicken2_music_off") !== "1";

function syncMusicToggle() {
  const btn = document.getElementById("musicToggle");
  if (btn) btn.textContent = musicOn ? "Music: On" : "Music: Off";
}

function startBgm() {
  if (!bgm || !musicOn) return;
  bgm.muted = false;
  const p = bgm.play();
  if (p && typeof p.catch === "function") p.catch(() => {});
}

function stopBgm() {
  if (!bgm) return;
  bgm.pause();
}

function setMusicOn(on) {
  musicOn = !!on;
  localStorage.setItem("chicken2_music_off", musicOn ? "0" : "1");
  syncMusicToggle();
  if (musicOn) startBgm();
  else stopBgm();
}

function unlockAudio() {
  unlockJumpSound();
  startBgm();
}

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const els = {
  balance: document.getElementById("balanceLabel"),
  betInput: document.getElementById("betInput"),
  betMin: document.getElementById("betMin"),
  betMax: document.getElementById("betMax"),
  quickBets: document.getElementById("quickBets"),
  diffBtn: document.getElementById("diffBtn"),
  diffLabel: document.getElementById("diffLabel"),
  diffHeatTag: document.getElementById("diffHeatTag"),
  diffCurrent: document.getElementById("diffCurrent"),
  diffMenu: document.getElementById("diffMenu"),
  diffSelect: document.getElementById("diffSelect"),
  playBtn: document.getElementById("playBtn"),
  cashBtn: document.getElementById("cashBtn"),
  goBtn: document.getElementById("goBtn"),
  cashAmount: document.getElementById("cashAmount"),
  actionButtons: document.getElementById("actionButtons"),
  multBadge: document.getElementById("multBadge"),
  multValue: document.getElementById("multValue"),
  online: document.getElementById("onlineLabel"),
  winToast: document.getElementById("winToast"),
  winName: document.getElementById("winName"),
  winAmt: document.getElementById("winAmt"),
  menuBtn: document.getElementById("menuBtn"),
  menuDrawer: document.getElementById("menuDrawer"),
  closeMenu: document.getElementById("closeMenu"),
  resetBalance: document.getElementById("resetBalance"),
  fsBtn: document.querySelector('[data-testid="menu-fullscreen"]'),
};

const NAMES = [
  "Rose Defeate",
  "Jade Superior",
  "Sapphire Fooli",
  "Plum Mighty",
  "Orange Damp",
  "Chocolate Uncon",
  "Scarlet Superb",
];

/* Official objects.png TexturePacker frames */
const OBJ = {
  dash_line: { x: 1, y: 1, w: 17, h: 1140 },
  lamp: { x: 20, y: 1, w: 504, h: 770 },
  stopper: { x: 20, y: 773, w: 517, h: 264 },
  road_color: { x: 20, y: 1039, w: 100, h: 100 },
  car4: { x: 526, y: 1, w: 404, h: 747 },
  car5: { x: 427, y: 1039, w: 404, h: 747 },
  coef_panel: { x: 539, y: 750, w: 375, h: 256 },
  car3: { x: 833, y: 1008, w: 404, h: 695 },
  stopper_shadow: { x: 916, y: 750, w: 468, h: 214 },
  car1: { x: 932, y: 1, w: 362, h: 584 },
  car2: { x: 1296, y: 1, w: 362, h: 584 },
  car6: { x: 1, y: 1143, w: 424, h: 814 },
  luke_default: { x: 1386, y: 587, w: 432, h: 430 },
  luke_gold: { x: 1386, y: 1019, w: 421, h: 422 },
};

const CAR_KEYS = ["car1", "car2", "car3", "car4", "car5", "car6"];
/** Company pride nameplate painted on every truck. */
const TRUCK_BRAND = "PRIDE";
/** Minimum center-to-center gap so cars never stack on each other. */
const MIN_CAR_GAP = 200;
/** Queue spacing at a barricade — must clear tall truck sprites. */
const PARK_CAR_GAP = 130;
/** How fast a death truck races into the hen — official slam is short, not a teleport. */
const DEATH_RUSH_SPEED = 900;
const DEATH_SPAWN_Y = -90;

/* Spine atlas body (Y from bottom of page) */
const CHICK = {
  body: { x: 362, y: 101, w: 178, h: 166 },
  shadow: { x: 776, y: 126, w: 180, h: 141 },
};

const assets = {
  objects: loadImg("./static/image/objects.png"),
  chick: loadImg("./static/image/chicken_idle.png"),
  chickDead: loadImg("./static/image/chicken_dead.png"),
  feather: loadImg("./static/image/death/feather.png"),
  fluff: loadImg("./static/image/death/fluff.png"),
  startBg: loadImg("./static/image/start_bg.png"),
  finishBg: loadImg("./static/image/finish_bg.png"),
};

function loadImg(src) {
  const img = new Image();
  img.src = src;
  return img;
}

const state = {
  balance: 0,
  roundId: null,
  /** True when wallet JWT is missing or /me failed — local crash roll, demo chips */
  demoMode: false,
  authError: "",
  pendingRequest: false,
  bet: 10,
  difficulty: "easy",
  phase: "idle",
  step: 0,
  crashAt: null,
  cameraX: 0,
  chickenX: 0,
  hopT: 1,
  hopFrom: 0,
  hopTo: 0,
  hitAnim: 0,
  hitLane: -1,
  hitCar: null,
  pendingDeath: false,
  /** Server already paid the final pad — don't cash out / credit again */
  roundCompleted: false,
  /** Lane the hen stands on / is hopping to — traffic must not drive through it */
  landingLane: -1,
  /** User is dragging the road to preview multipliers */
  panning: false,
  panPointerId: null,
  panLastX: 0,
  cars: [],
  barriers: [],
  particles: [],
  feathers: [],
  laneW: 148,
  sidewalk: 150,
  viewW: 625,
  viewH: 361,
  time: 0,
  roadRgb: null,
};

/** Pending auto-reset — must be cleared or a new round gets wiped mid-game. */
let resetTimer = null;
let killFallbackTimer = null;
let playLockTimer = null;
let playLockedUntil = 0;

function clearScheduledResets() {
  if (resetTimer != null) {
    clearTimeout(resetTimer);
    resetTimer = null;
  }
  if (killFallbackTimer != null) {
    clearTimeout(killFallbackTimer);
    killFallbackTimer = null;
  }
}

function isPlayLocked() {
  return Date.now() < playLockedUntil || !!els.playBtn.disabled;
}

/** Disable Play after death for `ms` milliseconds. */
function disablePlayFor(ms) {
  playLockedUntil = Date.now() + ms;
  els.playBtn.disabled = true;
  els.playBtn.setAttribute("aria-disabled", "true");
  if (playLockTimer != null) clearTimeout(playLockTimer);
  playLockTimer = setTimeout(() => {
    playLockTimer = null;
    playLockedUntil = 0;
    els.playBtn.disabled = false;
    els.playBtn.removeAttribute("aria-disabled");
  }, ms);
}

function scheduleReset(ms) {
  clearScheduledResets();
  resetTimer = setTimeout(() => {
    resetTimer = null;
    resetWorld();
  }, ms);
}

function loadNum(k, fb) {
  const raw = localStorage.getItem(k);
  if (raw === null || raw === "") return fb;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fb;
}

function save() {
  // Balance is server-authoritative (Gundu wallet) — no local demo balance
}

function fmtMoney(n) {
  return Math.floor(Number(n) || 0).toLocaleString("en-IN");
}

function fmtMult(m) {
  if (m >= 1000) return m.toLocaleString("en-US", { maximumFractionDigits: 2 }) + "x";
  return Number(m.toFixed(2)) + "x";
}

function clampBet(v) {
  return Math.min(MAX_BET, Math.max(MIN_BET, Math.round(v * 100) / 100));
}

function mults() {
  return MULTIPLIERS[state.difficulty];
}

function potential() {
  if (state.step <= 0) return 0;
  return Math.round(state.bet * mults()[state.step - 1] * 100) / 100;
}

function laneX(i) {
  return state.sidewalk + state.laneW * (i + 0.5);
}

/** Furthest camera scroll — last pad + finish strip stay on screen. */
function maxCameraX() {
  const lanes = mults().length;
  const roadEnd = state.sidewalk + lanes * state.laneW + state.laneW * 1.8;
  return Math.max(0, roadEnd - state.viewW + 24);
}

function clampCamera(x) {
  return Math.max(0, Math.min(maxCameraX(), x));
}

function canPanCamera() {
  // Browse ratios any time except mid-hop / death rush
  if (state.phase === "animating") return false;
  if (state.pendingDeath || state.hitAnim > 0) return false;
  return true;
}

function rollCrash() {
  const p = HIT_CHANCE[state.difficulty];
  const n = mults().length;
  for (let s = 1; s <= n; s++) if (Math.random() < p) return s;
  return null;
}

function drawObj(key, dx, dy, dw, dh) {
  const img = assets.objects;
  const r = OBJ[key];
  if (!img.complete || !img.naturalWidth || !r) return false;
  ctx.drawImage(img, r.x, r.y, r.w, r.h, dx, dy, dw, dh);
  return true;
}

function drawChickPart(name, dx, dy, dw, dh) {
  const img = assets.chick;
  const r = CHICK[name];
  if (!img.complete || !img.naturalWidth || !r) return false;
  const sy = img.naturalHeight - r.y - r.h;
  ctx.drawImage(img, r.x, sy, r.w, r.h, dx, dy, dw, dh);
  return true;
}

/** Other live cars on the same lane (excludes self / gone / rush). */
function laneMates(lane, self) {
  return state.cars.filter(
    (c) => c !== self && c.lane === lane && !c.gone && !c.rush
  );
}

/** Recycle well above the road — cars always re-enter from the top. */
function safeRecycleY(lane, car) {
  let y = -260 - Math.random() * 140;
  for (const other of laneMates(lane, car)) {
    y = Math.min(y, other.y - MIN_CAR_GAP);
  }
  return y;
}

/** Cap travel so a car cannot overlap / pass through the car ahead. */
function maxYBeforeCarAhead(car, hardCap, gap = MIN_CAR_GAP) {
  let maxY = hardCap;
  for (const other of laneMates(car.lane, car)) {
    // Only cars strictly ahead (further down). Near-ties must not yank us upward.
    if (other.y > car.y + 0.5) {
      maxY = Math.min(maxY, other.y - gap);
    }
  }
  return maxY;
}

/**
 * Move a car down by dy, respecting the car ahead.
 * Never teleports backward — that made cars "disappear" on the first step.
 */
function advanceCarY(car, dy, hardCap, gap = MIN_CAR_GAP) {
  const cap = maxYBeforeCarAhead(car, hardCap, gap);
  const next = car.y + dy;
  if (next <= cap) {
    car.y = next;
    return;
  }
  // Cap is ahead of us — stop at cap. If we're already past it, hold position.
  if (cap >= car.y) car.y = cap;
}

/** Natural traffic speed — mix of slow / normal / quicker cars so it feels real. */
function naturalSpeed(lane = 0) {
  const roll = Math.random();
  let base;
  if (roll < 0.22) {
    // Slow crawler
    base = 42 + Math.random() * 28;
  } else if (roll < 0.78) {
    // Normal traffic
    base = 70 + Math.random() * 55;
  } else {
    // Quicker truck (still capped so it doesn't look fake-rushed)
    base = 125 + Math.random() * 55;
  }
  // Tiny lane bias so neighboring columns don't look cloned
  return base + (lane % 3) * 4 + (Math.random() - 0.5) * 10;
}

function spawnCars(count) {
  const cars = [];
  // Always spawn above the viewport so traffic enters from the top, never mid-road
  for (let i = 0; i < count; i++) {
    const n = 1 + (i % 3 === 0 ? 1 : 0);
    const base = -280 - ((i * 71) % 220) - Math.random() * 100;
    for (let c = 0; c < n; c++) {
      cars.push({
        lane: i,
        y: base - c * MIN_CAR_GAP,
        dir: 1,
        speed: naturalSpeed(i),
        // Gentle cruise wobble so speeds don't look robotic
        cruise: 0.92 + Math.random() * 0.16,
        key: CAR_KEYS[(i + c) % CAR_KEYS.length],
        scale: 0.14 + (i % 3) * 0.01,
      });
    }
  }
  return cars;
}

/**
 * Keep the cars the player already sees. Play used to call spawnCars() and
 * wipe lane-1 traffic the moment the button was pressed.
 */
function softResetTraffic() {
  const lanes = mults().length;
  for (const car of state.cars) {
    car.rush = false;
    car.hitCue = false;
    car.approaching = false;
    car.exiting = false;
    car.stopped = false;
    car.parking = false;
    car.safePass = false;
    car.gone = false;
    if (!car.speed || car.speed < 40) {
      car.speed = naturalSpeed(car.lane);
      car.cruise = 0.92 + Math.random() * 0.16;
    }
  }
  // Drop death-only cue trucks; keep normal traffic
  state.cars = state.cars.filter((c) => !c.hitCue);
  if (!state.cars.length) {
    state.cars = spawnCars(lanes);
    return;
  }
  const present = new Set(state.cars.map((c) => c.lane));
  for (let i = 0; i < lanes; i++) {
    if (present.has(i)) continue;
    state.cars.push({
      lane: i,
      y: -280 - Math.random() * 160,
      dir: 1,
      speed: naturalSpeed(i),
      cruise: 0.92 + Math.random() * 0.16,
      key: CAR_KEYS[i % CAR_KEYS.length],
      scale: 0.14 + (i % 3) * 0.01,
    });
  }
}

function resize() {
  const stage = canvas.parentElement.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  state.viewW = stage.width;
  state.viewH = stage.height;
  canvas.width = Math.floor(stage.width * dpr);
  canvas.height = Math.floor(stage.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (state.phase === "idle") {
    state.chickenX = state.sidewalk * 0.58;
  }
}

function updateBalance() {
  els.balance.innerHTML = fmtMoney(state.balance);
}

function setPlayingUI(playing) {
  const mid = playing && state.step > 0;
  const dying = state.pendingDeath || state.hitAnim > 0;
  const locked = playing || dying;
  els.playBtn.hidden = true;
  els.cashBtn.hidden = !mid;
  els.goBtn.hidden = !playing;
  els.actionButtons.classList.toggle("split", mid);
  els.diffSelect.hidden = locked;
  els.betInput.disabled = locked;
  els.betMin.disabled = locked;
  els.betMax.disabled = locked;
  els.diffBtn.disabled = locked;
  [...els.quickBets.querySelectorAll("button")].forEach((b) => (b.disabled = locked));

  if (mid) {
    const m = mults()[state.step - 1];
    els.multBadge.hidden = false;
    els.multValue.textContent = fmtMult(m);
    els.cashAmount.textContent = `₹${fmtMoney(Math.round(potential()))}`;
  } else {
    els.multBadge.hidden = true;
  }

  if (!playing) {
    const dying = state.pendingDeath || state.hitAnim > 0;
    els.playBtn.hidden = dying;
    els.cashBtn.hidden = true;
    els.goBtn.hidden = true;
    els.diffSelect.hidden = dying;
    els.actionButtons.classList.remove("split");
    els.multBadge.hidden = true;
    if (!dying) els.diffSelect.hidden = false;
  }
}

function resetWorld() {
  clearScheduledResets();
  state.step = 0;
  state.crashAt = null;
  state.roundId = null;
  state.phase = "idle";
  state.cameraX = 0;
  state.chickenX = state.sidewalk * 0.58;
  state.hopT = 1;
  state.hopFrom = state.chickenX;
  state.hopTo = state.chickenX;
  state.hitAnim = 0;
  state.hitLane = -1;
  state.hitCar = null;
  state.pendingDeath = false;
  state.roundCompleted = false;
  state.landingLane = -1;
  state.panning = false;
  state.panPointerId = null;
  state.cars = spawnCars(mults().length);
  state.barriers = [];
  state.particles = [];
  state.feathers = [];
  setPlayingUI(false);
}

/** Where the hen should stand for a given cleared-step count. */
function expectedHenX(step) {
  return step <= 0 ? state.sidewalk * 0.58 : laneX(step - 1);
}

/** Snap hen + camera to a step (no teleport mid-hop). */
function placeHenAtStep(step) {
  state.step = Math.max(0, Number(step) || 0);
  state.chickenX = expectedHenX(state.step);
  state.hopT = 1;
  state.hopFrom = state.chickenX;
  state.hopTo = state.chickenX;
  state.barriers = [];
  for (let i = 0; i < state.step; i++) {
    state.barriers.push({ lane: i, life: 1 });
  }
  if (state.step <= 0) {
    state.cameraX = 0;
  } else {
    state.cameraX = clampCamera(state.chickenX - state.viewW * 0.28);
  }
  // Park traffic on cleared lanes above the gate (nose never under the stopper)
  for (let i = 0; i < state.step; i++) {
    for (const car of carsOnLane(i)) {
      if (car.rush || car.hitCue) continue;
      if (carPastClosedGate(car)) {
        car.stopped = false;
        car.exiting = true;
        car.parking = false;
        continue;
      }
      car.y = carParkY(state.viewH, car);
      car.stopped = true;
      car.parking = false;
      car.exiting = false;
    }
  }
}

async function onPlay() {
  if (state.phase === "animating" || state.pendingRequest || isPlayLocked()) return;
  const hasToken = !!readAccessToken();

  // Always start visually from the sidewalk (never jump into an old mid-road position)
  clearScheduledResets();
  state.crashAt = null;
  state.roundId = null;
  state.hitAnim = 0;
  state.hitLane = -1;
  state.hitCar = null;
  state.pendingDeath = false;
  state.feathers = [];
  state.particles = [];
  state.barriers = [];
  state.step = 0;
  state.phase = "idle";
  state.chickenX = state.sidewalk * 0.58;
  state.cameraX = 0;
  state.hopT = 1;
  // Keep cars already on the road (especially lane 1) — do not respawn/wipe them
  softResetTraffic();
  setPlayingUI(false);

  state.bet = clampBet(Number(els.betInput.value) || state.bet);
  els.betInput.value = String(state.bet);
  if (state.balance < state.bet) return;

  // Local demo (original localhost feel) — client crash roll + real truck kills
  if (state.demoMode || !hasToken) {
    state.balance -= state.bet;
    updateBalance();
    state.crashAt = rollCrash();
    state.roundId = null;
    state.step = 0;
    state.phase = "playing";
    state.chickenX = state.sidewalk * 0.58;
    state.cameraX = 0;
    state.hopT = 1;
    softResetTraffic();
    state.barriers = [];
    setPlayingUI(true);
    await attemptStep(state.crashAt === 1);
    return;
  }

  state.pendingRequest = true;
  try {
    const data = await api("/start/", {
      method: "POST",
      body: { bet: state.bet, difficulty: state.difficulty },
    });
    state.balance = Number(data.balance) || 0;
    updateBalance();
    state.roundId = data.round?.id || null;
    state.crashAt = null;
    state.step = 0;
    state.phase = "playing";
    state.chickenX = state.sidewalk * 0.58;
    state.cameraX = 0;
    state.hopT = 1;
    softResetTraffic();
    state.barriers = [];
    setPlayingUI(true);
    await serverStep();
  } catch (e) {
    alert(e.message || "Bet failed");
    resetWorld();
  } finally {
    state.pendingRequest = false;
  }
}

async function onGo() {
  if (state.phase !== "playing" || state.pendingRequest) return;

  // Local demo steps (no JWT)
  if (!state.roundId) {
    if (state.pendingDeath || state.hitAnim > 0) return;
    state.pendingRequest = true;
    try {
      const next = state.step + 1;
      const dies = state.crashAt != null && state.crashAt === next;
      await attemptStep(dies);
    } finally {
      state.pendingRequest = false;
    }
    return;
  }

  state.pendingRequest = true;
  try {
    await serverStep();
  } catch (e) {
    alert(e.message || "Move failed");
  } finally {
    state.pendingRequest = false;
  }
}

async function onCash() {
  if (state.step <= 0 || state.pendingRequest) return;
  if (state.phase !== "playing" && state.phase !== "animating") return;

  // Local demo cash-out
  if (!state.roundId) {
    state.balance += potential();
    updateBalance();
    resetWorld();
    return;
  }

  state.pendingRequest = true;
  try {
    const data = await api(`/${state.roundId}/cashout/`, { method: "POST", body: {} });
    state.balance = Number(data.balance) || state.balance;
    updateBalance();
    state.roundId = null;
    resetWorld();
  } catch (e) {
    alert(e.message || "Cash out failed");
  } finally {
    state.pendingRequest = false;
  }
}

async function serverStep() {
  if (!state.roundId) throw new Error("No active round");
  const data = await api(`/${state.roundId}/step/`, { method: "POST", body: {} });
  if (typeof data.balance === "number") {
    state.balance = data.balance;
    updateBalance();
  }
  const dies = !!data.crashed;
  if (dies) {
    state.crashAt = data.step;
    // Clear round id before animating death so collision/rush kill can finish
    state.roundId = null;
  }
  if (data.completed) {
    // Final pad already paid on the server — don't cash out again
    state.roundId = null;
    state.roundCompleted = true;
  }
  await attemptStep(dies);
}

function padY(h) {
  return h * 0.52;
}

/** Barricade just above the hen (official: stopper sits behind her on the pad). */
function barrierY(h) {
  return padY(h) - 58;
}

/** Drawn stopper size — keep park math in sync with drawBarriers. */
function stopperSize() {
  const bw = 118;
  const bh = bw * (264 / 517);
  return { bw, bh, top: bh * 0.35, bottom: bh * 0.65 };
}

/**
 * Top edge of the stopper sprite. Cars must keep their nose above this so
 * trucks never sit under / through the barricade.
 */
function barrierFaceY(h) {
  const { top } = stopperSize();
  return barrierY(h) - top;
}

/** Parked car center so the whole vehicle stays above the barricade. */
function carParkY(h, car) {
  const half = car ? carHalfH(car) : 52;
  return barrierFaceY(h) - half - 12;
}

/** True when the car has already crossed the closed gate (must leave, not park). */
function carPastClosedGate(car, h = state.viewH) {
  if (!car || car.gone) return false;
  return car.y + carHalfH(car) > barrierFaceY(h) + 2;
}

function carsOnLane(lane) {
  return state.cars.filter((c) => c.lane === lane && !c.gone);
}

/** Hen's current vertical position (includes hop arc). */
function henWorldY() {
  const hop = state.hopT < 1 ? Math.sin(state.hopT * Math.PI) * 34 : 0;
  return padY(state.viewH) - hop;
}

/**
 * True when a moving car passes over / touches the hen.
 * Uses X proximity + swept Y so a pass can never be missed.
 */
function carOverlapsHen(car) {
  if (!car || car.gone || car.stopped || car.parking) return false;
  // Hen still on sidewalk — not on the road yet
  if (state.chickenX < state.sidewalk + 20) return false;
  // Off-screen / far above the road — not a real hit
  if (car.y < -100) return false;

  const fr = OBJ[car.key];
  const halfW = fr ? (fr.w * car.scale) * 0.5 : 45;
  const halfH = fr ? (fr.h * car.scale) * 0.5 : 60;
  const carX = state.sidewalk + car.lane * state.laneW + state.laneW / 2;
  // Must share the same road column as the hen
  if (Math.abs(carX - state.chickenX) > halfW + 28) return false;

  const henY = henWorldY();
  const prev = car._prevY != null ? car._prevY : car.y;
  // Recycle teleport (bottom → top) is NOT a pass over the hen
  if (prev - car.y > 200) {
    return Math.abs(car.y - henY) <= halfH + 24;
  }
  // Car fully below the hen already passed — don't kill on a clear pad
  if (Math.min(prev, car.y) - halfH > henY + 28) return false;
  // Car fully above the hen isn't on her yet
  if (Math.max(prev, car.y) + halfH < henY - 28) return false;

  const lo = Math.min(prev, car.y) - halfH;
  const hi = Math.max(prev, car.y) + halfH;
  return hi >= henY - 28 && lo <= henY + 32;
}

function carHalfH(car) {
  const fr = OBJ[car.key];
  return fr ? (fr.h * car.scale) * 0.5 : 60;
}

/** True when this car's column is close enough to cover the hen right now. */
function carSharesHenColumn(car) {
  const fr = OBJ[car.key];
  const halfW = fr ? (fr.w * car.scale) * 0.5 : 45;
  const carX = state.sidewalk + car.lane * state.laneW + state.laneW / 2;
  return Math.abs(carX - state.chickenX) <= halfW + 28;
}

/**
 * True when this car has to give way to the hen.
 *
 * Three lanes are held. The one she is standing on or hopping to, obviously.
 * The one she will step to next (`state.step`), claimed early so the pad is
 * already empty by the time she commits — waiting until the hop begins leaves a
 * car mid-pad with nowhere to go but through her. And whichever column covers
 * her right now, so a car released behind her cannot clip her as she leaves.
 *
 * The crash truck is exempt — it is the one car allowed to reach her.
 */
function mustYieldToHen(car) {
  if (car.rush || car.hitCue) return false;
  if (state.phase === "idle" || state.phase === "ended") return false;
  return (
    car.lane === state.landingLane ||
    car.lane === state.step ||
    carSharesHenColumn(car)
  );
}

// Hen hit box, matching carOverlapsHen, plus the height she gains mid-hop —
// a car parked level with her landing spot still clips her at the top of the arc.
const HEN_HOP_LIFT = 34;
const HEN_BODY_TOP = 28;
const HEN_BODY_BOTTOM = 32;
const HEN_YIELD_MARGIN = 10;
// Mild push for cars already past her — the overlap itself is never drawn
// (see vaultPastHen). Keep this close to natural traffic so exits don't look
// like a highway rush.
const HEN_CLEAR_SPEED = 280;
const EXIT_SPEED_MIN = 160;
const EXIT_SPEED_MAX = 280;
const APPROACH_GATE_SPEED = 120;

/** Cap exit/clear boosts so a previous hurry can't stick as a permanent rocket. */
function cappedExitSpeed(car, min = EXIT_SPEED_MIN) {
  const base = Math.max(car.speed || min, min);
  return Math.min(base, EXIT_SPEED_MAX);
}

/** Top of the vertical band a car body must not enter (hen + hop lift). */
function henBlockedFrom(car) {
  return henWorldY() - HEN_BODY_TOP - carHalfH(car) - HEN_YIELD_MARGIN;
}

/** Bottom of that band — car is fully clear once past here. */
function henClearPast(car) {
  return henWorldY() + HEN_BODY_BOTTOM + carHalfH(car) + HEN_YIELD_MARGIN;
}

/**
 * How far down a car may drive this frame. The server decides life and death,
 * so on a surviving step traffic must never be seen rolling over the hen.
 *
 * Cars still behind the yield line stop short. Cars already past it are free
 * (or vaultPastHen jumps them clear of the band in one frame).
 */
function laneHardCap(car) {
  if (!mustYieldToHen(car)) return Infinity;
  const stopShort = henBlockedFrom(car);
  return car.y <= stopShort ? stopShort : Infinity;
}

/**
 * Never paint a truck on top of the hen on a safe step.
 *
 * Approaching cars are held by laneHardCap. Anything that is already inside her
 * band (closed-lane exit used to crawl through her at Infinity) is jumped just
 * past her in one frame — a flash of motion beats a body through her.
 * Death trucks (rush / hitCue) are left alone.
 */
function vaultPastHen(car) {
  if (!mustYieldToHen(car)) return false;
  const top = henBlockedFrom(car);
  const bot = henClearPast(car);
  if (car.y <= top || car.y >= bot) return false;
  car.y = bot;
  car._prevY = bot;
  car.approaching = false;
  car.parking = false;
  car.stopped = false;
  car.exiting = true;
  car.speed = cappedExitSpeed(car, HEN_CLEAR_SPEED);
  return true;
}

/**
 * True when this car's body (especially the rear) still covers the pad the hen
 * is about to cross — hopping now would clip the bumper.
 */
function carBlocksCrossing(car, lane) {
  if (!car || car.gone || car.lane !== lane) return false;
  if (car.rush || car.hitCue) return false;
  if (car.stopped || car.parking) return false;
  if (car.y < -80) return false;
  const halfH = carHalfH(car);
  const henY = padY(state.viewH);
  // Extra margin so the rear is fully past before the hop starts
  const CLEAR = 48;
  const front = car.y + halfH;
  const rear = car.y - halfH;
  if (front < henY - CLEAR) return false; // still approaching, far enough
  if (rear > henY + CLEAR) return false; // fully past the pad
  return true;
}

function laneBlockedForHop(lane) {
  return carsOnLane(lane).some((c) => carBlocksCrossing(c, lane));
}

/**
 * Briefly hold the hop so any car whose end would touch the hen can clear.
 * Traffic keeps animating during the wait (draw loop).
 */
function waitForSafeCrossing(lane, maxMs = 700) {
  // Claim the lane early so yield / hurry kick in while we wait
  state.landingLane = lane;
  for (const car of carsOnLane(lane)) {
    if (carBlocksCrossing(car, lane)) {
      car.approaching = false;
      car.parking = false;
      car.stopped = false;
      car.exiting = true;
      car.speed = cappedExitSpeed(car, HEN_CLEAR_SPEED);
    }
  }
  if (!laneBlockedForHop(lane)) return Promise.resolve();
  const start = performance.now();
  return new Promise((resolve) => {
    let settled = false;
    const tick = () => {
      if (settled) return;
      for (const car of carsOnLane(lane)) {
        if (carBlocksCrossing(car, lane)) {
          car.exiting = true;
          car.stopped = false;
          car.speed = cappedExitSpeed(car, HEN_CLEAR_SPEED);
        }
      }
      if (!laneBlockedForHop(lane) || performance.now() - start >= maxMs) {
        settled = true;
        clearInterval(id);
        resolve();
      }
    };
    const id = setInterval(tick, 32);
    tick();
  });
}

/**
 * Drains the exit side of a lane the hen needs.
 *
 * Cars already inside her band are vaulted clear. Cars past the band but still
 * on the exit run get a mild speed bump so they don't dam up the ones behind.
 */
function hurryPastHen(car) {
  if (!mustYieldToHen(car)) return;
  if (car.stopped || car.parking) return;
  if (vaultPastHen(car)) return;
  if (car.y < henClearPast(car)) return;
  car.approaching = false;
  car.parking = false;
  car.stopped = false;
  car.exiting = true;
  car.speed = cappedExitSpeed(car, HEN_CLEAR_SPEED);
}

/** Hen dies the moment a car passes over her (same as original local game). */
function forfeitServerRound() {
  const rid = state.roundId;
  state.roundId = null;
  if (!rid || !readAccessToken()) return;
  api(`/${rid}/forfeit/`, { method: "POST", body: {} }).catch(() => {});
}

function killFromCollision(car) {
  if (state.hitAnim > 0) return;
  if (state.phase === "idle") return;
  if (!car) return;
  // Live wallet round: only the dedicated crash truck may kill.
  // Random traffic must not zoom in and flatten the hen mid-round.
  if (
    state.roundId &&
    !state.pendingDeath &&
    !(car.rush || car.hitCue)
  ) {
    return;
  }

  forfeitServerRound();
  state.pendingDeath = false;
  state.phase = "ended";
  state.hitLane = car.lane;
  state.hitCar = car;
  state.feathers = [];
  state.particles = [];
  car.approaching = false;
  car.exiting = false;
  car.parking = false;
  car.safePass = false;
  car.gone = false;
  // Freeze at the impact — do not rocket the truck off-screen
  car.rush = false;
  car.stopped = true;
  car.speed = 0;
  setPlayingUI(false);
  els.playBtn.hidden = true;
  startDeathFx();
}

function checkHenCarHits() {
  if (state.hitAnim > 0) return;
  if (state.phase === "idle") return;
  const midHop = state.phase === "animating" && state.hopT < 0.98;
  for (const car of state.cars) {
    // Mid-hop: only the death rush may splat — random traffic waits for landing
    if (midHop && !(car.rush || car.hitCue)) continue;
    if (!carOverlapsHen(car)) continue;
    if (
      state.roundId &&
      !state.pendingDeath &&
      !car.hitCue &&
      !car.rush
    ) {
      vaultPastHen(car);
      car.exiting = true;
      car.speed = cappedExitSpeed(car, HEN_CLEAR_SPEED);
      continue;
    }
    killFromCollision(car);
    return;
  }
}

/**
 * Official death: a car already in that lane slams the hen on the pad.
 * Prefer the closest truck approaching from above — never yank one from far
 * off-screen if traffic is already there.
 */
function pickDeathCar(lane) {
  const henY = henWorldY();
  const onLane = carsOnLane(lane).filter((c) => !c.gone);
  const above = onLane
    .filter((c) => c.y < henY - 8)
    .sort((a, b) => b.y - a.y);
  if (above[0]) return above[0];
  const overlapping = onLane.find((c) => carOverlapsHen(c));
  return overlapping || null;
}

function armDeathRush(car, lane) {
  car.lane = lane;
  car.dir = 1;
  car.approaching = false;
  car.stopped = false;
  car.parking = false;
  car.exiting = false;
  car.gone = false;
  car.safePass = false;
  car.rush = true;
  car.hitCue = true;
  car.speed = DEATH_RUSH_SPEED;
  const henY = henWorldY();
  // Keep on-screen traffic; only spawn just above the viewport if missing
  if (!(car.y < henY - 24)) {
    car.y = DEATH_SPAWN_Y;
  }
  car._prevY = car.y;
  state.hitCar = car;
  state.hitLane = lane;
}

/** Death truck — reuse lane traffic when possible. */
function cueHitCar(lane) {
  const existing = pickDeathCar(lane);
  if (existing) {
    armDeathRush(existing, lane);
    return;
  }
  const car = {
    lane,
    y: DEATH_SPAWN_Y,
    dir: 1,
    speed: DEATH_RUSH_SPEED,
    key: CAR_KEYS[(lane + 2) % CAR_KEYS.length],
    scale: 0.18,
    approaching: false,
    exiting: false,
    stopped: false,
    parking: false,
    hitCue: true,
    rush: true,
  };
  car._prevY = car.y;
  state.cars.push(car);
  state.hitCar = car;
  state.hitLane = lane;
}

async function attemptStep(diesOverride) {
  const next = state.step + 1;
  if (next > mults().length) return;

  const lane = next - 1;
  const dies = diesOverride != null ? !!diesOverride : state.crashAt === next;

  els.diffSelect.hidden = true;
  els.playBtn.hidden = true;
  els.cashBtn.hidden = state.step === 0;
  els.goBtn.hidden = false;
  els.actionButtons.classList.toggle("split", state.step > 0);
  els.goBtn.disabled = true;
  els.cashBtn.disabled = true;

  // Survive hops wait for a gap. Death hops land into the truck that's
  // already in that lane (official splat) — do not vault it away first.
  if (!dies) {
    await waitForSafeCrossing(lane);
    if (state.phase === "ended" || state.hitAnim > 0) return;
  }

  state.phase = "animating";

  // Snap to expected pad so a resume/desync never teleports across the road
  state.chickenX = expectedHenX(state.step);
  state.hopFrom = state.chickenX;
  state.hopTo = laneX(lane);
  state.hopT = 0;
  state.landingLane = lane;
  playJumpSound();

  if (dies) {
    cueHitCar(lane);
  }

  const start = performance.now();
  // First hop is sidewalk → road: a bit longer so it feels planted
  const hopMs = state.step === 0 ? 640 : 480;

  await new Promise((resolve) => {
    let settled = false;
    const tick = () => {
      if (settled) return;
      const now = performance.now();
      // Collision may have already killed the hen mid-hop
      if (state.phase === "ended" || state.hitAnim > 0) {
        settled = true;
        clearInterval(id);
        resolve();
        return;
      }
      const t = Math.min(1, (now - start) / hopMs);
      state.hopT = t;
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      state.chickenX = state.hopFrom + (state.hopTo - state.hopFrom) * e;
      // Keep sidewalk in view on the first hop; later hops follow the hen
      const focus =
        state.step === 0
          ? Math.max(0, state.chickenX - state.viewW * 0.38)
          : state.chickenX - state.viewW * 0.28;
      state.cameraX += (focus - state.cameraX) * 0.28;
      state.cameraX = clampCamera(state.cameraX);
      if (t < 1) return;
      settled = true;
      clearInterval(id);
      state.chickenX = state.hopTo;
      state.hopT = 1;
      state.cameraX = clampCamera(
        state.step === 0
          ? Math.max(0, state.chickenX - state.viewW * 0.38)
          : state.chickenX - state.viewW * 0.28
      );
      if (state.phase === "ended" || state.hitAnim > 0) {
        resolve();
        return;
      }
      if (dies) {
        kill();
      } else {
        els.goBtn.disabled = false;
        els.cashBtn.disabled = false;
        survive(next);
      }
      resolve();
    };
    const id = setInterval(tick, 16);
    tick();
  });
}

/** True when a car body actually covers the pad the hen just landed on. */
function carUnderLandingPad(car) {
  if (!car || car.gone || car.rush || car.stopped || car.parking) return false;
  // Far off-screen (recycled above) — pad is clear
  if (car.y < -80) return false;
  const fr = OBJ[car.key];
  const halfH = fr ? (fr.h * car.scale) * 0.5 : 60;
  const henY = padY(state.viewH);
  // Require real overlap with the hen — not "same lane somewhere on the road"
  return Math.abs(car.y - henY) <= halfH + 22;
}

function survive(step) {
  const lane = step - 1;
  state.step = step;

  // Landed on a car → hen dies. Never delete / yank that car to the barricade.
  for (const car of carsOnLane(lane)) {
    if (car.rush || car.hitCue) continue;
    if (carUnderLandingPad(car) || carOverlapsHen(car)) {
      // Live round: server already said survive — clear the pad, don't turbo-kill
      if (state.roundId) {
        vaultPastHen(car);
        car.exiting = true;
        car.stopped = false;
        car.speed = cappedExitSpeed(car, HEN_CLEAR_SPEED);
        continue;
      }
      killFromCollision(car);
      return;
    }
  }

  // Safe land — close the lane. Only queue cars still fully above the gate;
  // anyone whose nose already crossed must exit (never freeze under the stopper).
  for (const car of carsOnLane(lane)) {
    if (car.rush || car.hitCue || car.gone) continue;
    car.approaching = false;
    car.parking = false;
    car.safePass = false;

    if (carPastClosedGate(car)) {
      car.stopped = false;
      car.exiting = true;
      car.speed = cappedExitSpeed(car, EXIT_SPEED_MIN);
      continue;
    }

    const parkAt = carParkY(state.viewH, car);
    car.exiting = false;
    car.stopped = true;
    car.speed = naturalSpeed(car.lane);
    car.stopY = parkAt;
    if (car.y > parkAt) car.y = parkAt;
  }

  state.barriers.push({ lane, life: 0 });

  for (let i = 0; i < 12; i++) {
    state.particles.push({
      x: state.chickenX,
      y: padY(state.viewH),
      vx: (Math.random() - 0.5) * 160,
      vy: -60 - Math.random() * 100,
      life: 0.5 + Math.random() * 0.4,
      color: "#fdcf4b",
    });
  }
  if (step >= mults().length) {
    // Was stuck here: phase was still "animating" so onCash() no-op'd
    state.phase = "playing";
    setPlayingUI(true);
    if (state.roundCompleted) {
      state.roundCompleted = false;
      setPlayingUI(false);
      els.playBtn.hidden = false;
      scheduleReset(1200);
      return;
    }
    void onCash();
    return;
  }
  state.phase = "playing";
  setPlayingUI(true);
}

function startDeathFx() {
  if (state.hitAnim > 0) return; // already dying
  state.hitAnim = 4; // keep dead hen visible for 4 seconds
  state.pendingDeath = false;
  const cy = padY(state.viewH);
  const featherImgs = [assets.feather, assets.fluff, assets.feather];
  for (let i = 0; i < 16; i++) {
    const img = featherImgs[i % featherImgs.length];
    const ang = (Math.PI * 2 * i) / 16 + Math.random() * 0.35;
    const spd = 70 + Math.random() * 200;
    state.feathers.push({
      x: state.chickenX + (Math.random() - 0.5) * 24,
      y: cy - 24 + (Math.random() - 0.5) * 24,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd * 0.5 - 100 - Math.random() * 140,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 10,
      life: 1.2 + Math.random() * 0.8,
      size: 14 + Math.random() * 16,
      img,
    });
  }
  scheduleReset(4000);
  els.playBtn.hidden = false;
  disablePlayFor(3000);
}

function kill() {
  if (state.hitAnim > 0) return;
  forfeitServerRound();
  state.hitLane = Math.max(0, state.crashAt != null ? state.crashAt - 1 : state.step);
  state.phase = "ended";
  state.feathers = [];
  state.particles = [];
  state.hitAnim = 0;
  state.pendingDeath = true;

  if (!(state.hitCar && state.hitCar.lane === state.hitLane && !state.hitCar.gone)) {
    cueHitCar(state.hitLane);
  } else {
    armDeathRush(state.hitCar, state.hitLane);
  }

  setPlayingUI(false);
  els.playBtn.hidden = true;
  els.goBtn.hidden = true;
  els.cashBtn.hidden = true;

  // Impact kill in drawCars; fallback only if something stalls the rush
  if (killFallbackTimer != null) clearTimeout(killFallbackTimer);
  killFallbackTimer = setTimeout(() => {
    killFallbackTimer = null;
    if (state.hitAnim <= 0 && state.hitCar) {
      state.hitCar.y = henWorldY();
      state.hitCar._prevY = state.hitCar.y;
      killFromCollision(state.hitCar);
    }
  }, 900);
}

function sampleRoadColor() {
  if (state.roadRgb) return state.roadRgb;
  const img = assets.objects;
  if (!img.complete || !img.naturalWidth) return "#5c5c5c";
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const x = c.getContext("2d");
    const r = OBJ.road_color;
    x.drawImage(img, r.x + 40, r.y + 40, 1, 1, 0, 0, 1, 1);
    const d = x.getImageData(0, 0, 1, 1).data;
    state.roadRgb = `rgb(${d[0]},${d[1]},${d[2]})`;
    return state.roadRgb;
  } catch {
    return "#5c5c5c";
  }
}

function draw(dt) {
  const w = state.viewW;
  const h = state.viewH;
  const cam = state.cameraX;
  const lanes = mults().length;
  const roadTop = 0;
  const roadBot = h;

  ctx.fillStyle = "#313131";
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(-cam, 0);

  drawStartSide(roadTop, roadBot);

  const roadX = state.sidewalk;
  const roadW = lanes * state.laneW + 40;
  ctx.fillStyle = sampleRoadColor();
  ctx.fillRect(roadX, roadTop, roadW, roadBot - roadTop);

  for (let i = 1; i < lanes; i++) {
    const x = roadX + i * state.laneW;
    const dw = 5;
    const tile = OBJ.dash_line;
    const aspect = tile.h / tile.w;
    const th = dw * aspect;
    let y = roadTop - ((state.time * 40) % th);
    while (y < roadBot) {
      drawObj("dash_line", x - dw / 2, y, dw, th);
      y += th;
    }
  }

  for (let i = 0; i < lanes; i++) {
    const cx = laneX(i);
    const cy = padY(h);
    const cleared = state.step > i;
    const next = state.phase !== "ended" && state.step === i;
    drawManhole(cx, cy, mults()[i], cleared, next);
  }

  drawCars(roadTop, roadBot, dt);
  drawBarriers(h);
  drawFinish(lanes, h);
  // Car touches hen first; after impact, splat is on top of the car briefly
  if (state.pendingDeath || state.hitAnim > 1.2) {
    drawChicken(h);
    drawRushCarOverlay(h);
  } else {
    drawRushCarOverlay(h);
    drawChicken(h);
  }
  drawFeathers(dt);
  drawParticles(dt);
  ctx.restore();

  if (!els.multBadge.hidden) {
    const sx = state.chickenX - cam;
    els.multBadge.style.left = `${Math.max(48, Math.min(w - 48, sx))}px`;
    els.multBadge.style.bottom = `${Math.max(20, Math.round(h - padY(h) - 22))}px`;
  }

  if (state.hitAnim > 0) {
    state.hitAnim = Math.max(0, state.hitAnim - dt);
  }
}

function drawStartSide(top, bot) {
  const img = assets.startBg;
  const sw = state.sidewalk;
  if (img.complete && img.naturalWidth) {
    // start_bg is tall strip — cover sidewalk height
    ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, top, sw, bot - top);
  } else {
    ctx.fillStyle = "#8b9099";
    ctx.fillRect(0, top, sw, bot - top);
  }
  // lamp near sidewalk edge
  const lh = (bot - top) * 0.55;
  const lw = lh * (504 / 770);
  drawObj("lamp", sw * 0.12, top + (bot - top) * 0.12, lw, lh);
}

function drawFinish(lanes, h) {
  const img = assets.finishBg;
  const x = state.sidewalk + lanes * state.laneW;
  if (img.complete && img.naturalWidth) {
    const fw = state.laneW * 1.8;
    ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, x, 0, fw, h);
  }
}

function drawManhole(cx, cy, mult, cleared, isNext) {
  const size = 96;
  const key = cleared ? "luke_gold" : "luke_default";
  ctx.save();
  ctx.translate(cx, cy);
  if (!cleared && !isNext) ctx.globalAlpha = 0.55;
  const ok = drawObj(key, -size / 2, -size / 2, size, size);
  if (!ok) {
    ctx.beginPath();
    ctx.ellipse(0, 0, 46, 40, 0, 0, Math.PI * 2);
    ctx.fillStyle = cleared ? "#3dc55b" : "#5c5c5c";
    ctx.fill();
  }
  if (isNext) {
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.52, size * 0.52, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 4;
    ctx.stroke();
  }
  // multiplier text (coef sits on luke)
  ctx.globalAlpha = 1;
  ctx.fillStyle = cleared ? "#1a1a1a" : "#ffffff";
  ctx.font = "700 15px Montserrat, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(fmtMult(mult), 0, 2);
  ctx.restore();
}

function drawOneCar(car, roadTop) {
  // Last resort: never paint a truck on the hen during a safe live step
  if (mustYieldToHen(car)) vaultPastHen(car);
  const x = state.sidewalk + car.lane * state.laneW + state.laneW / 2;
  const y = roadTop + car.y;
  const fr = OBJ[car.key];
  const dw = fr.w * car.scale;
  const dh = fr.h * car.scale;
  ctx.save();
  ctx.translate(x, y);
  if (!drawObj(car.key, -dw / 2, -dh / 2, dw, dh)) {
    ctx.fillStyle = "#3b82f6";
    ctx.fillRect(-dw / 2, -dh / 2, dw, dh);
  }
  drawTruckBrand(dw, dh);
  ctx.restore();
}

/** Pride nameplate — company name on every truck body. */
function drawTruckBrand(dw, dh) {
  const plateW = Math.max(30, dw * 0.82);
  const plateH = Math.max(11, Math.min(dw * 0.32, dh * 0.15));
  const py = dh * 0.04;
  const rx = -plateW / 2;
  const ry = py - plateH / 2;
  const radius = Math.min(3.5, plateH * 0.3);

  ctx.save();
  ctx.fillStyle = "rgba(8, 12, 28, 0.9)";
  ctx.strokeStyle = "rgba(255, 196, 64, 0.95)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(rx, ry, plateW, plateH, radius);
  } else {
    ctx.rect(rx, ry, plateW, plateH);
  }
  ctx.fill();
  ctx.stroke();

  const fontPx = Math.max(7, Math.floor(plateH * 0.58));
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 ${fontPx}px Montserrat, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(TRUCK_BRAND, 0, py + 0.5);
  ctx.restore();
}

function drawCars(roadTop, roadBot, dt) {
  const span = roadBot - roadTop;
  const hasBarrier = (lane) => state.barriers.some((b) => b.lane === lane);

  for (const car of state.cars) {
    if (car.gone) continue;
    car.dir = 1;
    car._prevY = car.y;
    hurryPastHen(car);

    // Death rush — drawn in overlay
    if (car.rush) {
      car.y += car.speed * dt;
      if (carOverlapsHen(car)) killFromCollision(car);
      if (car.y > span + 220) {
        if (state.pendingDeath) {
          state.pendingDeath = false;
          startDeathFx();
        }
        car.rush = false;
        car.gone = true;
      }
      continue;
    }

    const barred = hasBarrier(car.lane);

    // Closed barricade: queue ABOVE the stopper by nose position — never under it
    if (barred) {
      const face = barrierFaceY(state.viewH);
      const park = carParkY(state.viewH, car);

      if (carPastClosedGate(car) || car.exiting) {
        // Nose already past the gate — finish leaving (do not freeze under stopper)
        car.exiting = true;
        car.stopped = false;
        car.parking = false;
        car.speed = cappedExitSpeed(car);
        // Still never drive through the hen on a live survive — vault or hold
        if (!vaultPastHen(car)) {
          advanceCarY(car, car.speed * dt, laneHardCap(car));
          vaultPastHen(car);
        }
        if (car.y > span + 160) {
          car.gone = true;
          continue;
        }
        drawOneCar(car, roadTop);
        continue;
      }

      car.exiting = false;
      car.stopped = true;
      car.parking = false;
      if (car.speed > APPROACH_GATE_SPEED) car.speed = APPROACH_GATE_SPEED;
      const target = maxYBeforeCarAhead(car, park, PARK_CAR_GAP);
      car.stopY = target;
      if (car.y < target - 0.5) {
        advanceCarY(car, APPROACH_GATE_SPEED * dt, park, PARK_CAR_GAP);
      }
      // Hard clamp — nose must stay above the barricade face
      if (car.y > target) car.y = target;
      const noseLimit = face - carHalfH(car);
      if (car.y > noseLimit) car.y = noseLimit;
      drawOneCar(car, roadTop);
      continue;
    }

    // Stopped cars (lane not yet barred): queue above their park line
    if ((car.stopped || car.parking) && !car.exiting) {
      const park = carParkY(state.viewH, car);
      if (carPastClosedGate(car)) {
        car.exiting = true;
        car.stopped = false;
        car.speed = cappedExitSpeed(car);
        if (!vaultPastHen(car)) {
          advanceCarY(car, car.speed * dt, laneHardCap(car));
          vaultPastHen(car);
        }
        if (car.y > span + 160) {
          car.gone = true;
          continue;
        }
        drawOneCar(car, roadTop);
        continue;
      }
      const target = maxYBeforeCarAhead(car, park, PARK_CAR_GAP);
      car.stopY = target;
      if (car.speed > APPROACH_GATE_SPEED) car.speed = APPROACH_GATE_SPEED;
      if (car.y < target - 0.5) {
        advanceCarY(car, APPROACH_GATE_SPEED * dt, park, PARK_CAR_GAP);
      } else if (car.y > target + 8) {
        car.exiting = true;
        car.stopped = false;
        car.speed = cappedExitSpeed(car);
        if (!vaultPastHen(car)) {
          advanceCarY(car, car.speed * dt, laneHardCap(car));
          vaultPastHen(car);
        }
        if (car.y > span + 160) {
          car.gone = true;
          continue;
        }
        drawOneCar(car, roadTop);
        continue;
      } else {
        car.y = Math.min(car.y, park);
        if (car.y > target) car.y = target;
      }
      car.stopped = true;
      car.parking = false;
      drawOneCar(car, roadTop);
      continue;
    }

    if (car.exiting) {
      car.speed = cappedExitSpeed(car);
      if (!vaultPastHen(car)) {
        advanceCarY(car, car.speed * dt, laneHardCap(car));
        vaultPastHen(car);
      }
      if (car.y > span + 160) {
        car.gone = true;
        continue;
      }
      drawOneCar(car, roadTop);
      continue;
    }

    // Open-lane traffic: top → bottom only — keep spacing, never yank backward
    if (car.cruise == null) car.cruise = 0.92 + Math.random() * 0.16;
    // Slow pulse so cruise speed drifts a little (natural, not robotic)
    car.cruise += (Math.random() - 0.5) * 0.01;
    car.cruise = Math.max(0.85, Math.min(1.12, car.cruise));
    const drive = car.speed * car.cruise;
    if (!vaultPastHen(car)) {
      advanceCarY(car, drive * dt, laneHardCap(car));
      vaultPastHen(car);
    }
    if (car.y > span + 140) {
      car.y = safeRecycleY(car.lane, car);
      car._prevY = car.y;
      // New pass down the road → pick a fresh natural speed
      car.speed = naturalSpeed(car.lane);
      car.cruise = 0.92 + Math.random() * 0.16;
    }
    drawOneCar(car, roadTop);

    const canCollide =
      state.phase !== "animating" || state.hopT >= 0.98;
    if (canCollide && carOverlapsHen(car)) {
      // During a live round, random cars must clear past the hen — not turbo-kill
      if (
        state.roundId &&
        !state.pendingDeath &&
        !car.hitCue &&
        !car.rush
      ) {
        vaultPastHen(car);
        car.exiting = true;
        car.speed = cappedExitSpeed(car, HEN_CLEAR_SPEED);
        continue;
      }
      killFromCollision(car);
      if (state.hitAnim > 0) break;
    }
  }

  checkHenCarHits();
}

function drawBarriers(h) {
  for (const b of state.barriers) {
    b.life = Math.min(1, b.life + 0.12);
    const x = state.sidewalk + b.lane * state.laneW + state.laneW / 2;
    const y = barrierY(h);
    ctx.save();
    ctx.globalAlpha = b.life;
    const sw = 110;
    const sh = sw * (214 / 468);
    drawObj("stopper_shadow", x - sw / 2, y + 18, sw, sh);
    const bw = 118;
    const bh = bw * (264 / 517);
    drawObj("stopper", x - bw / 2, y - bh * 0.35, bw, bh);
    ctx.restore();
  }
}

function drawRushCarOverlay(h) {
  const car = state.hitCar;
  if (!car || !car.rush) return;
  const fr = OBJ[car.key];
  if (!fr) return;
  const x = state.sidewalk + car.lane * state.laneW + state.laneW / 2;
  const y = car.y;
  const dw = fr.w * car.scale;
  const dh = fr.h * car.scale;
  ctx.save();
  ctx.translate(x, y);
  drawObj(car.key, -dw / 2, -dh / 2, dw, dh);
  drawTruckBrand(dw, dh);
  ctx.restore();
}

function drawChicken(h) {
  const hop = state.hopT < 1 ? Math.sin(state.hopT * Math.PI) * 34 : 0;
  const x = state.chickenX;
  // Plant feet on the same Y as manhole centers
  const y = padY(h) - hop;
  const hit = state.hitAnim;
  // Dead hen only after a real hit — never on cash-out (phase ended, hitLane still -1)
  const dying =
    hit > 0 ||
    (state.phase === "ended" && state.hitLane >= 0 && !state.pendingDeath);

  ctx.save();
  ctx.translate(x, y);

  // soft ground shadow at feet (origin)
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(0, 4, dying ? 36 : 28, dying ? 12 : 9, 0, 0, Math.PI * 2);
  ctx.fill();

  if (dying) {
    // Official look: flattened splat chicken + floating feathers (no red flash)
    const dead = assets.chickDead;
    const age = Math.max(0, 4 - Math.max(hit, 0)); // seconds since death started
    const progress = Math.min(1, age / 0.18); // pop-in
    const flat = 0.72 + Math.min(1, age / 0.25) * 0.28;
    ctx.scale(0.92 * (0.85 + progress * 0.2), 0.92 * flat);
    if (dead.complete && dead.naturalWidth) {
      const dw = 168;
      const dh = dw * (dead.naturalHeight / dead.naturalWidth);
      ctx.drawImage(dead, -dw / 2, -dh * 0.78, dw, dh);
    } else {
      // fallback splat
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.ellipse(0, -20, 52, 36, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#222";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  } else {
    const img = assets.chick;
    const s = 0.72;
    ctx.scale(s, s);
    if (img.complete && img.naturalWidth) {
      const dw = 118;
      const dh = dw * (img.naturalHeight / img.naturalWidth);
      // Anchor at feet so the hen stands on the pad
      ctx.drawImage(img, -dw / 2, -dh + 8, dw, dh);
    }
  }
  ctx.restore();
}

function drawFeathers(dt) {
  state.feathers = state.feathers.filter((f) => {
    f.life -= dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.vy += 180 * dt;
    f.vx *= 0.98;
    f.rot += f.vr * dt;
    if (f.life <= 0) return false;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.rot);
    ctx.globalAlpha = Math.max(0, Math.min(1, f.life));
    const img = f.img;
    if (img && img.complete && img.naturalWidth) {
      ctx.drawImage(img, -f.size / 2, -f.size / 2, f.size, f.size);
    } else {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.ellipse(0, 0, f.size * 0.28, f.size * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return true;
  });
}

function drawParticles(dt) {
  state.particles = state.particles.filter((p) => {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 260 * dt;
    if (p.life <= 0) return false;
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
    return true;
  });
  ctx.globalAlpha = 1;
}

function wire() {
  els.betMin.onclick = () => {
    if (state.phase !== "idle") return;
    state.bet = MIN_BET;
    els.betInput.value = String(state.bet);
  };
  els.betMax.onclick = () => {
    if (state.phase !== "idle") return;
    state.bet = Math.min(MAX_BET, state.balance);
    els.betInput.value = String(state.bet);
  };
  els.betInput.onchange = () => {
    state.bet = clampBet(Number(els.betInput.value) || MIN_BET);
    els.betInput.value = String(state.bet);
  };
  els.quickBets.querySelectorAll("[data-bet]").forEach((b) => {
    b.onclick = () => {
      if (state.phase !== "idle") return;
      state.bet = clampBet(Number(b.dataset.bet));
      els.betInput.value = String(state.bet);
    };
  });

  function flamesMarkup(heat) {
    return Array.from({ length: heat }, () => '<span class="flame"></span>').join("");
  }

  function syncDifficultyUI() {
    const meta = DIFF_HEAT[state.difficulty] || DIFF_HEAT.easy;
    els.diffLabel.textContent = DIFF_LABEL[state.difficulty];
    if (els.diffHeatTag) {
      els.diffHeatTag.textContent = meta.tag;
      els.diffHeatTag.className = `DiffHeatTag${meta.tagClass ? ` ${meta.tagClass}` : ""}`;
    }
    const currentHeat = els.diffCurrent?.querySelector(".DiffHeat");
    if (currentHeat) {
      currentHeat.dataset.heat = String(meta.heat);
      currentHeat.innerHTML = flamesMarkup(meta.heat);
    }
    els.diffMenu.querySelectorAll("[data-diff]").forEach((b) => {
      const selected = b.dataset.diff === state.difficulty;
      b.setAttribute("aria-selected", selected ? "true" : "false");
    });
  }

  function setDiffMenuOpen(open) {
    els.diffMenu.hidden = !open;
    els.diffBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  els.diffBtn.onclick = () => {
    if (state.phase !== "idle") return;
    setDiffMenuOpen(els.diffMenu.hidden);
  };
  els.diffMenu.querySelectorAll("[data-diff]").forEach((b) => {
    b.onclick = () => {
      state.difficulty = b.dataset.diff;
      syncDifficultyUI();
      setDiffMenuOpen(false);
      resetWorld();
    };
  });
  document.addEventListener("click", (e) => {
    if (!els.diffSelect.contains(e.target)) setDiffMenuOpen(false);
  });
  syncDifficultyUI();

  els.playBtn.onclick = onPlay;
  els.goBtn.onclick = onGo;
  els.cashBtn.onclick = onCash;

  els.menuBtn.onclick = () => (els.menuDrawer.hidden = false);
  els.closeMenu.onclick = () => (els.menuDrawer.hidden = true);
  document.getElementById("musicToggle")?.addEventListener("click", () => {
    setMusicOn(!musicOn);
  });
  syncMusicToggle();
  els.resetBalance.onclick = () => {
    alert("Balance is your Gundu wallet — top up from the app.");
  };
  els.fsBtn?.addEventListener("click", () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      if (state.phase === "idle" || state.phase === "ended") onPlay();
      else if (state.phase === "playing") onGo();
    } else if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
      if (!canPanCamera()) return;
      e.preventDefault();
      const dir = e.code === "ArrowLeft" ? -1 : 1;
      state.cameraX = clampCamera(state.cameraX + dir * state.laneW * 0.85);
    }
  });
  window.addEventListener("resize", resize);

  // Slide the road to preview every win ratio through the finish
  canvas.style.cursor = "grab";
  canvas.addEventListener("pointerdown", (e) => {
    if (!canPanCamera()) return;
    if (e.button != null && e.button !== 0) return;
    state.panning = true;
    state.panPointerId = e.pointerId;
    state.panLastX = e.clientX;
    canvas.setPointerCapture?.(e.pointerId);
    canvas.style.cursor = "grabbing";
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!state.panning || e.pointerId !== state.panPointerId) return;
    const dx = e.clientX - state.panLastX;
    state.panLastX = e.clientX;
    // Drag right → look left (camera decreases); drag left → see later ratios
    state.cameraX = clampCamera(state.cameraX - dx);
  });
  const endPan = (e) => {
    if (e.pointerId != null && state.panPointerId != null && e.pointerId !== state.panPointerId)
      return;
    state.panning = false;
    state.panPointerId = null;
    canvas.style.cursor = "grab";
  };
  canvas.addEventListener("pointerup", endPan);
  canvas.addEventListener("pointercancel", endPan);
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (!canPanCamera()) return;
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!dx) return;
      e.preventDefault();
      state.cameraX = clampCamera(state.cameraX + dx);
    },
    { passive: false }
  );

  setInterval(() => {
    const online = 8200 + Math.floor(Math.random() * 2800);
    els.online.textContent = `Online: ${online}`;
    const name = NAMES[Math.floor(Math.random() * NAMES.length)];
    const amt = (Math.random() * 800 + 20).toFixed(2);
    els.winName.textContent = name.slice(0, 12) + "...";
    els.winAmt.textContent = `+₹${fmtMoney(Math.round(Number(amt)))}`;
  }, 3500);

  // Without token → demo chips (localhost and public URL). JWT still uses wallet.
  (async () => {
    if (!readAccessToken()) {
      state.demoMode = true;
      state.balance = START_BALANCE > 0 ? START_BALANCE : 100000;
      state.authError = "";
      updateBalance();
      return;
    }
    try {
      const me = await api("/me/");
      state.demoMode = false;
      state.balance = Number(me.balance) || 0;
      updateBalance();
      // Resume an unfinished round with hen/camera on the correct pad
      // (never leave step mid-road while the hen is still on the sidewalk).
      // Skip if the player already started a fresh run.
      if (me.active_round && state.phase === "idle" && !state.roundId) {
        state.roundId = me.active_round.id;
        state.bet = Number(me.active_round.bet) || state.bet;
        state.difficulty = me.active_round.difficulty || state.difficulty;
        els.betInput.value = String(state.bet);
        syncDifficultyUI();
        state.cars = spawnCars(mults().length);
        placeHenAtStep(Number(me.active_round.step) || 0);
        state.phase = "playing";
        setPlayingUI(true);
      }
    } catch (e) {
      state.demoMode = true;
      state.balance = START_BALANCE > 0 ? START_BALANCE : 100000;
      updateBalance();
    }
  })();
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  state.time += dt;
  // Don't yank the camera back while browsing ratios (or mid-drag)
  if (state.phase === "idle" && !state.panning && state.cameraX < 1) {
    state.cameraX += (0 - state.cameraX) * 0.05;
  }
  draw(dt);
  requestAnimationFrame(loop);
}

wire();
resize();
resetWorld();
updateBalance();
requestAnimationFrame(loop);

(function wireCasinoBack() {
  function casinoUrl() {
    const token = readAccessToken() || "";
    const u = new URL("/casino/", location.origin);
    if (token) u.searchParams.set("token", token);
    return u.toString();
  }
  function goCasino() {
    location.href = casinoUrl();
  }
  document.getElementById("gunduBackBtn")?.addEventListener("click", goCasino);
  try {
    history.pushState({ gundu_game: "chicken-road-2" }, "", location.href);
    window.addEventListener("popstate", () => {
      location.replace(casinoUrl());
    });
  } catch (_) {}
})();
