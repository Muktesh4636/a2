/**
 * Vortex 1 — game logic (UI + Django API)
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
const reel = createReel($("core"));

let balance = 1000;
let bet = 1;
let busy = false;
let auto = false;
let turbo = false;
let fill = { water: 0, earth: 0, fire: 0 };
let canPartFlag = false;
let partAmt = 0;
let totalM = 0;

const fmt = (n) => (Math.round(n * 100) / 100).toFixed(2);
const delay = (ms) => new Promise((r) => setTimeout(r, turbo ? ms * 0.45 : ms));

const applyState = (data) => {
  balance = data.balance;
  bet = data.bet;
  fill = { ...data.fill };
  canPartFlag = !!data.can_part;
  partAmt = data.part_amount || 0;
  totalM = data.total_mult || 0;
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
  // Ensure untouched rings stay exact
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
  controls.update({
    bet,
    payoutText: totalM ? fmt(bet * totalM) : "0.00",
    partText: canPartFlag ? `$${fmt(partAmt)}` : "-",
    hasProgress: fill.water + fill.earth + fill.fire > 0,
    canPart: canPartFlag,
    busy,
    auto,
  });
};

const cashOut = async (partial) => {
  if (busy) return;
  busy = true;
  render();
  try {
    const data = partial ? await postPart() : await postCashout();
    applyState(data);
    toast(data.message);
    await syncBoard(true);
    if (!partial) reel.setFaceInstant("fire");
  } catch (e) {
    toast(e.message || "Cash out failed");
    if (e.data) applyState(e.data);
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
  render();

  balance = +(balance - bet).toFixed(2);
  render();

  // Vertical reel races while the server rolls the result
  reel.startSpin();
  const minSpinMs = turbo ? 180 : 350;
  const spunAt = performance.now();

  try {
    const data = await postSpin();
    const wait = Math.max(0, minSpinMs - (performance.now() - spunAt));
    if (wait) await delay(wait);
    applyState(data);
    await reel.stopOn(data.drop || "fire", { turbo });
    toast(data.message);
    await syncBoard(true, data.changed || null);
  } catch (e) {
    toast(e.message || "Spin failed");
    if (e.data) {
      applyState(e.data);
      await reel.stopOn(e.data.drop || reel.getFace(), { turbo: true });
      await syncBoard(false);
    } else {
      try {
        applyState(await fetchState());
        reel.setFaceInstant(reel.getFace());
        await syncBoard(false);
      } catch {
        reel.setFaceInstant("fire");
      }
    }
    auto = false;
  }

  busy = false;
  controls.setSpinning(false);
  render();
  board.drawBoard();

  if (auto) {
    await delay(400);
    if (auto) spin();
  }
};

const controls = createControls({
  getBet: () => bet,
  setBet: async (v) => {
    bet = v;
    render();
    try {
      const data = await postBet(v);
      applyState(data);
      render();
    } catch (e) {
      toast(e.message || "Bet update failed");
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
const closeHowto = () => howto.classList.add("hidden");
howto.onclick = closeHowto;
$("howtoClose").onclick = (e) => {
  e.stopPropagation();
  closeHowto();
};

const boot = async () => {
  reel.setFaceInstant("fire");
  try {
    applyState(await fetchState());
  } catch {
    toast("Backend offline — start Django in backend/");
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
  location.href = casinoUrl();
}

$("gunduBackBtn")?.addEventListener("click", goCasino);
try {
  history.pushState({ gundu_game: "vortex-1" }, "", location.href);
  window.addEventListener("popstate", () => {
    location.replace(casinoUrl());
  });
} catch (_) {}

boot();
