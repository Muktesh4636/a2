/**
 * Center vertical symbol reel
 * Logical offset only increases; visual position is modulo-mapped
 * into the middle strip copy — no wrap jumps / glitches.
 *
 * Optional onTick(): fired once per symbol/cell that crosses the window
 * so SFX can match each item.
 */

const REEL_FACES = ["earth", "water", "fire", "skull", "wind"];

const SYMBOL_SRC = {
  earth: new URL("../images/earth-flower.png", import.meta.url).href,
  water: new URL("../images/water-wave.png", import.meta.url).href,
  fire: new URL("../images/fire-flame.png", import.meta.url).href,
  skull: new URL("../images/skull-icon.png", import.meta.url).href,
  wind: new URL("../images/wind-icon.png", import.meta.url).href,
};

const GLOW = {
  earth: "earth-glow",
  water: "water-glow",
  fire: "fire-glow",
  skull: "skull-glow",
  wind: "wind-glow",
};

export function normalizeDrop(drop) {
  if (!drop) return "fire";
  const d = String(drop).replace(/2$/, "");
  return REEL_FACES.includes(d) ? d : "fire";
}

export function createReel(coreEl, { onTick } = {}) {
  const windowEl = document.createElement("div");
  windowEl.className = "reel-window";
  const strip = document.createElement("div");
  strip.className = "reel-strip";
  windowEl.appendChild(strip);
  coreEl.innerHTML = "";
  coreEl.appendChild(windowEl);
  coreEl.classList.add("has-symbol");

  // 3 identical cycles: [0]=top pad, [1]=visible band, [2]=bottom pad
  const COPIES = 3;
  const sequence = [];
  for (let i = 0; i < COPIES; i++) {
    for (const face of REEL_FACES) sequence.push(face);
  }

  Object.values(SYMBOL_SRC).forEach((src) => {
    const im = new Image();
    im.src = src;
  });

  sequence.forEach((face) => {
    const cell = document.createElement("div");
    cell.className = "reel-cell";
    const img = document.createElement("img");
    img.src = SYMBOL_SRC[face];
    img.alt = "";
    img.draggable = false;
    img.decoding = "async";
    cell.appendChild(img);
    strip.appendChild(cell);
  });

  let cellH = 80;
  let offset = 0;
  let speed = 0;
  let raf = 0;
  let mode = "idle";
  let currentFace = "fire";
  let stopTarget = 0;
  let lastTs = 0;
  let stopResolver = null;
  let lastTickCell = -1;

  const nFaces = REEL_FACES.length;
  const cyclePx = () => nFaces * cellH;

  const measure = () => {
    const h = Math.round(windowEl.clientHeight || coreEl.clientHeight || 80);
    if (h > 0) cellH = h;
    strip.querySelectorAll(".reel-cell").forEach((c) => {
      c.style.height = `${cellH}px`;
    });
  };

  const applyGlow = (face) => {
    coreEl.classList.remove("fire-glow", "earth-glow", "water-glow", "skull-glow", "wind-glow", "pulse");
    const g = GLOW[face];
    if (g) coreEl.classList.add(g);
  };

  const visualY = () => {
    const c = cyclePx();
    if (c <= 0) return 0;
    const mod = ((offset % c) + c) % c;
    return c + mod;
  };

  const paint = () => {
    strip.style.transform = `translate3d(0, ${-visualY()}px, 0)`;
  };

  /** One tick per symbol that crosses the center line. */
  const emitTicks = () => {
    if (!onTick || cellH <= 0) return;
    const cell = Math.floor(offset / cellH);
    if (cell === lastTickCell) return;
    lastTickCell = cell;
    try {
      onTick();
    } catch (_) {}
  };

  const facePos = (face) => Math.max(0, REEL_FACES.indexOf(face)) * cellH;

  const setFaceInstant = (drop) => {
    cancelAnimationFrame(raf);
    raf = 0;
    mode = "idle";
    speed = 0;
    lastTs = 0;
    measure();
    const face = normalizeDrop(drop);
    currentFace = face;
    offset = facePos(face);
    lastTickCell = Math.floor(offset / cellH);
    paint();
    applyGlow(face);
  };

  const finishStop = () => {
    mode = "idle";
    speed = 0;
    lastTs = 0;
    offset = facePos(currentFace);
    lastTickCell = Math.floor(offset / cellH);
    paint();
    applyGlow(currentFace);
    coreEl.classList.remove("reel-spinning");
    coreEl.classList.add("pulse");
    setTimeout(() => coreEl.classList.remove("pulse"), 260);
    const r = stopResolver;
    stopResolver = null;
    if (r) r(currentFace);
  };

  let stopStartOffset = 0;
  let stopStartTs = 0;
  let stopDuration = 0;
  let stopDist = 0;
  let stopEase = 3;

  const frame = (ts) => {
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (dt > 0.032) dt = 0.032;
    if (dt < 0.001) dt = 0.001;

    if (mode === "spin") {
      const cruise = cellH * 9;
      const accel = cellH * 12;
      speed = Math.min(cruise, speed + accel * dt);
      offset += speed * dt;
      emitTicks();
      paint();
      raf = requestAnimationFrame(frame);
      return;
    }

    if (mode === "stop") {
      if (!stopStartTs) stopStartTs = ts;
      const t = Math.min(1, (ts - stopStartTs) / stopDuration);
      const eased = 1 - Math.pow(1 - t, stopEase);
      offset = stopStartOffset + stopDist * eased;
      emitTicks();
      paint();
      if (t >= 1) {
        finishStop();
        return;
      }
      raf = requestAnimationFrame(frame);
      return;
    }
  };

  const startSpin = () => {
    measure();
    if (stopResolver) {
      const done = stopResolver;
      stopResolver = null;
      done(currentFace);
    }
    mode = "spin";
    speed = cellH * 2;
    stopStartTs = 0;
    lastTickCell = Math.floor(offset / cellH);
    coreEl.classList.add("reel-spinning");
    coreEl.classList.remove("pulse");
    cancelAnimationFrame(raf);
    lastTs = 0;
    raf = requestAnimationFrame(frame);
  };

  const stopOn = (drop, { turbo = false, durationMs } = {}) =>
    new Promise((resolve) => {
      measure();
      const face = normalizeDrop(drop);
      currentFace = face;

      // Coast duration should match spin-end.wav (~2.5s) so ticks + ending line up.
      stopDuration = Math.max(400, durationMs ?? (turbo ? 900 : 2500));
      stopEase = turbo ? 2 : 3.4;

      const c = cyclePx();
      const posInCycle = ((offset % c) + c) % c;
      let delta = facePos(face) - posInCycle;
      if (delta < cellH * 0.35) delta += c;
      // Enough symbols during coast so you hear distinct ticks slowing down
      const extra = turbo ? 1 : 5;
      stopDist = Math.max(cellH * 1.2, delta + extra * c);
      stopStartOffset = offset;
      stopStartTs = 0;
      stopTarget = offset + stopDist;
      speed = 0;
      lastTickCell = Math.floor(offset / cellH);

      mode = "stop";
      stopResolver = resolve;
      cancelAnimationFrame(raf);
      lastTs = 0;
      raf = requestAnimationFrame(frame);
    });

  requestAnimationFrame(() => requestAnimationFrame(() => setFaceInstant("fire")));

  window.addEventListener("resize", () => {
    if (mode === "idle") setFaceInstant(currentFace);
  });

  return {
    startSpin,
    stopOn,
    setFaceInstant,
    getFace: () => currentFace,
  };
}
