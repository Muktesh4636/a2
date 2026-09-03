/**
 * Vortex 2 VIP — game logic (UI + Django API)
 * Rings: ./js/rings.js
 * Reel: ./js/reel.js
 * Bottom controls: ./js/controls.js
 * Backend: /api/* (Django in backend/)
 */
import { createRingBoard } from "./rings.js";
import { createControls } from "./controls.js";
import { createReel } from "./reel.js";
import { fetchState, postBet, postSpin, postCashout, postPart } from "./api.js";

const $ = (id) => document.getElementById(id);

const board = createRingBoard($("board"));

const SPIN_CRUISE_MS = 3800;
const SPIN_STOP_MS = 1700;
const SPIN_STOP_TURBO_MS = 900;

/**
 * Continuous cruise roll — full spin.wav loop (original wheel sound).
 * Slows with the reel when coasting.
 */
const soundBase = new URL("./sounds/", location.href).href;

const makeAudio = (file, { loop = false, volume = 0.85 } = {}) => {
  try {
    const a = new Audio(`${soundBase}${file}`);
    a.preload = "auto";
    a.loop = loop;
    a.volume = volume;
    a.load();
    return a;
  } catch (_) {
    return null;
  }
};

const cruiseA = makeAudio("spin.wav", { loop: true, volume: 0.8 });
const cruiseB = makeAudio("spin.wav", { loop: true, volume: 0.8 });

let cruiseActive = false;
let cruiseKeepalive = null;
let cruisePrimary = "a";
let coastRaf = 0;

const rateForCoast = (t) => {
  const eased = 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 2.75);
  return Math.max(0.28, 1.05 - eased * 0.77);
};

const activeCruise = () => (cruisePrimary === "a" ? cruiseA : cruiseB);
const otherCruise = () => (cruisePrimary === "a" ? cruiseB : cruiseA);

const clearCoastRaf = () => {
  if (coastRaf) {
    cancelAnimationFrame(coastRaf);
    coastRaf = 0;
  }
};

const clearCruiseKeepalive = () => {
  if (cruiseKeepalive) {
    clearInterval(cruiseKeepalive);
    cruiseKeepalive = null;
  }
};

const playOneCruise = (a) => {
  if (!a) return;
  try {
    a.loop = true;
    a.volume = 0.8;
    a.playbackRate = 1.05;
    a.muted = false;
    if (a.paused || a.ended || a.currentTime > 0.2) a.currentTime = 0;
    const p = a.play();
    if (p && typeof p.catch === "function") void p.catch(() => {});
  } catch (_) {}
};

const stopOneCruise = (a) => {
  if (!a) return;
  try {
    a.pause();
    a.currentTime = 0;
    a.playbackRate = 1;
    a.volume = 0.8;
  } catch (_) {}
};

const playCruiseSound = () => {
  clearCoastRaf();
  cruiseActive = true;
  clearCruiseKeepalive();
  playOneCruise(cruiseA);
  cruisePrimary = "a";
  stopOneCruise(cruiseB);
  cruiseKeepalive = setInterval(() => {
    if (!cruiseActive) return;
    const cur = activeCruise();
    if (cur && !cur.paused && !cur.ended) return;
    cruisePrimary = cruisePrimary === "a" ? "b" : "a";
    playOneCruise(activeCruise());
    stopOneCruise(otherCruise());
  }, 300);
};

const stopCruiseSound = () => {
  cruiseActive = false;
  clearCoastRaf();
  clearCruiseKeepalive();
  stopOneCruise(cruiseA);
  stopOneCruise(cruiseB);
};

/** Slow the roll sound down with the reel coast (same duration as stopOn). */
const playEndSound = (durationMs = SPIN_STOP_MS) => {
  clearCruiseKeepalive();
  cruiseActive = false;
  const cur = activeCruise();
  if (!cur || cur.paused) return;
  clearCoastRaf();
  const startAt = performance.now();
  const tick = (ts) => {
    const t = Math.min(1, (ts - startAt) / Math.max(1, durationMs));
    try {
      cur.playbackRate = rateForCoast(t);
      cur.volume = Math.max(0, 0.8 * (1 - t * 0.85));
    } catch (_) {}
    if (t < 1) coastRaf = requestAnimationFrame(tick);
    else stopCruiseSound();
  };
  coastRaf = requestAnimationFrame(tick);
};

const stopEndSound = () => {
  stopCruiseSound();
};

// Reel has no per-tick SFX — continuous loop covers the scroll sound.
const reel = createReel($("core"));

let balance = 0;
let bet = 10;
let busy = false;
let auto = false;
let turbo = false;
let fill = { water: 0, earth: 0, fire: 0 };
let canPartFlag = false;
let partAmt = 0;
let totalM = 0;
let payoutAmt = 0;

const fmt = (n) => Number(n || 0).toLocaleString("en-IN");
const delay = (ms) => new Promise((r) => setTimeout(r, turbo ? ms * 0.45 : ms));

const isSnap = (data) =>
  !!data &&
  typeof data === "object" &&
  data.fill &&
  typeof data.fill === "object" &&
  typeof data.balance === "number";

const applyState = (data) => {
  if (!isSnap(data)) return false;
  balance = Number(data.balance) || 0;
  bet = Number(data.bet) || bet || 10;
  fill = {
    water: Number(data.fill.water) || 0,
    earth: Number(data.fill.earth) || 0,
    fire: Number(data.fill.fire) || 0,
  };
  canPartFlag = !!data.can_part;
  partAmt = Number(data.part_amount) || 0;
  totalM = Number(data.total_mult) || 0;
  payoutAmt =
    typeof data.payout === "number"
      ? data.payout
      : Math.round(bet * totalM);
  return true;
};

const recoverState = async () => {
  try {
    applyState(await fetchState());
  } catch (_) {
    /* keep last good local state */
  }
};

const syncBoard = async (animate = true, changed = null) => {
  if (!animate) {
    board.setVisual({ ...fill });
    board.drawBoard();
    return;
  }
  const prev = board.getVisual();
  const keys = ["water", "earth", "fire"].filter((k) => {
    if (changed && changed.length) return changed.includes(k);
    return Math.abs((prev[k] || 0) - fill[k]) > 0.001;
  });
  if (!keys.length) {
    board.setVisual({ ...fill });
    board.drawBoard();
    return;
  }
  await Promise.all(keys.map((k) => board.animateFillTo(k, fill[k], { turbo })));
  board.setVisual({ ...fill });
  board.drawBoard();
};

const toast = (msg) => {
  if (!msg) return;
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1600);
};

const render = () => {
  $("gameBalance").textContent = fmt(balance);
  const progress =
    (Number(fill.water) || 0) + (Number(fill.earth) || 0) + (Number(fill.fire) || 0);
  controls.update({
    bet,
    payoutText: progress > 0 ? fmt(payoutAmt || Math.round(bet * totalM)) : "0",
    partText: canPartFlag ? `₹${fmt(partAmt)}` : "-",
    hasProgress: progress > 0,
    canPart: canPartFlag,
    busy,
    auto,
  });
};

const scheduleAuto = async () => {
  if (!auto) return;
  await delay(400);
  if (!auto) return;
  if (busy) {
    // retry once busy clears
    await delay(200);
    if (auto && !busy) spin();
    else if (auto) scheduleAuto();
    return;
  }
  spin();
};

const cashOut = async (partial) => {
  if (busy) return;
  busy = true;
  render();
  try {
    const data = partial ? await postPart() : await postCashout();
    if (!applyState(data)) await recoverState();
    toast(data.message);
    await syncBoard(true);
    if (!partial) reel.setFaceInstant("fire");
  } catch (e) {
    toast(e.message || "Cash out failed");
    if (isSnap(e.data)) applyState(e.data);
    else await recoverState();
  } finally {
    busy = false;
    render();
    board.drawBoard();
  }
};

const spin = async () => {
  if (busy) return;
  if (balance < bet) {
    auto = false;
    toast("Not enough balance");
    render();
    return;
  }

  busy = true;
  controls.setSpinning(true);
  const prevBalance = balance;
  balance = +(balance - bet);
  render();

  // Start continuous roll sound + reel together (no per-tick lag)
  playCruiseSound();
  reel.startSpin();
  const cruiseMs = turbo ? Math.round(SPIN_CRUISE_MS * 0.45) : SPIN_CRUISE_MS;
  const spunAt = performance.now();

  try {
    const data = await postSpin();
    const wait = Math.max(0, cruiseMs - (performance.now() - spunAt));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    if (!applyState(data)) await recoverState();
    playEndSound(turbo ? SPIN_STOP_TURBO_MS : SPIN_STOP_MS);
    await reel.stopOn(data.drop || "fire", {
      turbo,
      durationMs: turbo ? SPIN_STOP_TURBO_MS : SPIN_STOP_MS,
    });
    toast(data.message);
    await syncBoard(true, data.changed || null);
  } catch (e) {
    toast(e.message || "Spin failed");
    auto = false;
    try {
      if (isSnap(e.data)) {
        applyState(e.data);
        playEndSound(SPIN_STOP_TURBO_MS);
        await reel.stopOn(e.data.drop || reel.getFace(), {
          turbo: true,
          durationMs: SPIN_STOP_TURBO_MS,
        });
      } else {
        balance = prevBalance;
        await recoverState();
        reel.setFaceInstant(reel.getFace());
      }
      await syncBoard(false);
    } catch {
      balance = prevBalance;
      reel.setFaceInstant("fire");
    }
  } finally {
    stopEndSound();
    busy = false;
    controls.setSpinning(false);
    render();
    board.drawBoard();
  }

  if (auto) scheduleAuto();
};

const controls = createControls({
  getBet: () => bet,
  setBet: async (v) => {
    const prev = bet;
    bet = v;
    render();
    try {
      const data = await postBet(v);
      if (!applyState(data)) await recoverState();
      render();
    } catch (e) {
      bet = prev;
      toast(e.message || "Bet update failed");
      await recoverState();
      render();
    }
  },
  isBusy: () => busy,
  onSpin: spin,
  onCashOut: () => cashOut(false),
  onPart: () => cashOut(true),
  onAutoToggle: () => {
    auto = !auto;
    render();
    if (auto && !busy) spin();
  },
});

// Shell UI
$("demoClose").onclick = () => $("demoTab").classList.add("hidden");

const howto = $("howto");
const closeHowto = () => {
  if (!howto) return;
  howto.classList.add("hidden");
  try {
    localStorage.setItem("vortex_howto_seen", "1");
  } catch (_) {}
};
if (howto) {
  howto.onclick = closeHowto;
  $("howtoClose")?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeHowto();
  });
  try {
    if (localStorage.getItem("vortex_howto_seen") === "1") {
      howto.classList.add("hidden");
    }
  } catch (_) {}
}

const boot = async () => {
  reel.setFaceInstant("fire");
  try {
    applyState(await fetchState());
  } catch (e) {
    toast(e.message || "Login required — open from the app");
  }
  board.setVisual({ ...fill });
  render();
  board.drawBoard();
};

function readToken() {
  const params = new URLSearchParams(location.search);
  return (
    params.get("token") ||
    localStorage.getItem("gundu_access_token") ||
    localStorage.getItem("access_token") ||
    ""
  );
}

function casinoUrl() {
  const u = new URL("/casino/", location.origin);
  const token = readToken();
  if (token) u.searchParams.set("token", token);
  return u.toString();
}
function goCasino() {
  try {
    if (window.AndroidBridge?.goBack) {
      window.AndroidBridge.goBack();
      return;
    }
  } catch (_) {}
  try {
    if (sessionStorage.getItem("gundu_from_casino") === "1" || (document.referrer || "").includes("/casino")) {
      sessionStorage.removeItem("gundu_from_casino");
      history.back();
      setTimeout(() => {
        if (!location.pathname.includes("/casino")) location.replace(casinoUrl());
      }, 450);
      return;
    }
  } catch (_) {}
  location.replace(casinoUrl());
}

function goDeposit() {
  const token = readToken();
  try {
    if (window.AndroidBridge?.openDeposit) {
      window.AndroidBridge.openDeposit(token || "");
      return;
    }
    if (window.Android?.openDeposit) {
      window.Android.openDeposit(token || "");
      return;
    }
    if (window.ReactNativeWebView?.postMessage) {
      window.ReactNativeWebView.postMessage(
        JSON.stringify({ type: "deposit", action: "open", token: token || "" })
      );
      return;
    }
  } catch (_) {}
  const u = new URL("/deposit", location.origin);
  if (token) u.searchParams.set("token", token);
  location.href = u.toString();
}

function setTheme(mode) {
  const dark = mode === "dark";
  document.body.classList.toggle("theme-dark", dark);
  document.body.classList.toggle("theme-light", !dark);
  try {
    localStorage.setItem("vortex_theme", dark ? "dark" : "light");
  } catch (_) {}
  $("themeLightBtn")?.classList.toggle("is-on", !dark);
  $("themeDarkBtn")?.classList.toggle("is-on", dark);
  $("themeLightBtn")?.setAttribute("aria-pressed", String(!dark));
  $("themeDarkBtn")?.setAttribute("aria-pressed", String(dark));
  board.drawBoard();
}

function initTheme() {
  let saved = "dark";
  try {
    saved = localStorage.getItem("vortex_theme") || "dark";
  } catch (_) {}
  setTheme(saved === "light" ? "light" : "dark");
  $("themeLightBtn")?.addEventListener("click", () => setTheme("light"));
  $("themeDarkBtn")?.addEventListener("click", () => setTheme("dark"));
}

$("gunduBackBtn")?.addEventListener("click", goCasino);
$("depositBtn")?.addEventListener("click", goDeposit);
initTheme();
try {
  if ((document.referrer || "").includes("/casino")) {
    sessionStorage.setItem("gundu_from_casino", "1");
  }
} catch (_) {}

boot();
