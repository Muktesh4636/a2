const API_BASE = "/api/teenpatti";

(function captureGunduToken() {
  try {
    const q = new URLSearchParams(location.search);
    const tok = q.get("token") || q.get("access_token") || q.get("accessToken");
    if (tok) {
      localStorage.setItem("gundu_access_token", tok);
      localStorage.setItem("access_token", tok);
    }
  } catch (_) {}
})();

function gunduJwt() {
  return localStorage.getItem("gundu_access_token") || localStorage.getItem("access_token") || "";
}


const SESSION_KEY = "teenpatti_session_id";

const state = {
  sessionId: null,
  bankroll: 1000,
  chip: 25,
  roundId: null,
  phase: "ante", // ante | decide | busy
  busy: false,
};

const els = {
  bankroll: document.getElementById("bankroll"),
  roundInfo: document.getElementById("roundInfo"),
  tableScene: document.getElementById("tableScene"),
  resultBanner: document.getElementById("resultBanner"),
  sumOrb: document.getElementById("sumOrb"),
  sumValue: document.getElementById("sumValue"),
  handNameLabel: document.getElementById("handNameLabel"),
  outcome: document.getElementById("outcome"),
  dealBtn: document.getElementById("dealBtn"),
  decideBoard: document.getElementById("decideBoard"),
  anteControls: document.getElementById("anteControls"),
  playBtn: document.getElementById("playBtn"),
  foldBtn: document.getElementById("foldBtn"),
  playOdds: document.getElementById("playOdds"),
  chips: document.querySelectorAll(".chip"),
  pRig: [document.getElementById("pRig1"), document.getElementById("pRig2"), document.getElementById("pRig3")],
  pCard: [document.getElementById("pCard1"), document.getElementById("pCard2"), document.getElementById("pCard3")],
  dRig: [document.getElementById("dRig1"), document.getElementById("dRig2"), document.getElementById("dRig3")],
  dCard: [document.getElementById("dCard1"), document.getElementById("dCard2"), document.getElementById("dCard3")],
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", Accept: "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function ensureSession() {
  const saved = localStorage.getItem(SESSION_KEY);
  if (saved) {
    try {
      const data = await api(`/session/${saved}/`);
      state.sessionId = data.session_id;
      state.bankroll = data.bankroll;
      if (data.pending_round) {
        state.roundId = data.pending_round.round_id;
        state.phase = "decide";
        state.chip = data.pending_round.ante;
        paintHand(els.pCard, data.pending_round.player_cards);
        for (const rig of els.pRig) {
          rig.dataset.state = "dealt";
          setLanded(rig, true);
        }
        for (const card of els.pCard) card.dataset.face = "up";
        for (const rig of els.dRig) {
          rig.dataset.state = "dealt";
          setLanded(rig, true);
        }
        els.decideBoard.hidden = false;
        els.anteControls.hidden = true;
        els.playOdds.textContent = `Match ₹${state.chip}`;
      }
      return;
    } catch {
      localStorage.removeItem(SESSION_KEY);
    }
  }
  const created = await api("/session/", { method: "POST", body: "{}" });
  state.sessionId = created.session_id;
  state.bankroll = created.bankroll;
  localStorage.setItem(SESSION_KEY, created.session_id);
}

function paintCard(el, card) {
  const front = el.querySelector(".card-front");
  front.querySelectorAll(".rank").forEach((n) => {
    n.textContent = card.label;
  });
  front.querySelectorAll(".suit").forEach((n) => {
    n.textContent = card.symbol;
  });
  front.querySelector(".center-suit").textContent = card.symbol;
  front.classList.toggle("red", card.red);
}

function paintHand(cardEls, cards) {
  cards.forEach((card, i) => paintCard(cardEls[i], card));
}

function setLanded(rig, landed) {
  const slot = rig.closest(".card-slot");
  if (slot) slot.dataset.landed = landed ? "true" : "false";
}

function setFlipping(card, flipping) {
  const slot = card.closest(".card-slot");
  if (slot) slot.dataset.flipping = flipping ? "true" : "false";
}

function resetRig(rig, card) {
  card.dataset.face = "down";
  card.dataset.flip = "";
  setFlipping(card, false);
  setLanded(rig, false);
  rig.getAnimations?.().forEach((a) => a.cancel());
  rig.style.cssText = "";
  rig.dataset.state = "hidden";
  rig.closest(".card-slot")?.classList.remove("is-revealing");
}

function clearTable() {
  for (let i = 0; i < 3; i++) {
    resetRig(els.pRig[i], els.pCard[i]);
    resetRig(els.dRig[i], els.dCard[i]);
  }
  if (els.resultBanner) els.resultBanner.hidden = true;
  els.sumOrb.hidden = true;
  els.sumOrb.classList.remove("reveal");
  els.sumValue.textContent = "—";
  els.handNameLabel.textContent = "Hand";
  els.outcome.textContent = "";
  els.outcome.classList.remove("win", "lose");
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
  rig.style.transition = "transform 0.55s cubic-bezier(0.16, 0.84, 0.22, 1.08)";
  rig.dataset.state = "dealt";
  setLanded(rig, true);
  try { window.CardSfx && CardSfx.deal(); } catch (_) {}
  await sleep(560);
}

async function flipCard(card) {
  try { window.CardSfx && CardSfx.flip(); } catch (_) {}
  setFlipping(card, true);
  card.dataset.flip = "out";
  await sleep(280);
  card.dataset.face = "up";
  card.dataset.flip = "in";
  void card.offsetWidth;
  card.dataset.flip = "";
  await sleep(300);
  setFlipping(card, false);
}

async function revealWithZoom(card) {
  const slot = card.closest(".card-slot");
  slot?.classList.add("is-revealing");
  await sleep(160);
  await flipCard(card);
  await sleep(180);
  slot?.classList.remove("is-revealing");
  await sleep(100);
}

function outcomeCopy(result) {
  switch (result.outcome) {
    case "fold":
      return { text: `Folded · lost ante ₹${result.ante}`, cls: "lose" };
    case "dealer_nq":
      return {
        text: `Dealer fails Queen high · ante pays · +₹${result.payout - result.ante - result.play_chip}`,
        cls: "win",
      };
    case "tie":
      return { text: "Tie · stakes returned", cls: "" };
    case "player_win":
      return {
        text: `You win · ${result.player_hand_label} · ₹${result.payout}`,
        cls: "win",
      };
    case "dealer_win":
      return {
        text: `Dealer wins · ${result.dealer_hand_label}`,
        cls: "lose",
      };
    default:
      return { text: result.outcome || "", cls: "" };
  }
}

function updateUI() {
  els.bankroll.textContent = String(state.bankroll);
  const deciding = state.phase === "decide";
  els.decideBoard.hidden = !deciding;
  els.anteControls.hidden = deciding;
  els.dealBtn.disabled = deciding || state.busy || state.bankroll < state.chip;

  if (state.busy) els.roundInfo.textContent = "Working…";
  else if (deciding) {
    els.roundInfo.textContent = `Ante ₹${state.chip} down — Play (₹${state.chip}) or Fold`;
    els.playOdds.textContent = `Match ₹${state.chip}`;
    els.playBtn.disabled = state.bankroll < state.chip;
  } else {
    els.roundInfo.textContent = `Ante ₹${state.chip} — deal when ready`;
  }
}

function setChip(amount) {
  try { window.CardSfx && CardSfx.unlock(); } catch (_) {}
  if (state.busy || state.phase === "decide") return;
  state.chip = amount;
  try { window.CardSfx && CardSfx.bet(); } catch (_) {}
  els.chips.forEach((chip) => chip.classList.toggle("selected", Number(chip.dataset.amount) === amount));
  updateUI();
}

async function deal() {
  try { window.CardSfx && CardSfx.unlock(); } catch (_) {}
  if (state.busy || state.phase !== "ante" || !state.sessionId) return;
  if (state.bankroll < state.chip) {
    els.roundInfo.textContent = "Not enough bankroll";
    return;
  }

  state.busy = true;
  updateUI();
  clearTable();
  els.chips.forEach((c) => {
    c.disabled = true;
  });

  let result;
  try {
    result = await api("/deal/", {
      method: "POST",
      body: JSON.stringify({ session_id: state.sessionId, chip: state.chip }),
    });
  } catch (err) {
    state.busy = false;
    els.chips.forEach((c) => {
      c.disabled = false;
    });
    els.roundInfo.textContent = err.message || "Deal failed";
    updateUI();
    return;
  }

  state.bankroll = result.bankroll;
  state.roundId = result.round_id;
  state.chip = result.ante;
  updateUI();

  paintHand(els.pCard, result.player_cards);

  els.roundInfo.textContent = "Dealing…";
  for (let i = 0; i < 3; i++) {
    await dealIn(els.dRig[i]);
    await sleep(60);
    await dealIn(els.pRig[i]);
    await sleep(60);
  }

  els.roundInfo.textContent = "Your cards…";
  for (let i = 0; i < 3; i++) {
    await revealWithZoom(els.pCard[i]);
  }

  if (els.resultBanner) els.resultBanner.hidden = false;
  els.sumOrb.hidden = false;
  els.sumOrb.classList.add("reveal");
  els.handNameLabel.textContent = "You";
  els.sumValue.textContent = result.player_hand_label;
  els.outcome.textContent = "Play or Fold";

  state.phase = "decide";
  state.busy = false;
  els.chips.forEach((c) => {
    c.disabled = false;
  });
  updateUI();
}

async function decide(action) {
  try { window.CardSfx && CardSfx.bet(); } catch (_) {}
  if (state.busy || state.phase !== "decide" || !state.roundId) return;
  if (action === "play" && state.bankroll < state.chip) {
    els.roundInfo.textContent = "Not enough bankroll to Play";
    return;
  }

  state.busy = true;
  updateUI();
  els.playBtn.disabled = true;
  els.foldBtn.disabled = true;

  let result;
  try {
    result = await api("/decide/", {
      method: "POST",
      body: JSON.stringify({
        session_id: state.sessionId,
        round_id: state.roundId,
        action,
      }),
    });
  } catch (err) {
    state.busy = false;
    els.playBtn.disabled = false;
    els.foldBtn.disabled = false;
    els.roundInfo.textContent = err.message || "Action failed";
    updateUI();
    return;
  }

  if (action === "play") {
    state.bankroll = result.bankroll - result.payout;
    updateUI();
  }

  paintHand(els.dCard, result.dealer_cards);
  els.roundInfo.textContent = "Dealer reveals…";
  for (let i = 0; i < 3; i++) {
    await revealWithZoom(els.dCard[i]);
  }

  els.handNameLabel.textContent = "Show";
  els.sumValue.textContent = result.player_hand_label;
  const copy = outcomeCopy(result);
  els.outcome.textContent = copy.text;
  els.outcome.classList.remove("win", "lose");
  if (copy.cls) els.outcome.classList.add(copy.cls);
  try {
    if (copy.cls === "win") window.CardSfx && CardSfx.win();
    else if (copy.cls === "lose") window.CardSfx && CardSfx.lose();
  } catch (_) {}

  if (result.outcome === "dealer_nq") {
    els.roundInfo.textContent = `Dealer ${result.dealer_hand_label} · not qualified`;
  } else if (result.outcome === "fold") {
    els.roundInfo.textContent = "Packed";
  } else {
    els.roundInfo.textContent = `You ${result.player_hand_label} · Dealer ${result.dealer_hand_label}`;
  }

  state.bankroll = result.bankroll;
  updateUI();

  await sleep(4000);
  clearTable();
  state.roundId = null;
  state.phase = "ante";
  state.busy = false;
  els.playBtn.disabled = false;
  els.foldBtn.disabled = false;
  updateUI();
  if (state.bankroll <= 0) {
    els.roundInfo.textContent = "Bankroll empty — refresh to replay";
    els.dealBtn.disabled = true;
  }
}

els.chips.forEach((chip) => chip.addEventListener("click", () => setChip(Number(chip.dataset.amount))));
els.dealBtn.addEventListener("click", () => deal());
els.playBtn.addEventListener("click", () => decide("play"));
els.foldBtn.addEventListener("click", () => decide("fold"));
if (els.tableScene) els.tableScene.dataset.camera = "top";
clearTable();
updateUI();

ensureSession()
  .then(() => updateUI())
  .catch((err) => {
    els.roundInfo.textContent = err.message || "Could not start session";
    els.dealBtn.disabled = true;
  });
