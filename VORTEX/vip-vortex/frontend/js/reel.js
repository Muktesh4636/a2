/**
 * Center vertical symbol reel
 * Logical offset only increases; visual position is modulo-mapped
 * into the middle strip copy — no wrap jumps / glitches.
 *
 * Optional onTick(): fired once per symbol/cell that crosses the window
 * so SFX can match each item during cruise.
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
  let lastTs = 0;
  let stopResolver = null;
  let lastTickCell = -1;
  let stopWatchdog = null;

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

  const clearWatchdog = () => {
    if (stopWatchdog) {
      clearTimeout(stopWatchdog);
      stopWatchdog = null;
    }
  };

  const setFaceInstant = (drop) => {
    clearWatchdog();
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
    if (stopResolver) {
      const r = stopResolver;
      stopResolver = null;
      r(face);
    }
  };

  const finishStop = () => {
    clearWatchdog();
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
  let stopTotalMs = 0;
  let stopDist = 0;

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
      const dur = Math.max(1, stopTotalMs);
      const t = Math.min(1, (ts - stopStartTs) / dur);
      // Ease-out quad — starts near cruise speed, slows to a stop (no crawl)
      const eased = 1 - (1 - t) * (1 - t);
      offset = stopStartOffset + stopDist * eased;
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
    clearWatchdog();
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

      stopTotalMs = Math.max(400, durationMs ?? (turbo ? 900 : 1700));
      let T = stopTotalMs / 1000;

      const c = cyclePx();
      const posInCycle = ((offset % c) + c) % c;
      let delta = facePos(face) - posInCycle;
      if (delta < cellH * 0.35) delta += c;

      // Ease-out quad: initial speed = 2*dist/T → dist = v0*T/2
      const v0 = Math.max(cellH * 4, Math.min(speed || cellH * 9, cellH * 9));
      const ideal = v0 * T * 0.5;

      let best = delta;
      let bestDiff = Math.abs(delta - ideal);
      for (let k = 1; k <= 16; k++) {
        const d = delta + k * c;
        const diff = Math.abs(d - ideal);
        if (diff < bestDiff) {
          best = d;
          bestDiff = diff;
        }
      }
      while (best < cellH * 3) best += c;

      // Prefer keeping travel near cruise — stretch time a little instead of crawling
      let needV = (2 * best) / T;
      if (needV < v0 * 0.85) {
        // too little travel for this duration → shorten duration so it doesn't look stuck
        stopTotalMs = Math.max(turbo ? 500 : 900, Math.round((2 * best) / v0 * 1000));
        T = stopTotalMs / 1000;
      } else if (needV > v0 * 1.12) {
        // would surge → add duration instead of cutting travel to nothing
        stopTotalMs = Math.min(turbo ? 1200 : 2400, Math.round((2 * best) / v0 * 1000));
        T = stopTotalMs / 1000;
      }

      stopDist = best;
      stopStartOffset = offset;
      stopStartTs = 0;
      lastTickCell = Math.floor(offset / cellH);

      mode = "stop";
      stopResolver = resolve;
      cancelAnimationFrame(raf);
      lastTs = 0;
      raf = requestAnimationFrame(frame);

      // Never leave the UI hanging if rAF stalls
      clearWatchdog();
      stopWatchdog = setTimeout(() => {
        if (mode === "stop") finishStop();
      }, stopTotalMs + 800);
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
