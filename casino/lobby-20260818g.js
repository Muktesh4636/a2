/**
 * Casino lobby — orange Ignite theme
 * Banners → Continue Playing → Popular → Category rails
 */
import { GAMES } from "./games.js?v=20260824liveroulette";
import {
  readGunduAccessToken,
  withAuthUrl,
} from "./gundu-auth.js";

const LONG_PRESS_MS = 420;
const MOVE_CANCEL_PX = 10;
const CONTINUE_KEY = "casino_continue_ids";
const NATIVE_ONLY = new Set(["chit-pat", "rangu"]);
/** Old lobby tile ids → current games.js ids */
const GAME_ID_ALIASES = { "auto-roulette": "live-roulette" };

const TITLE_IN_ART = new Set([
  "gundu-ata",
  "stock-market",
  "live-roulette",
  "chicken-road",
  "chicken-road-2",
  "vortex",
  "vortex-1",
  "vip-vortex",
  "chit-pat",
  "rangu",
  "circle-game",
  "stop-bar",
  "spin-dial",
  "mines-path",
  "dice-over-under",
  "color-match",
  "wheel-pockets",
  "wave-surf",
  "keno-pick",
  "hi-lo-cards",
  "aviator",
  "jet",
  "maestro",
  "deep-dive",
  "sky-lift",
  "paper-plane",
  "ufo-lift",
  "shark-bite",
  "under-6",
  "rushbet",
  "knock6",
  "tripleedge",
  "mirror",
  "goldlane",
  "dead7",
  "teenpatti",
]);

const PLAYING_BASE = {
  "stock-market": 8640,
  "chicken-road": 4210,
  "chicken-road-2": 3650,
  "gundu-ata": 3120,
  plinko: 2760,
  mines: 2040,
  "live-roulette": 5200,
  "air-balloon": 1680,
  vortex: 1540,
  "vortex-1": 1500,
  "vip-vortex": 1320,
  "chit-pat": 1420,
  rangu: 1180,
  cases: 1100,
  slide: 980,
  snake: 920,
  steps: 860,
  boxes: 740,
  "wave-surf": 1520,
  "circle-game": 1380,
  "wheel-pockets": 1290,
  "spin-dial": 1210,
  "stop-bar": 1140,
  "mines-path": 1080,
  "color-match": 990,
  "dice-over-under": 940,
  "keno-pick": 880,
  "hi-lo-cards": 820,
  aviator: 4100,
  jet: 3560,
  maestro: 2980,
  "shark-bite": 2620,
  "deep-dive": 2310,
  "sky-lift": 2050,
  "paper-plane": 1840,
  "ufo-lift": 1690,
  "under-6": 2450,
  rushbet: 2280,
  knock6: 2110,
  tripleedge: 1960,
  mirror: 1820,
  goldlane: 1710,
  dead7: 1590,
  teenpatti: 2480,
  "horse-racing": 9200,
};

/** Featured banner slides (use existing casino tile images) */
const BANNER_IDS = [
  "horse-racing",
  "live-roulette",
  "stock-market",
  "aviator",
  "chicken-road",
  "teenpatti",
  "vortex",
  "gundu-ata",
];

const CATEGORIES = [
  {
    id: "crash",
    title: "Crash",
    ids: [
      "aviator",
      "jet",
      "maestro",
      "deep-dive",
      "sky-lift",
      "paper-plane",
      "ufo-lift",
      "shark-bite",
      "air-balloon",
    ],
  },
  {
    id: "cards",
    title: "Card Games",
    ids: [
      "under-6",
      "rushbet",
      "knock6",
      "tripleedge",
      "mirror",
      "goldlane",
      "dead7",
      "teenpatti",
      "hi-lo-cards",
    ],
  },
  {
    id: "vortex",
    title: "Vortex",
    ids: ["vortex", "vortex-1", "vip-vortex"],
  },
  {
    id: "line",
    title: "Line Games",
    ids: [
      "circle-game",
      "stop-bar",
      "spin-dial",
      "mines-path",
      "dice-over-under",
      "color-match",
      "wheel-pockets",
      "wave-surf",
      "keno-pick",
    ],
  },
  {
    id: "mini",
    title: "Mini Games",
    ids: ["plinko", "mines", "steps", "boxes", "snake", "slide", "cases"],
  },
  {
    id: "classic",
    title: "Classic",
    ids: [
      "horse-racing",
      "gundu-ata",
      "stock-market",
      "live-roulette",
      "chicken-road",
      "chicken-road-2",
      "chit-pat",
      "rangu",
    ],
  },
];

const byId = new Map(GAMES.map((g) => [g.id, g]));

/** Temporary global disable — remove id from this set to re-enable. */
const DISABLED_GAMES = new Set([]);

/** Per-user casino tile hides (username lowercase → game ids). */
const HIDDEN_GAMES_BY_USERNAME = {};

let lobbyUsername = "";

function gameAllowed(id) {
  if (!id) return true;
  if (DISABLED_GAMES.has(id)) return false;
  const hidden = HIDDEN_GAMES_BY_USERNAME[lobbyUsername];
  if (!hidden) return true;
  return !hidden.has(id);
}

function filterGames(list) {
  return (list || []).filter((g) => g && gameAllowed(g.id));
}

function parseJwtPayload(token) {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(b64);
    return JSON.parse(json);
  } catch (_) {
    return null;
  }
}

async function resolveLobbyUsername() {
  try {
    const cached =
      localStorage.getItem("gundu_username") ||
      localStorage.getItem("username") ||
      sessionStorage.getItem("username") ||
      "";
    if (cached) return String(cached).trim().toLowerCase();
  } catch (_) {}

  const token = readGunduAccessToken();
  if (!token) return "";

  try {
    const res = await fetch("/api/auth/profile/", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      const name = String(data.username || "").trim().toLowerCase();
      if (name) {
        try {
          localStorage.setItem("gundu_username", name);
          localStorage.setItem("username", name);
        } catch (_) {}
        return name;
      }
    }
  } catch (_) {}

  const payload = parseJwtPayload(token);
  const claim =
    payload?.username || payload?.user_name || payload?.preferred_username || "";
  return String(claim || "").trim().toLowerCase();
}

function readAccessToken() {
  return readGunduAccessToken();
}

function withToken(path) {
  return withAuthUrl(path);
}

function homeUrlWithToken() {
  try {
    return withToken("/").toString();
  } catch (_) {
    return location.origin + "/";
  }
}

/** Casino back always goes to site home — never casino history / prior games. */
function leaveCasino() {
  stopPreview();
  try {
    if (window.AndroidBridge && typeof window.AndroidBridge.goHome === "function") {
      window.AndroidBridge.goHome();
      return;
    }
  } catch (_) {}
  // Prefer absolute home URL so we never bounce around /casino history.
  try {
    location.replace(homeUrlWithToken());
  } catch (_) {
    location.href = location.origin + "/";
  }
}

function playGame(game) {
  if (!game || !gameAllowed(game.id)) return;
  if (!readAccessToken()) {
    showPlayLoginPrompt(game);
    return;
  }
  rememberPlayed(game.id);
  // Always open the game path from games.js.
  // App launch loads casino once; tapping a tile must NOT reload casino.
  const url = withToken(game.path).toString();
  try {
    if (window.AndroidBridge && typeof window.AndroidBridge.openGame === "function") {
      // Prefer bridge so native can attach refresh if the page URL lacked it.
      window.AndroidBridge.openGame(game.id, url);
      return;
    }
  } catch (_) {}
  try {
    sessionStorage.setItem("gundu_from_casino", "1");
  } catch (_) {}
  location.href = url;
}

function normalizeGameId(id) {
  return GAME_ID_ALIASES[id] || id;
}

function loadContinueIds() {
  try {
    const raw = JSON.parse(localStorage.getItem(CONTINUE_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const out = [];
    for (const id of raw) {
      const normalized = normalizeGameId(id);
      if (!byId.has(normalized) || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
    return out;
  } catch (_) {
    return [];
  }
}

function rememberPlayed(id) {
  try {
    const next = [id, ...loadContinueIds().filter((x) => x !== id)].slice(0, 16);
    localStorage.setItem(CONTINUE_KEY, JSON.stringify(next));
  } catch (_) {}
}

let selectedId = null;
let pressTimer = null;
let previewCard = null;
let previewGameId = null;
let pressStart = null;
let previewStartedThisPress = false;
let pressGame = null;
let pressCard = null;

const playingById = new Map();
const playingDrift = new Map();

function clearSelection() {
  selectedId = null;
  document.querySelectorAll(".card.is-selected").forEach((el) => {
    el.classList.remove("is-selected");
  });
}

function selectCard(card, game) {
  if (selectedId === game.id) return;
  clearSelection();
  selectedId = game.id;
  card.classList.add("is-selected");
}

function showPlayLoginPrompt(game) {
  const existing = document.getElementById("casino-login-prompt");
  if (existing) existing.remove();

  const next = withToken(game.path).pathname + withToken(game.path).search;
  const nextQ = encodeURIComponent(next);

  const overlay = document.createElement("div");
  overlay.id = "casino-login-prompt";
  overlay.className = "casino-login-prompt";
  overlay.innerHTML = `
    <div class="casino-login-prompt__card" role="dialog" aria-modal="true" aria-labelledby="casino-login-title">
      <h2 id="casino-login-title">Login to play</h2>
      <p>Sign in or create an account to play ${game.title || "this game"}.</p>
      <a class="casino-login-prompt__primary" href="/login?next=${nextQ}">Login</a>
      <a class="casino-login-prompt__secondary" href="/signup?next=${nextQ}">Sign up</a>
      <button type="button" class="casino-login-prompt__cancel" id="casinoLoginCancel">Cancel</button>
    </div>
  `;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
  overlay.querySelector("#casinoLoginCancel")?.addEventListener("click", () => overlay.remove());
}

function clearPressTimer() {
  if (pressTimer) {
    clearTimeout(pressTimer);
    pressTimer = null;
  }
}

function stopPreview() {
  clearPressTimer();
  if (previewCard) {
    previewCard.querySelectorAll("iframe").forEach((iframe) => {
      try {
        iframe.contentWindow?.stopGameAudio?.();
        iframe.contentWindow?.silenceGameAudio?.(true);
      } catch (_) {}
      try {
        iframe.src = "about:blank";
      } catch (_) {}
    });
    previewCard.classList.remove("is-previewing");
    previewCard.querySelectorAll(".card-preview").forEach((el) => el.remove());
    previewCard = null;
    previewGameId = null;
  }
}

function startPreview(card, game) {
  if (NATIVE_ONLY.has(game.id)) return;
  if (previewGameId === game.id && previewCard === card) {
    previewStartedThisPress = true;
    return;
  }
  stopPreview();
  clearSelection();
  previewStartedThisPress = true;
  previewCard = card;
  previewGameId = game.id;
  card.classList.add("is-previewing");

  const rect = card.getBoundingClientRect();
  const tileW = Math.max(1, Math.round(rect.width));
  const tileH = Math.max(1, Math.round(rect.height));

  const wrap = document.createElement("div");
  wrap.className = "card-preview";

  const iframe = document.createElement("iframe");
  const url = withToken(game.path);
  url.searchParams.set("preview", "1");
  iframe.src = url.toString();
  iframe.title = `${game.title} preview`;
  iframe.width = String(tileW);
  iframe.height = String(tileH);
  iframe.style.width = `${tileW}px`;
  iframe.style.height = `${tileH}px`;
  iframe.setAttribute("loading", "eager");
  // No autoplay in lobby previews — prevents orphan Unity audio after close.
  iframe.setAttribute("allow", "");
  iframe.setAttribute("muted", "");
  iframe.referrerPolicy = "no-referrer-when-downgrade";

  wrap.appendChild(iframe);
  card.querySelector(".card-media").appendChild(wrap);

  try {
    navigator.vibrate?.(18);
  } catch (_) {}
}

function onPressStart(e, card, game) {
  if (e.button != null && e.button !== 0) return;
  clearPressTimer();
  previewStartedThisPress = false;
  pressCard = card;
  pressGame = game;
  const pt = e.touches ? e.touches[0] : e;
  pressStart = { x: pt.clientX, y: pt.clientY };
  pressTimer = setTimeout(() => {
    pressTimer = null;
    if (pressCard === card && pressGame === game) {
      startPreview(card, game);
    }
  }, LONG_PRESS_MS);
}

function onPressMove(e) {
  if (!pressStart || !pressTimer) return;
  const pt = e.touches ? e.touches[0] : e;
  const dx = Math.abs(pt.clientX - pressStart.x);
  const dy = Math.abs(pt.clientY - pressStart.y);
  if (dx > MOVE_CANCEL_PX || dy > MOVE_CANCEL_PX) {
    clearPressTimer();
  }
}

function onPressEnd(_e, card, game) {
  clearPressTimer();
  const rail = card.closest(".rail");
  if (rail?.classList.contains("is-dragging")) {
    pressStart = null;
    pressCard = null;
    pressGame = null;
    previewStartedThisPress = false;
    return;
  }
  if (previewStartedThisPress || previewCard === card) {
    pressStart = null;
    pressCard = null;
    pressGame = null;
    previewStartedThisPress = false;
    return;
  }
  if (pressCard === card) {
    selectCard(card, game);
  }
  pressStart = null;
  pressCard = null;
  pressGame = null;
  previewStartedThisPress = false;
}

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function initialPlaying(id) {
  const base = PLAYING_BASE[id] ?? randInt(600, 2400);
  const spread = Math.max(40, Math.floor(base * 0.12));
  return base + randInt(-spread, spread);
}

function formatPlaying(n) {
  return Math.round(n).toLocaleString("en-IN");
}

function makePlayersBadge(game) {
  let count = playingById.get(game.id);
  if (count == null) {
    count = initialPlaying(game.id);
    playingById.set(game.id, count);
    playingDrift.set(game.id, Math.random() < 0.5 ? -1 : 1);
  }

  const badge = document.createElement("div");
  badge.className = "card-players";
  badge.dataset.gameId = game.id;
  badge.setAttribute("aria-live", "polite");

  const dot = document.createElement("span");
  dot.className = "card-players-dot";
  dot.setAttribute("aria-hidden", "true");

  const num = document.createElement("span");
  num.className = "card-players-num";
  num.textContent = formatPlaying(count);

  const label = document.createElement("span");
  label.className = "card-players-label";
  label.textContent = "playing";

  badge.append(dot, num, label);
  return badge;
}

function tickPlayingCounts() {
  playingById.forEach((count, id) => {
    const base = PLAYING_BASE[id] ?? count;
    const min = Math.max(80, Math.floor(base * 0.78));
    const max = Math.floor(base * 1.22);
    let drift = playingDrift.get(id) || 1;
    if (Math.random() < 0.18) drift *= -1;
    if (count <= min + 20) drift = 1;
    if (count >= max - 20) drift = -1;
    playingDrift.set(id, drift);

    const stepScale = Math.max(3, Math.round(base / 900));
    let delta = drift * randInt(stepScale, stepScale * 4);
    if (Math.random() < 0.22) delta = -drift * randInt(1, stepScale + 2);
    if (delta === 0) delta = drift || 1;

    const next = Math.min(max, Math.max(min, count + delta));
    playingById.set(id, next);
    document
      .querySelectorAll(`.card-players[data-game-id="${id}"] .card-players-num`)
      .forEach((el) => {
        if (next !== count) {
          el.textContent = formatPlaying(next);
          el.classList.remove("is-tick");
          void el.offsetWidth;
          el.classList.add("is-tick");
        }
      });
  });
}

function createCard(game, { wide = false } = {}) {
  const card = document.createElement("article");
  card.className = TITLE_IN_ART.has(game.id) ? "card art-has-frame" : "card";
  if (wide) card.classList.add("card-wide");
  card.dataset.id = game.id;
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  card.setAttribute(
    "aria-label",
    NATIVE_ONLY.has(game.id)
      ? game.title
      : `${game.title}. Long press to preview`
  );

  const media = document.createElement("div");
  media.className = "card-media";

  const img = document.createElement("img");
  img.className = "card-art";
  img.src = game.image;
  img.alt = game.title;
  img.loading = "lazy";
  img.decoding = "async";

  const overlay = document.createElement("div");
  overlay.className = "card-overlay";

  const play = document.createElement("button");
  play.type = "button";
  play.className = "play-btn";
  play.textContent = "Play";
  play.addEventListener("click", (e) => {
    e.stopPropagation();
    stopPreview();
    playGame(game);
  });

  overlay.appendChild(play);
  media.appendChild(img);
  media.appendChild(makePlayersBadge(game));
  if (!TITLE_IN_ART.has(game.id)) {
    const title = document.createElement("h2");
    title.className = "card-title";
    title.textContent = game.title;
    media.appendChild(title);
  }
  media.appendChild(overlay);
  card.appendChild(media);

  card.addEventListener("pointerdown", (e) => onPressStart(e, card, game));
  card.addEventListener("pointermove", onPressMove);
  card.addEventListener("pointerup", (e) => onPressEnd(e, card, game));
  card.addEventListener("pointercancel", () => {
    clearPressTimer();
    pressStart = null;
    pressCard = null;
    pressGame = null;
  });
  card.addEventListener("contextmenu", (e) => e.preventDefault());
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      selectCard(card, game);
    }
  });

  return card;
}

function fillRail(rail, games, opts) {
  rail.innerHTML = "";
  games.forEach((g) => rail.appendChild(createCard(g, opts)));
  enableSmoothRail(rail);
}

/** Momentum + drag scrolling — locks to X only after horizontal intent */
function enableSmoothRail(rail) {
  if (!rail || rail.dataset.smoothRail === "1") return;
  rail.dataset.smoothRail = "1";

  let active = false;
  let dragging = false;
  let axis = null; // null | "x" | "y"
  let startX = 0;
  let startY = 0;
  let startScroll = 0;
  let lastX = 0;
  let lastT = 0;
  let velocity = 0;
  let raf = 0;
  let pointerId = null;

  const maxScroll = () => Math.max(0, rail.scrollWidth - rail.clientWidth);
  const clamp = (v) => Math.max(0, Math.min(maxScroll(), v));

  const stopInertia = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const clearPress = () => {
    clearPressTimer();
    pressCard = null;
    pressGame = null;
    pressStart = null;
    previewStartedThisPress = false;
  };

  const runInertia = () => {
    velocity *= 0.955;
    if (Math.abs(velocity) < 0.2) {
      raf = 0;
      velocity = 0;
      rail.classList.remove("is-dragging");
      return;
    }
    const next = clamp(rail.scrollLeft + velocity);
    if (next === 0 || next === maxScroll()) velocity *= 0.4;
    rail.scrollLeft = next;
    raf = requestAnimationFrame(runInertia);
  };

  const releaseCapture = () => {
    if (pointerId != null) {
      try {
        if (rail.hasPointerCapture?.(pointerId)) {
          rail.releasePointerCapture(pointerId);
        }
      } catch (_) {}
      pointerId = null;
    }
  };

  const onDown = (e) => {
    if (rail.id === "allRail" && document.documentElement.classList.contains("is-desktop")) {
      return;
    }
    if (e.pointerType === "mouse" && e.button !== 0) return;
    stopInertia();
    active = true;
    dragging = false;
    axis = null;
    startX = e.clientX;
    startY = e.clientY;
    lastX = e.clientX;
    lastT = performance.now();
    startScroll = rail.scrollLeft;
    velocity = 0;
    pointerId = e.pointerId;
  };

  const onMove = (e) => {
    if (!active) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);

    // Decide scroll axis from first clear movement
    if (!axis) {
      if (adx < 8 && ady < 8) return;
      if (ady >= adx) {
        // Vertical page scroll — do not hijack
        axis = "y";
        active = false;
        dragging = false;
        clearPress();
        rail.classList.remove("is-dragging");
        return;
      }
      // Horizontal rail scroll
      axis = "x";
      dragging = true;
      clearPress();
      rail.classList.add("is-dragging");
      try {
        rail.setPointerCapture(e.pointerId);
        pointerId = e.pointerId;
      } catch (_) {}
    }

    if (axis !== "x" || !dragging) return;

    e.preventDefault();
    const now = performance.now();
    const dt = Math.max(8, now - lastT);
    rail.scrollLeft = clamp(startScroll - dx);
    const frameV = ((lastX - e.clientX) / dt) * 16.67;
    velocity = velocity * 0.7 + frameV * 0.3;
    lastX = e.clientX;
    lastT = now;
  };

  const onUp = () => {
    if (!active && !dragging) {
      axis = null;
      return;
    }
    active = false;
    if (dragging && axis === "x") {
      velocity *= 1.25;
      if (Math.abs(velocity) > 0.35) {
        raf = requestAnimationFrame(runInertia);
      } else {
        rail.classList.remove("is-dragging");
      }
    } else {
      rail.classList.remove("is-dragging");
    }
    dragging = false;
    axis = null;
    releaseCapture();
  };

  rail.addEventListener("pointerdown", onDown, { passive: true });
  rail.addEventListener("pointermove", onMove, { passive: false });
  rail.addEventListener("pointerup", onUp);
  rail.addEventListener("pointercancel", onUp);
  rail.addEventListener("lostpointercapture", () => {
    pointerId = null;
  });

  rail.addEventListener(
    "wheel",
    (e) => {
      // Prefer horizontal when shift or dominant deltaX; otherwise leave vertical to page
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        stopInertia();
        rail.scrollLeft = clamp(rail.scrollLeft + e.deltaX);
      } else if (e.shiftKey && Math.abs(e.deltaY) > 2) {
        e.preventDefault();
        stopInertia();
        rail.scrollLeft = clamp(rail.scrollLeft + e.deltaY);
      }
    },
    { passive: false }
  );
}

function animateRailTo(rail, left, ms = 420) {
  stopRailAnim(rail);
  const from = rail.scrollLeft;
  const max = Math.max(0, rail.scrollWidth - rail.clientWidth);
  const to = Math.max(0, Math.min(max, left));
  const dist = to - from;
  if (Math.abs(dist) < 1) return;
  const t0 = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const tick = (now) => {
    const p = Math.min(1, (now - t0) / ms);
    rail.scrollLeft = from + dist * ease(p);
    if (p < 1) rail._anim = requestAnimationFrame(tick);
    else rail._anim = 0;
  };
  rail._anim = requestAnimationFrame(tick);
}

function stopRailAnim(rail) {
  if (rail?._anim) {
    cancelAnimationFrame(rail._anim);
    rail._anim = 0;
  }
}

function railNavSvg(dir) {
  const d =
    dir === "prev"
      ? "M14.5 5.5 8 12l6.5 6.5"
      : "M9.5 5.5 16 12l-6.5 6.5";
  return `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function wireRailNav(navEl, rail) {
  if (!navEl || !rail) return;
  navEl.innerHTML = "";
  const prev = document.createElement("button");
  prev.type = "button";
  prev.setAttribute("aria-label", "Slide previous");
  prev.innerHTML = railNavSvg("prev");
  const next = document.createElement("button");
  next.type = "button";
  next.setAttribute("aria-label", "Slide next");
  next.innerHTML = railNavSvg("next");

  const step = () => Math.max(160, Math.floor(rail.clientWidth * 0.78));
  const sync = () => {
    const max = rail.scrollWidth - rail.clientWidth - 2;
    prev.disabled = rail.scrollLeft <= 2;
    next.disabled = rail.scrollLeft >= max;
  };
  prev.addEventListener("click", () => {
    animateRailTo(rail, rail.scrollLeft - step(), 480);
  });
  next.addEventListener("click", () => {
    animateRailTo(rail, rail.scrollLeft + step(), 480);
  });
  rail.addEventListener("scroll", () => {
    window.clearTimeout(rail._navT);
    rail._navT = window.setTimeout(sync, 40);
  }, { passive: true });
  navEl.append(prev, next);
  requestAnimationFrame(sync);
}

function mountSectionNav(root, railId) {
  const rail = document.getElementById(railId);
  const nav = (root || document).querySelector(`.rail-nav[data-rail="${railId}"]`);
  wireRailNav(nav, rail);
}

function renderBanners() {
  const track = document.getElementById("bannerTrack");
  const dots = document.getElementById("bannerDots");
  track.innerHTML = "";
  dots.innerHTML = "";

  const slides = filterGames(BANNER_IDS.map((id) => byId.get(id)).filter(Boolean));
  slides.forEach((game, i) => {
    const slide = document.createElement("article");
    slide.className = "banner-slide";
    slide.dataset.index = String(i);

    const img = document.createElement("img");
    img.src = game.image;
    img.alt = game.title;
    img.loading = i === 0 ? "eager" : "lazy";

    const copy = document.createElement("div");
    copy.className = "banner-copy";
    copy.innerHTML = `
      <span class="banner-tag">Featured</span>
      <h3>${game.title}</h3>
      <p>${document.documentElement.classList.contains("is-desktop")
        ? "Play now and ignite the win"
        : "Tap Play to open — long-press tiles below to preview"}</p>
    `;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "banner-play";
    btn.textContent = "Play Now";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      playGame(game);
    });
    copy.appendChild(btn);

    slide.append(img, copy);
    slide.addEventListener("click", () => playGame(game));
    track.appendChild(slide);

    const dot = document.createElement("button");
    dot.type = "button";
    dot.setAttribute("aria-label", `Banner ${i + 1}`);
    if (i === 0) dot.classList.add("is-on");
    dot.addEventListener("click", () => {
      track.scrollTo({ left: track.clientWidth * i, behavior: "smooth" });
    });
    dots.appendChild(dot);
  });

  const syncDots = () => {
    const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    [...dots.children].forEach((d, idx) => d.classList.toggle("is-on", idx === i));
  };
  track.addEventListener("scroll", () => {
    window.clearTimeout(track._dotT);
    track._dotT = window.setTimeout(syncDots, 60);
  });

  const goTo = (i) => {
    const n = slides.length;
    if (!n) return;
    const idx = ((i % n) + n) % n;
    track.scrollTo({ left: track.clientWidth * idx, behavior: "smooth" });
  };
  const current = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
  const prevBtn = document.getElementById("bannerPrev");
  const nextBtn = document.getElementById("bannerNext");
  if (prevBtn && prevBtn.dataset.wired !== "1") {
    prevBtn.dataset.wired = "1";
    prevBtn.addEventListener("click", () => goTo(current() - 1));
  }
  if (nextBtn && nextBtn.dataset.wired !== "1") {
    nextBtn.dataset.wired = "1";
    nextBtn.addEventListener("click", () => goTo(current() + 1));
  }

  // Auto-rotate banners
  let auto = 0;
  window.setInterval(() => {
    if (document.hidden || slides.length < 2) return;
    auto = (current() + 1) % slides.length;
    goTo(auto);
  }, 4500);
}

function popularGames() {
  return filterGames(
    [...GAMES].sort((a, b) => (PLAYING_BASE[b.id] || 0) - (PLAYING_BASE[a.id] || 0))
  ).slice(0, 12);
}

let activeCategory = "all";

function gamesForCategory(id) {
  if (!id || id === "all") return filterGames(GAMES);
  const cat = CATEGORIES.find((c) => c.id === id);
  if (!cat) return filterGames(GAMES);
  return filterGames(cat.ids.map((gid) => byId.get(gid)).filter(Boolean));
}

function setCategory(id) {
  activeCategory = id || "all";
  const games = gamesForCategory(activeCategory);
  const title = document.getElementById("allGamesTitle");
  const cat = CATEGORIES.find((c) => c.id === activeCategory);
  if (title) title.textContent = cat ? cat.title : "All Games";
  const allRail = document.getElementById("allRail");
  if (allRail) {
    fillRail(allRail, games);
    mountSectionNav(document, "allRail");
  }
  document.querySelectorAll("#desktopNavList button").forEach((btn) => {
    btn.classList.toggle("is-on", btn.dataset.cat === activeCategory);
  });
  if (document.documentElement.classList.contains("is-desktop")) {
    if (activeCategory === "all") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    document.getElementById(`section-${activeCategory}`)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    return;
  }
  document.getElementById("allSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderDesktopNav() {
  const list = document.getElementById("desktopNavList");
  if (!list) return;
  list.innerHTML = "";
    const items = [{ id: "all", title: "Casino" }, ...CATEGORIES];
  items.forEach((item) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.cat = item.id;
    btn.textContent = item.title;
    if (item.id === activeCategory) btn.classList.add("is-on");
    btn.addEventListener("click", () => setCategory(item.id));
    list.appendChild(btn);
  });
}

function render() {
  playingById.clear();
  playingDrift.clear();

  renderBanners();

  const continueIds = loadContinueIds().filter((id) => gameAllowed(id));
  const continueSection = document.getElementById("continueSection");
  const continueRail = document.getElementById("continueRail");
  if (continueIds.length) {
    continueSection.hidden = false;
    fillRail(
      continueRail,
      continueIds.map((id) => byId.get(id)).filter(Boolean),
      { wide: true }
    );
    mountSectionNav(continueSection, "continueRail");
  } else {
    continueSection.hidden = true;
    continueRail.innerHTML = "";
  }

  fillRail(document.getElementById("popularRail"), popularGames());
  mountSectionNav(document, "popularRail");

  const catHost = document.getElementById("categorySections");
  catHost.innerHTML = "";
  CATEGORIES.forEach((cat) => {
    const games = filterGames(cat.ids.map((id) => byId.get(id)).filter(Boolean));
    if (!games.length) return;

    const section = document.createElement("section");
    section.className = "lobby-section";
    section.id = `section-${cat.id}`;
    const railId = `rail-${cat.id}`;
    section.innerHTML = `
      <div class="section-head">
        <h2>${cat.title}</h2>
        <div class="section-head-right">
          <button type="button" class="view-all" data-rail="${railId}">View All</button>
          <div class="rail-nav" data-rail="${railId}"></div>
        </div>
      </div>
      <div class="rail-wrap">
        <div class="rail" id="${railId}"></div>
      </div>
    `;
    const rail = section.querySelector(`#${railId}`);
    games.forEach((g) => rail.appendChild(createCard(g)));
    catHost.appendChild(section);
    mountSectionNav(section, railId);
  });

  renderDesktopNav();
  const allRail = document.getElementById("allRail");
  if (allRail) {
    fillRail(allRail, gamesForCategory(activeCategory));
    mountSectionNav(document, "allRail");
  }
}

function syncTopPlayBtn() {
  const el = document.getElementById("topPlayBtn");
  if (!el) return;
  if (readAccessToken()) {
    el.textContent = "Play";
    const fallback = popularGames()[0] || filterGames(GAMES)[0];
    const path = fallback?.path || "/casino/";
    el.setAttribute("href", withToken(path).pathname + withToken(path).search);
  } else {
    el.textContent = "Login";
    el.setAttribute("href", "/login?next=" + encodeURIComponent("/casino/"));
  }
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".view-all");
  if (!btn) return;
  const rail = document.getElementById(btn.dataset.rail);
  if (!rail) return;
  animateRailTo(rail, rail.scrollLeft + Math.max(280, rail.clientWidth * 0.92), 480);
});

document.getElementById("backBtn").addEventListener("click", leaveCasino);

(function wireCasinoBrowserBack() {
  if (window.AndroidBridge) return;
  try {
    history.pushState({ casinoLobby: true }, "", location.href);
    window.addEventListener("popstate", () => leaveCasino());
  } catch (_) {}
})();

document.addEventListener("click", (e) => {
  if (!e.target.closest(".card") && !e.target.closest(".banner-slide")) {
    clearSelection();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopPreview();
});

try {
  if (window.AndroidBridge) document.body.classList.add("in-app");
  if (
    window.AndroidBridge &&
    typeof window.AndroidBridge.isSystemBarsInsetApplied === "function" &&
    window.AndroidBridge.isSystemBarsInsetApplied()
  ) {
    document.documentElement.classList.add("android-system-bars");
    document.body.classList.add("android-system-bars");
  }
} catch (_) {}

function syncDesktopClass() {
  const w = Math.max(window.innerWidth || 0, document.documentElement.clientWidth || 0);
  const desktop = w >= 768;
  document.documentElement.classList.toggle("is-desktop", desktop);
  document.documentElement.classList.toggle("is-wide", w >= 1200);
}

readAccessToken();
syncDesktopClass();
window.addEventListener("resize", syncDesktopClass);

void (async () => {
  lobbyUsername = await resolveLobbyUsername();
  syncTopPlayBtn();
  render();
})();

window.addEventListener("storage", () => {
  readAccessToken();
  void resolveLobbyUsername().then((u) => {
    lobbyUsername = u;
    syncTopPlayBtn();
    render();
  });
});
window.addEventListener("kokoroko-auth", () => {
  readAccessToken();
  void resolveLobbyUsername().then((u) => {
    lobbyUsername = u;
    syncTopPlayBtn();
    render();
  });
});
setInterval(tickPlayingCounts, 2200);
