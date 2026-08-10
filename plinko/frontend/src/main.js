import Matter from "matter-js";
import {
  getMultipliers,
  formatMultiplier,
  bucketColor,
} from "./multipliers.js";

function captureGunduToken() {
  try {
    const q = new URLSearchParams(location.search);
    const t = q.get("token") || q.get("access_token") || q.get("accessToken");
    if (t) {
      localStorage.setItem("gundu_access_token", t);
      localStorage.setItem("access_token", t);
    }
  } catch (_) {}
  return (
    localStorage.getItem("gundu_access_token") ||
    localStorage.getItem("access_token") ||
    ""
  );
}

async function loadGunduWallet() {
  const token = captureGunduToken();
  if (!token) {
    balanceEl.textContent = money(state.balance);
    balanceEl.title = "Login required";
    return;
  }
  try {
    const r = await fetch("/api/auth/wallet/", {
      headers: {
        Accept: "application/json",
        Authorization: "Bearer " + token,
      },
    });
    if (!r.ok) return;
    const j = await r.json();
    const data = j.data || j;
    const bal = Number(data.balance ?? data.wallet_balance ?? data.available_balance);
    if (Number.isFinite(bal)) {
      state.balance = bal;
      balanceEl.textContent = money(state.balance);
      balanceEl.title = "Your Gundu wallet";
    }
  } catch (_) {}
}

const { Engine, World, Bodies, Body, Events } = Matter;

const canvas = document.getElementById("plinko");
const bucketsEl = document.getElementById("buckets");
const balanceEl = document.getElementById("balance");
const betInput = document.getElementById("bet-amount");
const betBtn = document.getElementById("bet-btn");
const lastPayoutEl = document.getElementById("last-payout");
const lastProfitEl = document.getElementById("last-profit");
const recentEl = document.getElementById("recent-multipliers");
const historyList = document.getElementById("history-list");
const historyEmpty = document.getElementById("history-empty");
const toastEl = document.getElementById("toast");
const autoControls = document.getElementById("auto-controls");
const autoCountInput = document.getElementById("auto-count");
const liveEntryEl = document.getElementById("live-entry");
const liveOnlineEl = document.getElementById("live-online");

/** Fake live-wins feed (same style as Chicken Road). */
const LIVE_PLAYERS = [
  { user: "WorthOtter45", flag: "ca" },
  { user: "29545666--7b", flag: "in" },
  { user: "LuckyFox99", flag: "us" },
  { user: "ProGamer22", flag: "br" },
  { user: "egg***88", flag: "in" },
  { user: "Kimmstarr", flag: "nl" },
  { user: "62NiftyStint", flag: "gb" },
  { user: "26286699--27e", flag: "in" },
  { user: "RajaWin***", flag: "in" },
  { user: "NightOwl_7", flag: "de" },
  { user: "SpinKing21", flag: "ph" },
  { user: "mystic***9", flag: "us" },
  { user: "ApexHunter", flag: "au" },
  { user: "bet***404", flag: "ng" },
  { user: "GoldenEgg88", flag: "in" },
  { user: "FoxTrail12", flag: "ca" },
  { user: "lucky***x", flag: "bd" },
  { user: "TurboDash", flag: "br" },
  { user: "neon_piper", flag: "jp" },
  { user: "CashCow99", flag: "za" },
  { user: "7b--884512", flag: "in" },
  { user: "SkyRocket", flag: "mx" },
  { user: "play***77", flag: "pk" },
  { user: "NovaBlast", flag: "fr" },
  { user: "PlinkKing", flag: "in" },
  { user: "drop***42", flag: "us" },
];

const LIVE_AVATAR_COLORS = [
  "#c0392b",
  "#2980b9",
  "#27ae60",
  "#8e44ad",
  "#d35400",
  "#16a085",
  "#c0398b",
  "#2c3e50",
  "#e67e22",
  "#1abc9c",
];

let liveOnline = 1200 + Math.floor(Math.random() * 400);
let lastLiveUser = "";

function randomLiveAmount() {
  const roll = Math.random();
  if (roll < 0.55) return +(Math.random() * 80 + 5).toFixed(2);
  if (roll < 0.85) return +(Math.random() * 400 + 80).toFixed(2);
  return +(Math.random() * 2000 + 400).toFixed(2);
}

function nextLiveWin() {
  let u = LIVE_PLAYERS[Math.floor(Math.random() * LIVE_PLAYERS.length)];
  for (let i = 0; i < 6 && u.user === lastLiveUser; i++) {
    u = LIVE_PLAYERS[Math.floor(Math.random() * LIVE_PLAYERS.length)];
  }
  lastLiveUser = u.user;
  const letter = (u.user.replace(/[^a-zA-Z]/g, "")[0] || "P").toUpperCase();
  const amount = randomLiveAmount();
  const color =
    LIVE_AVATAR_COLORS[Math.floor(Math.random() * LIVE_AVATAR_COLORS.length)];
  return { ...u, letter, color, amount };
}

function renderLiveWin(entry) {
  if (!liveEntryEl) return;
  const amt = Math.round(entry.amount).toLocaleString("en-IN");
  liveEntryEl.innerHTML = `
    <div class="live-wins__avatar" style="background:${entry.color}">${entry.letter}</div>
    <img class="live-wins__flag" src="https://flagcdn.com/w40/${entry.flag}.png" alt="" />
    <span class="live-wins__user">${entry.user}</span>
    <span class="live-wins__amt">+₹${amt}</span>
  `;
  // Retrigger enter animation
  liveEntryEl.classList.remove("is-fresh");
  void liveEntryEl.offsetWidth;
  liveEntryEl.classList.add("is-fresh");
}

function tickLiveWins() {
  renderLiveWin(nextLiveWin());
  liveOnline = Math.max(900, liveOnline + Math.floor(Math.random() * 9 - 4));
  if (liveOnlineEl) liveOnlineEl.textContent = String(liveOnline);
}

function startLiveWinsFeed() {
  if (!liveEntryEl) return;
  tickLiveWins();
  setInterval(tickLiveWins, 2800);
}

const BALL = 0x0002;
const PEG = 0x0004;
const WALL = 0x0008;

const state = {
  balance: 1000,
  mode: "manual",
  risk: "high",
  rows: 12,
  multipliers: [],
  history: [],
  activeBalls: new Map(),
  autoRunning: false,
  autoLeft: 0,
  pegs: [],
  walls: [],
  width: 0,
  height: 0,
  dpr: 1,
  geom: null,
};

const pegFlashes = new Map();

// Real physics world — ball falls and bounces on its own
const engine = Engine.create({
  gravity: { x: 0, y: 0.85 },
  positionIterations: 8,
  velocityIterations: 6,
  enableSleeping: false,
});
// Slow the whole simulation so the drop is easy to watch
engine.timing.timeScale = 0.45;
const world = engine.world;

const STEP_MS = 1000 / 60;
let simLast = performance.now();
let simTime = 0; // ms of simulated physics time

function advanceSim() {
  const now = performance.now();
  let ms = now - simLast;
  simLast = now;
  // Cap catch-up so a background tab doesn't explode the ball
  ms = Math.min(Math.max(ms, 0), 32);
  while (ms > 0) {
    const step = Math.min(STEP_MS, ms);
    Engine.update(engine, step);
    simTime += step;
    ms -= step;
  }
}

function loop() {
  advanceSim();
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Backup ticker if rAF is paused
setInterval(() => {
  if (performance.now() - simLast > 40) advanceSim();
}, STEP_MS);

function money(n) {
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function showToast(text, kind = "") {
  toastEl.textContent = text;
  toastEl.className = `toast is-visible ${kind}`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toastEl.classList.remove("is-visible");
  }, 1600);
}

function layoutMetrics() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const width = Math.max(320, rect.width);
  const height = Math.max(420, Math.min(560, width * 0.88));
  return { width, height };
}

function clearWorld() {
  for (const entry of state.activeBalls.values()) {
    World.remove(world, entry.body);
  }
  state.activeBalls.clear();
  for (const body of [...state.pegs, ...state.walls]) {
    World.remove(world, body);
  }
  state.pegs = [];
  state.walls = [];
  pegFlashes.clear();
}

function buildBoard() {
  clearWorld();

  const { width, height } = layoutMetrics();
  state.width = width;
  state.height = height;
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = width * state.dpr;
  canvas.height = height * state.dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const rows = state.rows;
  state.multipliers = getMultipliers(state.risk, rows);
  const slots = state.multipliers.length;

  const padX = width * 0.08;
  const topY = height * 0.06;
  const bucketH = 36;
  const bottomPad = 8;
  // Boxes sit on the bottom; pegs fill down to just above them
  const bucketTop = height - bottomPad - bucketH;
  const lastRowY = bucketTop - 18;
  const boardHeight = Math.max(120, lastRowY - topY);
  const rowGap = boardHeight / Math.max(1, rows - 1);
  const bucketY = bucketTop + bucketH * 0.4;
  const bucketGap = bucketY - lastRowY;

  const bottomPegCount = slots + 1;
  const usableWidth = width - padX * 2;
  const pegGap = usableWidth / (bottomPegCount - 1);
  const pegRadius = Math.max(2.5, Math.min(3.8, pegGap * 0.09));
  // Ball fits the gaps so it rolls off pegs instead of balancing
  const ballRadius = Math.max(5, Math.min(6.5, (pegGap - pegRadius * 2) * 0.3));

  for (let r = 0; r < rows; r++) {
    const pegsInRow = r + 3;
    const rowWidth = (pegsInRow - 1) * pegGap;
    const startX = (width - rowWidth) / 2;
    const y = topY + r * rowGap;

    for (let c = 0; c < pegsInRow; c++) {
      const peg = Bodies.circle(startX + c * pegGap, y, pegRadius, {
        isStatic: true,
        label: "peg",
        restitution: 0.55,
        friction: 0,
        frictionStatic: 0,
        collisionFilter: { category: PEG, mask: BALL },
      });
      state.pegs.push(peg);
    }
  }

  const firstWidth = 2 * pegGap;
  const lastWidth = (bottomPegCount - 1) * pegGap;
  // Rails hug the outer pegs so balls stay inside the peg field
  const railPad = pegRadius + 1.5;
  const firstLeftPeg = (width - firstWidth) / 2;
  const firstRightPeg = (width + firstWidth) / 2;
  const lastLeftPeg = (width - lastWidth) / 2;
  const lastRightPeg = (width + lastWidth) / 2;
  const firstLeft = firstLeftPeg - railPad;
  const firstRight = firstRightPeg + railPad;
  const lastLeft = lastLeftPeg - railPad;
  const lastRight = lastRightPeg + railPad;
  const wallBottomY = bucketY + 24;
  const wallSpan = wallBottomY - (topY - 30);

  const wallOpts = {
    isStatic: true,
    restitution: 0.15,
    friction: 0.02,
    collisionFilter: { category: WALL, mask: BALL },
  };

  const leftWall = Bodies.rectangle(
    (firstLeft + lastLeft) / 2,
    (topY - 30 + wallBottomY) / 2,
    14,
    wallSpan + 20,
    {
      ...wallOpts,
      angle: Math.atan2(lastLeft - firstLeft, wallBottomY - (topY - 30)),
      label: "wall",
    }
  );
  const rightWall = Bodies.rectangle(
    (firstRight + lastRight) / 2,
    (topY - 30 + wallBottomY) / 2,
    14,
    wallSpan + 20,
    {
      ...wallOpts,
      angle: Math.atan2(lastRight - firstRight, wallBottomY - (topY - 30)),
      label: "wall",
    }
  );
  const floor = Bodies.rectangle(width / 2, height + 30, width * 2, 60, {
    ...wallOpts,
    label: "floor",
  });

  state.walls.push(leftWall, rightWall, floor);
  World.add(world, [...state.pegs, ...state.walls]);

  const sensorStart = (width - (slots - 1) * pegGap) / 2;

  state.geom = {
    pegGap,
    pegRadius,
    topY,
    lastRowY,
    dropY: topY - rowGap * 0.55,
    ballRadius,
    bucketY,
    bucketGap,
    sensorStart,
    slots,
    padX,
    rowGap,
    firstLeftPeg,
    firstRightPeg,
    lastLeftPeg,
    lastRightPeg,
  };

  bucketsEl.style.gridTemplateColumns = `repeat(${slots}, 1fr)`;
  bucketsEl.style.left = `${padX}px`;
  bucketsEl.style.right = `${padX}px`;
  bucketsEl.style.bottom = `${bottomPad}px`;
  bucketsEl.innerHTML = state.multipliers
    .map((value, i) => {
      const bg = bucketColor(i, slots);
      return `<div class="bucket" data-i="${i}" style="background:${bg}">${formatMultiplier(value)}</div>`;
    })
    .join("");
}

function nearestBucket(x) {
  const { pegGap, sensorStart, slots } = state.geom;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < slots; i++) {
    const bx = sensorStart + i * pegGap;
    const d = Math.abs(x - bx);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** Exact horizontal center of a multiplier box */
function bucketCenterX(index) {
  const { pegGap, sensorStart } = state.geom;
  return sensorStart + index * pegGap;
}

function dropBall(betAmount) {
  if (betAmount > state.balance + 1e-9) {
    showToast("Not enough balance", "lose");
    return false;
  }
  if (betAmount <= 0 || Number.isNaN(betAmount)) {
    showToast("Enter a valid bet", "lose");
    return false;
  }

  state.balance -= betAmount;
  balanceEl.textContent = money(state.balance);

  const { width } = state;
  const { dropY, ballRadius, pegGap } = state.geom;

  const body = Bodies.circle(
    width / 2 + (Math.random() - 0.5) * pegGap * 0.15,
    dropY,
    ballRadius,
    {
      label: "ball",
      restitution: 0.38,
      friction: 0,
      frictionAir: 0.028,
      frictionStatic: 0,
      density: 0.002,
      slop: 0.02,
      sleepThreshold: Infinity,
      collisionFilter: {
        category: BALL,
        mask: PEG | WALL | BALL,
      },
    }
  );

  state.activeBalls.set(body.id, {
    body,
    bet: betAmount,
    settled: false,
    stuckFrames: 0,
    bornSim: simTime,
  });

  World.add(world, body);
  Body.setVelocity(body, {
    x: (Math.random() - 0.5) * 0.35,
    y: 0.4,
  });
  return true;
}

/** Horizontal playable range between outer pegs at a given Y */
function pegLaneBounds(y) {
  const {
    topY,
    lastRowY,
    firstLeftPeg,
    firstRightPeg,
    lastLeftPeg,
    lastRightPeg,
    pegRadius,
    ballRadius,
  } = state.geom;
  const t = Math.max(0, Math.min(1, (y - topY) / Math.max(1, lastRowY - topY)));
  const leftPeg = firstLeftPeg + (lastLeftPeg - firstLeftPeg) * t;
  const rightPeg = firstRightPeg + (lastRightPeg - firstRightPeg) * t;
  const margin = pegRadius * 0.35 + ballRadius * 0.15;
  return {
    minX: leftPeg + margin,
    maxX: rightPeg - margin,
  };
}

function settleBall(ballId, bucketIndex) {
  const entry = state.activeBalls.get(ballId);
  if (!entry || entry.settled) return;
  entry.settled = true;

  const mult = state.multipliers[bucketIndex];
  const payout = +(entry.bet * mult).toFixed(2);
  const profit = +(payout - entry.bet).toFixed(2);

  // Payout rule: you get back (bet × multiplier). Profit = payout − bet.
  // e.g. ₹100 × 1.5 = ₹150 (+₹50); ₹100 × 0.2 = ₹20 (−₹80)
  state.balance = +(state.balance + payout).toFixed(2);
  balanceEl.textContent = money(state.balance);
  lastPayoutEl.textContent = money(payout);

  if (lastProfitEl) {
    // Always celebrate the amount returned — never frame as a loss
    lastProfitEl.textContent = `You got ₹${money(payout)} (${formatMultiplier(mult)}× on ₹${money(entry.bet)})`;
    lastProfitEl.className = payout > 0 ? "payout-meta pos" : "payout-meta";
  }

  const bucketDom = bucketsEl.querySelector(`[data-i="${bucketIndex}"]`);
  if (bucketDom) {
    bucketDom.classList.add("is-hit");
    setTimeout(() => bucketDom.classList.remove("is-hit"), 240);
  }

  showToast(
    `${formatMultiplier(mult)}× → you got ₹${money(payout)}`,
    payout > 0 ? "win" : "lose"
  );

  pushHistory({
    mult,
    bet: entry.bet,
    payout,
    profit,
    risk: state.risk,
    rows: state.rows,
  });

  setTimeout(() => {
    const still = state.activeBalls.get(ballId);
    if (still) {
      World.remove(world, still.body);
      state.activeBalls.delete(ballId);
    }
  }, 450);

  if (state.autoRunning) {
    state.autoLeft -= 1;
    if (state.autoLeft <= 0) {
      stopAuto();
    } else {
      setTimeout(() => {
        if (!state.autoRunning) return;
        if (!dropBall(Number(betInput.value))) stopAuto();
      }, 280);
    }
  }
}

// Peg flash only — do NOT override bounce (keeps motion natural)
Events.on(engine, "collisionStart", (event) => {
  for (const pair of event.pairs) {
    const a = pair.bodyA;
    const b = pair.bodyB;
    const ball = a.label === "ball" ? a : b.label === "ball" ? b : null;
    const peg = ball === a ? b : a;
    if (!ball || !peg || peg.label !== "peg") continue;
    pegFlashes.set(peg.id, performance.now() + 120);
  }
});

Events.on(engine, "afterUpdate", () => {
  if (!state.geom) return;
  const { bucketY, topY, lastRowY, pegRadius, ballRadius } = state.geom;

  for (const [id, entry] of state.activeBalls) {
    if (entry.settled) continue;
    const { body } = entry;
    let { x, y } = body.position;
    const speed = Math.hypot(body.velocity.x, body.velocity.y);

    // Keep ball inside the outer peg lane while on the board
    if (y < bucketY) {
      const { minX, maxX } = pegLaneBounds(Math.min(y, lastRowY));
      if (x < minX || x > maxX) {
        const nx = Math.max(minX, Math.min(maxX, x));
        Body.setPosition(body, { x: nx, y });
        Body.setVelocity(body, {
          x: body.velocity.x * (x < minX || x > maxX ? -0.25 : 0.55),
          y: Math.max(body.velocity.y, 0.6),
        });
        x = nx;
      }
      // Cap sideways speed so bounces don't launch out
      if (Math.abs(body.velocity.x) > 4.2) {
        Body.setVelocity(body, {
          x: Math.sign(body.velocity.x) * 4.2,
          y: body.velocity.y,
        });
      }
    }

    // Tiny air wobble on the peg board only (kept gentle)
    if (y > topY && y < lastRowY) {
      Body.setVelocity(body, {
        x: body.velocity.x + (Math.random() - 0.5) * 0.03,
        y: body.velocity.y,
      });
    }

    // Past last pegs → steer into the middle of the nearest box
    if (y >= lastRowY + pegRadius && y < bucketY) {
      const idx = nearestBucket(x);
      const cx = bucketCenterX(idx);
      const pull = (cx - x) * 0.14;
      Body.setVelocity(body, {
        x: body.velocity.x * 0.65 + pull,
        y: Math.max(body.velocity.y, 1.4),
      });
    }

    // Land dead-center in the box
    if (y >= bucketY) {
      const idx = nearestBucket(x);
      const cx = bucketCenterX(idx);
      Body.setPosition(body, { x: cx, y: bucketY + 10 });
      Body.setVelocity(body, { x: 0, y: 0 });
      settleBall(id, idx);
      continue;
    }

    // Last-resort unstick only if truly resting — nudge down, not sideways out
    if (speed < 0.15 && y > topY + 10 && y < lastRowY) {
      entry.stuckFrames += 1;
      if (entry.stuckFrames > 30) {
        const side = Math.random() < 0.5 ? -1 : 1;
        Body.setVelocity(body, {
          x: side * 0.9,
          y: 2.2,
        });
        entry.stuckFrames = 0;
      }
    } else {
      entry.stuckFrames = 0;
    }

    if (
      y > state.height + 40 ||
      x < -ballRadius ||
      x > state.width + ballRadius ||
      simTime - entry.bornSim > 45000
    ) {
      const idx = nearestBucket(Math.min(state.width, Math.max(0, x)));
      Body.setPosition(body, {
        x: bucketCenterX(idx),
        y: bucketY + 10,
      });
      settleBall(id, idx);
    }
  }
});

function pushHistory(item) {
  state.history.unshift(item);
  if (state.history.length > 40) state.history.pop();
  renderHistory();
  renderRecent();
}

function renderRecent() {
  recentEl.innerHTML = state.history
    .slice(0, 8)
    .map((h) => {
      const color =
        h.mult >= 2
          ? "hsl(38 95% 55%)"
          : h.mult >= 1
            ? "hsl(28 80% 48%)"
            : "hsl(12 70% 42%)";
      return `<span class="recent-pill" style="background:${color}">${formatMultiplier(h.mult)}×</span>`;
    })
    .join("");
}

function renderHistory() {
  historyEmpty.classList.toggle("is-hidden", state.history.length > 0);
  historyList.innerHTML = state.history
    .map((h) => {
      return `<li class="history-item">
        <span class="mult">${formatMultiplier(h.mult)}×</span>
        <span class="pnl pos">₹${money(h.payout)}</span>
        <span class="bet-meta">Bet ₹${money(h.bet)} → you got ₹${money(h.payout)}</span>
      </li>`;
    })
    .join("");
}

function draw() {
  const ctx = canvas.getContext("2d");
  const { width, height, dpr } = state;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const grad = ctx.createRadialGradient(
    width / 2,
    height * 0.3,
    20,
    width / 2,
    height * 0.4,
    width * 0.65
  );
  grad.addColorStop(0, "rgba(30, 55, 95, 0.4)");
  grad.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  const now = performance.now();
  for (const peg of state.pegs) {
    const { x, y } = peg.position;
    const r = peg.circleRadius;
    const hit = (pegFlashes.get(peg.id) || 0) > now;

    ctx.beginPath();
    ctx.arc(x, y, hit ? r * 1.3 : r, 0, Math.PI * 2);
    ctx.fillStyle = hit ? "#ffb347" : "#eef2f8";
    ctx.fill();

    if (hit) {
      ctx.beginPath();
      ctx.arc(x, y, r * 1.7, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 170, 60, 0.22)";
      ctx.fill();
    }
  }

  for (const entry of state.activeBalls.values()) {
    drawBall(ctx, entry.body);
  }
}

function drawBall(ctx, body) {
  const { x, y } = body.position;
  const r = body.circleRadius;

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();

  ctx.fillStyle = "#e67e22";
  ctx.fillRect(x - r, y - r, r * 2, r * 2);

  const shade = ctx.createLinearGradient(x, y - r, x, y + r);
  shade.addColorStop(0, "rgba(255, 255, 255, 0.25)");
  shade.addColorStop(0.5, "rgba(255, 255, 255, 0)");
  shade.addColorStop(1, "rgba(0, 0, 0, 0.28)");
  ctx.fillStyle = shade;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);

  ctx.restore();

  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = "#a34e0a";
  ctx.lineWidth = Math.max(1.5, r * 0.12);
  ctx.stroke();
}

function startAuto() {
  const count = Math.max(1, Math.min(100, Number(autoCountInput.value) || 1));
  state.autoRunning = true;
  state.autoLeft = count;
  betBtn.textContent = "Stop";
  betBtn.classList.add("is-stop");
  if (!dropBall(Number(betInput.value))) stopAuto();
}

function stopAuto() {
  state.autoRunning = false;
  state.autoLeft = 0;
  betBtn.textContent = "Bet";
  betBtn.classList.remove("is-stop");
}

function onBet() {
  if (state.mode === "auto") {
    if (state.autoRunning) {
      stopAuto();
      return;
    }
    startAuto();
    return;
  }
  dropBall(Number(betInput.value));
}

betBtn.addEventListener("click", onBet);

document.querySelectorAll(".mode-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    if (state.autoRunning) stopAuto();
    document.querySelectorAll(".mode-tab").forEach((t) => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    state.mode = tab.dataset.mode;
    autoControls.classList.toggle("is-hidden", state.mode !== "auto");
  });
});

document.querySelectorAll("[data-bet]").forEach((btn) => {
  btn.addEventListener("click", () => {
    let v = Number(betInput.value) || 0;
    if (btn.dataset.bet === "half") v = Math.max(1, Math.floor(v / 2));
    if (btn.dataset.bet === "double") v = Math.min(state.balance, v * 2 || 1);
    betInput.value = String(v);
  });
});

function canRebuild() {
  return state.activeBalls.size === 0 && !state.autoRunning;
}

document.getElementById("clear-history").addEventListener("click", () => {
  state.history = [];
  renderHistory();
  renderRecent();
});

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (canRebuild()) buildBoard();
  }, 150);
});

balanceEl.textContent = money(state.balance);
buildBoard();
startLiveWinsFeed();
loadGunduWallet();
setTimeout(loadGunduWallet, 400);
setTimeout(loadGunduWallet, 1200);

window.__plinko = state;
