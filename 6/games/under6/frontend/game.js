const PAYOUT = {
  under: 2,
  six: 5,
  over: 2,
};

const API_BASE =
  window.UNDER6_API ||
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? window.location.port === "8010" || window.location.port === "8000"
      ? "/api"
      : "http://127.0.0.1:8010/api"
    : "/api/under-6");
const SESSION_KEY = "under6_session_id";

const state = {
  sessionId: null,
  bankroll: 1000,
  chip: 25,
  side: null,
  busy: false,
};

const els = {
  bankroll: document.getElementById("bankroll"),
  roundInfo: document.getElementById("roundInfo"),
  playSurface: document.getElementById("playSurface"),
  tableScene: document.getElementById("tableScene"),
  card1: document.getElementById("card1"),
  card2: document.getElementById("card2"),
  rig1: document.getElementById("rig1"),
  rig2: document.getElementById("rig2"),
  sumValue: document.getElementById("sumValue"),
  sumOrb: document.getElementById("sumOrb"),
  resultBanner: document.getElementById("resultBanner"),
  outcome: document.getElementById("outcome"),
  dealBtn: document.getElementById("dealBtn"),
  lanes: document.querySelectorAll(".bet-lane"),
  chips: document.querySelectorAll(".chip"),
};

(function captureGunduToken() {
  try {
    const q = new URLSearchParams(location.search);
    const t = q.get("token") || q.get("access_token") || q.get("accessToken");
    if (t) {
      localStorage.setItem("gundu_access_token", t);
      localStorage.setItem("access_token", t);
    }
  } catch (_) {}
})();

async function fetchGunduWalletBalance() {
  const jwt =
    localStorage.getItem("gundu_access_token") ||
    localStorage.getItem("access_token") ||
    "";
  if (!jwt) return null;
  try {
    const r = await fetch("/api/auth/wallet/", {
      headers: {
        Accept: "application/json",
        Authorization: "Bearer " + jwt,
      },
    });
    if (!r.ok) return null;
    const j = await r.json();
    const data = j.data || j;
    const bal = Number(data.balance ?? data.wallet_balance ?? data.available_balance);
    return Number.isFinite(bal) ? bal : null;
  } catch (_) {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function animateMs(ms) {
  await sleep(ms);
}

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

async function applyGunduBankroll() {
  const bal = await fetchGunduWalletBalance();
  if (bal == null || !state.sessionId) return;
  const amount = Math.max(0, Math.floor(bal));
  try {
    const data = await api(`/session/${state.sessionId}/sync/`, {
      method: "POST",
      body: JSON.stringify({ bankroll: amount }),
    });
    state.bankroll = data.bankroll;
    if (els.bankroll) els.bankroll.title = "Your Gundu wallet";
  } catch (_) {
    state.bankroll = amount;
  }
}

async function ensureSession() {
  const gBal = await fetchGunduWalletBalance();
  const seed =
    gBal != null ? { bankroll: Math.max(0, Math.floor(gBal)) } : {};

  const saved = localStorage.getItem(SESSION_KEY);
  if (saved) {
    try {
      const data = await api(`/session/${saved}/`);
      state.sessionId = data.session_id;
      state.bankroll = data.bankroll;
      if (gBal != null) await applyGunduBankroll();
      return;
    } catch {
      localStorage.removeItem(SESSION_KEY);
    }
  }
  const created = await api("/session/", {
    method: "POST",
    body: JSON.stringify(seed),
  });
  state.sessionId = created.session_id;
  state.bankroll = created.bankroll;
  localStorage.setItem(SESSION_KEY, created.session_id);
  if (gBal != null && els.bankroll) els.bankroll.title = "Your Gundu wallet";
}

function resultLabel(side) {
  if (side === "under") return "UNDER";
  if (side === "six") return "SIX";
  return "OVER";
}

function paintCard(el, card) {
  const front = el.querySelector(".card-front");
  front.querySelectorAll(".rank").forEach((node) => {
    node.textContent = card.label;
  });
  front.querySelectorAll(".suit").forEach((node) => {
    node.textContent = card.symbol;
  });
  front.querySelector(".center-suit").textContent = card.symbol;
  front.classList.toggle("red", card.red);
}

function setLanded(rig, landed) {
  const slot = rig.closest(".card-slot");
  if (slot) slot.dataset.landed = landed ? "true" : "false";
}

function setFlipping(card, flipping) {
  const slot = card.closest(".card-slot");
  if (slot) slot.dataset.flipping = flipping ? "true" : "false";
}

function clearTable() {
  for (const [rig, card] of [
    [els.rig1, els.card1],
    [els.rig2, els.card2],
  ]) {
    card.dataset.face = "down";
    card.dataset.flip = "";
    setFlipping(card, false);
    setLanded(rig, false);
    rig.getAnimations?.().forEach((a) => a.cancel());
    rig.style.cssText = "";
    rig.dataset.state = "hidden";
    rig.closest(".card-slot")?.classList.remove("is-revealing");
  }
  if (els.resultBanner) els.resultBanner.hidden = true;
  els.sumOrb.hidden = true;
  els.sumOrb.classList.remove("reveal");
  els.sumValue.textContent = "?";
  els.outcome.textContent = "";
  els.outcome.classList.remove("win", "lose");
  els.lanes.forEach((lane) => lane.classList.remove("winner-flash"));
}

async function dealIn(rig) {
  setLanded(rig, false);
  rig.getAnimations?.().forEach((a) => a.cancel());

  rig.style.transition = "none";
  rig.dataset.state = "deal-start";
  rig.style.opacity = "0";
  rig.style.visibility = "hidden";
  void rig.offsetWidth;

  rig.style.visibility = "visible";
  rig.style.opacity = "1";
  rig.style.transition = "transform 0.75s cubic-bezier(0.16, 0.84, 0.22, 1.08)";
  rig.dataset.state = "dealt";
  setLanded(rig, true);
  await animateMs(780);
}

async function flipCard(card) {
  setFlipping(card, true);
  card.dataset.flip = "out";
  await animateMs(380);
  card.dataset.face = "up";
  card.dataset.flip = "in";
  void card.offsetWidth;
  card.dataset.flip = "";
  await animateMs(420);
  setFlipping(card, false);
}

async function revealWithZoom(card) {
  const slot = card.closest(".card-slot");
  slot?.classList.add("is-revealing");
  await animateMs(280);
  await flipCard(card);
  await animateMs(320);
  slot?.classList.remove("is-revealing");
  await animateMs(200);
}

function updateUI() {
  els.bankroll.textContent = String(state.bankroll);
  els.dealBtn.disabled = !state.side || state.busy || state.bankroll < state.chip;

  if (state.busy) {
    els.roundInfo.textContent = "Dealing…";
  } else if (!state.side) {
    els.roundInfo.textContent = "Pick Under, Six, or Over";
  } else {
    els.roundInfo.textContent = `₹${state.chip} on ${resultLabel(state.side)} — deal when ready`;
  }
}

function setSide(side) {
  if (state.busy) return;
  state.side = side;
  els.lanes.forEach((lane) => {
    lane.classList.toggle("selected", lane.dataset.side === side);
  });
  updateUI();
}

function setChip(amount) {
  if (state.busy) return;
  state.chip = amount;
  els.chips.forEach((chip) => {
    chip.classList.toggle("selected", Number(chip.dataset.amount) === amount);
  });
  updateUI();
}

async function deal() {
  if (state.busy || !state.side || !state.sessionId) return;
  if (state.bankroll < state.chip) {
    els.roundInfo.textContent = "Not enough bankroll";
    return;
  }

  state.busy = true;
  updateUI();
  clearTable();
  els.lanes.forEach((lane) => {
    lane.disabled = true;
  });
  els.chips.forEach((chip) => {
    chip.disabled = true;
  });

  let result;
  try {
    els.roundInfo.textContent = "Dealing…";
    result = await api("/deal/", {
      method: "POST",
      body: JSON.stringify({
        session_id: state.sessionId,
        side: state.side,
        chip: state.chip,
      }),
    });
  } catch (err) {
    state.busy = false;
    els.lanes.forEach((laneEl) => {
      laneEl.disabled = false;
    });
    els.chips.forEach((chip) => {
      chip.disabled = false;
    });
    els.roundInfo.textContent = err.message || "Deal failed";
    updateUI();
    return;
  }

  // Optimistic bankroll from server (stake already deducted server-side)
  state.bankroll = result.bankroll - (result.won ? result.payout : 0);
  updateUI();

  paintCard(els.card1, result.card1);
  paintCard(els.card2, result.card2);

  els.roundInfo.textContent = "Placing cards…";
  await dealIn(els.rig1);
  await sleep(140);
  await dealIn(els.rig2);
  await sleep(400);

  els.roundInfo.textContent = "Revealing…";
  await revealWithZoom(els.card1);
  await sleep(120);
  await revealWithZoom(els.card2);
  await sleep(180);

  els.sumValue.textContent = String(result.sum);
  els.sumOrb.hidden = false;
  els.sumOrb.classList.add("reveal");
  if (els.resultBanner) els.resultBanner.hidden = false;

  const lane = document.querySelector(`.bet-lane[data-side="${result.result_side}"]`);
  if (lane) lane.classList.add("winner-flash");

  state.bankroll = result.bankroll;

  if (result.won) {
    els.outcome.textContent = `You win ₹${result.payout}`;
    els.outcome.classList.add("win");
    els.roundInfo.textContent = `Sum ${result.sum} · You win ₹${result.payout}`;
  } else {
    els.outcome.textContent = `${resultLabel(result.result_side)} hits · you lose`;
    els.outcome.classList.add("lose");
    els.roundInfo.textContent = `Sum ${result.sum} · ${resultLabel(result.result_side)} hits`;
  }

  await sleep(4000);
  clearTable();

  state.busy = false;
  els.lanes.forEach((laneEl) => {
    laneEl.disabled = false;
  });
  els.chips.forEach((chip) => {
    chip.disabled = false;
  });
  updateUI();

  if (state.bankroll <= 0) {
    els.roundInfo.textContent = "Bankroll empty — refresh to replay";
    els.dealBtn.disabled = true;
  }
}

els.lanes.forEach((lane) => {
  lane.addEventListener("click", () => setSide(lane.dataset.side));
});

els.chips.forEach((chip) => {
  chip.addEventListener("click", () => setChip(Number(chip.dataset.amount)));
});

els.dealBtn.addEventListener("click", () => {
  deal();
});

if (els.tableScene) els.tableScene.dataset.camera = "top";
clearTable();
updateUI();

ensureSession()
  .then(() => updateUI())
  .catch((err) => {
    els.roundInfo.textContent = err.message || "Could not start session";
    els.dealBtn.disabled = true;
  });
