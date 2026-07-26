(() => {
  "use strict";

  const BETTING_MS = 7000;
  const TRADING_MS = 13000;
  const SETTLE_MS = 2500;
  const COMMISSION = 0.03;
  const CHIP_AMOUNTS = [10, 20, 50, 100, 500, 1000];

  // Real Gundu API (same pattern as roulette) — no demo balance
  const API_BASE = (() => {
    const host = location.hostname;
    if (host === "127.0.0.1" || host === "localhost") {
      return "http://127.0.0.1:8001/api/trading";
    }
    // Production: /trading/ page → /api/trading/ on same host (or /trading/api/)
    if (location.pathname.startsWith("/trading")) {
      return `${location.origin}/api/trading`;
    }
    return `${location.origin}/api/trading`;
  })();

  const $ = (id) => document.getElementById(id);

  const els = {
    balance: $("balance"),
    betsBanner: $("betsBanner"),
    timerNum: $("timerNum"),
    liveBadge: $("liveBadge"),
    livePct: $("livePct"),
    liveArrow: $("liveArrow"),
    chart: $("chart"),
    miniChart: $("miniChart"),
    resultFlash: $("resultFlash"),
    portfolioValue: $("portfolioValue"),
    cashOutBtn: $("cashOutBtn"),
    betUp: $("betUp"),
    betDown: $("betDown"),
    stakeDisplay: $("stakeDisplay"),
    chipStack: $("chipStack"),
    cashedOutList: $("cashedOutList"),
    upPctLabel: $("upPctLabel"),
    downPctLabel: $("downPctLabel"),
    upAmount: $("upAmount"),
    downAmount: $("downAmount"),
    upPlayers: $("upPlayers"),
    downPlayers: $("downPlayers"),
    sentFillUp: $("sentFillUp"),
    toast: $("toast"),
  };

  const ctx = els.chart.getContext("2d");
  const miniCtx = els.miniChart.getContext("2d");

  // ── Liquid fill animation for sentiment bar ──────────────────────────────
  const liquidUpEl   = document.getElementById("liquidUp");
  const liquidDownEl = document.getElementById("liquidDown");
  const liqCtxUp     = liquidUpEl   ? liquidUpEl.getContext("2d")   : null;
  const liqCtxDown   = liquidDownEl ? liquidDownEl.getContext("2d") : null;

  let liqWave = 0;          // wave phase, advances every frame
  let liqUpLevel   = 0.5;   // current fill level for UP   (0=empty, 1=full)
  let liqDownLevel = 0.5;   // current fill level for DOWN

  function drawLiquid(canvasEl, liqCtx, targetLevel, fillRgb, wavePhase) {
    if (!liqCtx) return;
    const w = canvasEl.offsetWidth;
    const h = canvasEl.offsetHeight;
    if (!w || !h) return;
    canvasEl.width  = w;
    canvasEl.height = h;
    liqCtx.clearRect(0, 0, w, h);

    // Y position of the liquid surface (from top)
    const surfaceY = h * (1 - targetLevel);

    // Draw wavy filled area
    liqCtx.beginPath();
    liqCtx.moveTo(0, h);
    for (let x = 0; x <= w; x++) {
      // Two overlapping sine waves for an organic floating look
      const wave = Math.sin((x / w) * Math.PI * 4 + wavePhase) * 5.5
                 + Math.sin((x / w) * Math.PI * 7 + wavePhase * 1.3) * 3.0;
      liqCtx.lineTo(x, surfaceY + wave);
    }
    liqCtx.lineTo(w, h);
    liqCtx.closePath();

    // Gradient: bright at surface, dark at bottom
    const grad = liqCtx.createLinearGradient(0, surfaceY, 0, h);
    grad.addColorStop(0,   `rgba(${fillRgb}, 0.65)`);
    grad.addColorStop(0.4, `rgba(${fillRgb}, 0.38)`);
    grad.addColorStop(1,   `rgba(${fillRgb}, 0.12)`);
    liqCtx.fillStyle = grad;
    liqCtx.fill();

    // Glowing surface line
    liqCtx.beginPath();
    for (let x = 0; x <= w; x++) {
      const wave = Math.sin((x / w) * Math.PI * 4 + wavePhase) * 5.5
                 + Math.sin((x / w) * Math.PI * 7 + wavePhase * 1.3) * 3.0;
      if (x === 0) liqCtx.moveTo(x, surfaceY + wave);
      else         liqCtx.lineTo(x, surfaceY + wave);
    }
    liqCtx.strokeStyle = `rgba(${fillRgb}, 0.85)`;
    liqCtx.lineWidth = 1.5;
    liqCtx.shadowColor = `rgba(${fillRgb}, 0.9)`;
    liqCtx.shadowBlur  = 5;
    liqCtx.stroke();
    liqCtx.shadowBlur  = 0;
  }

  let liqTick = 0;
  function tickEcg() {
    liqTick++;
    if (liqTick % 2 !== 0) return; // ~30fps

    liqWave += 0.045; // wave scroll speed

    // Smoothly chase target levels from actual sentiment
    // Remap 0–100% → 0.45–0.95 so liquid always fills most of the bar
    const u = state.sentiment.upAmt;
    const d = state.sentiment.downAmt;
    const total = u + d || 1;
    const targetUp   = 0.45 + (u / total) * 0.50;
    const targetDown = 0.45 + (d / total) * 0.50;
    liqUpLevel   += (targetUp   - liqUpLevel)   * 0.04;
    liqDownLevel += (targetDown - liqDownLevel) * 0.04;

    drawLiquid(liquidUpEl,   liqCtxUp,   liqUpLevel,   "20,210,95",  liqWave);
    drawLiquid(liquidDownEl, liqCtxDown, liqDownLevel, "230,50,70",  liqWave + 1.8);
  }

  const state = {
    balance: 0,
    portfolio: 0,
    side: null,
    stake: 10,
    lastStake: 10,
    lastSide: null,
    betHistory: [],
    phase: "betting",
    phaseEndsAt: 0,
    livePct: 0,
    path: [],
    finalPct: 0,
    history: [],
    _roundStake: 0,
    lastWin: 0,
    sentiment: { upAmt: 0, downAmt: 0, upPlayers: 0, downPlayers: 0 },
    cashed: [],
    viewCenter: 0,
    accessToken: null,
    apiReady: false,
    gameRound: null,
    pendingRequest: false,
    lastAnimatedRound: null,
  };

  let toastTimer = null;
  let cashSimTimer = null;

  function money(n) {
    return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function inr(n) {
    return "₹" + money(n);
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function showToast(msg) {
    els.toast.hidden = false;
    els.toast.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2000);
  }

  function readAccessToken() {
    const q = new URLSearchParams(location.search).get("token");
    if (q) {
      localStorage.setItem("gundu_access_token", q);
      return q;
    }
    return (
      localStorage.getItem("gundu_access_token") ||
      localStorage.getItem("access_token") ||
      null
    );
  }

  async function api(pathName, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };
    // Auth optional for public clock (/state/); required for bets/cashout
    if (state.accessToken) {
      headers.Authorization = `Bearer ${state.accessToken}`;
    } else if (options.requireAuth) {
      throw new Error("Login required — open Trading from the app");
    }
    let res;
    try {
      res = await fetch(`${API_BASE}${pathName}`, { ...options, headers });
    } catch (e) {
      throw new Error(`Cannot reach API at ${API_BASE}`);
    }
    let data = null;
    try { data = await res.json(); } catch (_) { data = null; }
    if (res.status === 401) {
      state.apiReady = false;
      throw new Error("Session expired — please login again");
    }
    if (!res.ok) {
      const detail = data?.detail || res.statusText || "request failed";
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }
    return data;
  }

  function pathFromServer(arr) {
    if (!Array.isArray(arr) || !arr.length) return [];
    // Server sends float[] OR already {t,v}
    if (typeof arr[0] === "object" && arr[0] != null && "t" in arr[0]) return arr;
    const n = arr.length;
    return arr.map((v, i) => ({ t: n <= 1 ? 1 : i / (n - 1), v: Number(v) }));
  }

  function applyUserPayload(data) {
    if (typeof data.balance === "number") state.balance = data.balance;
    if (typeof data.portfolio === "number") state.portfolio = data.portfolio;
    const pending = data.pending;
    if (pending) {
      state.side = pending.side;
      state._roundStake = pending.stake;
      if (state.phase === "betting") state.portfolio = pending.stake;
    } else if (data.pending === null) {
      state.side = null;
      state._roundStake = 0;
      if (state.phase !== "trading") state.portfolio = 0;
    }
    const crowd = data.crowd || null;
    if (crowd) {
      state.sentiment.upAmt = crowd.up_amount || 0;
      state.sentiment.downAmt = crowd.down_amount || 0;
      state.sentiment.upPlayers = crowd.up_players || 0;
      state.sentiment.downPlayers = crowd.down_players || 0;
      renderSentiment();
    } else if (data.crowd_up != null || data.crowd_down != null) {
      state.sentiment.upAmt = data.crowd_up || 0;
      state.sentiment.downAmt = data.crowd_down || 0;
      state.sentiment.upPlayers = data.crowd_up_players || 0;
      state.sentiment.downPlayers = data.crowd_down_players || 0;
      renderSentiment();
    }
    syncHud();
  }

  function applyGameClock(game) {
    if (!game) return;
    const phaseMap = { betting: "betting", trading: "trading", result: "settled" };
    const nextPhase = phaseMap[game.phase] || game.phase;
    const round = game.round;
    const secondsLeft = Number(game.seconds_left || 0);
    state.phaseEndsAt = performance.now() + secondsLeft * 1000;
    state.gameRound = round;

    if (Array.isArray(game.cashouts)) {
      state.cashed = game.cashouts.map((c) => ({
        name: c.name || "Player",
        mult: c.mult || 0,
        amt: Number(c.amt || 0),
      }));
      renderCashedOut();
    }
    if (game.crowd) {
      state.sentiment.upAmt = game.crowd.up_amount || 0;
      state.sentiment.downAmt = game.crowd.down_amount || 0;
      state.sentiment.upPlayers = game.crowd.up_players || 0;
      state.sentiment.downPlayers = game.crowd.down_players || 0;
      renderSentiment();
    }

    if (nextPhase === "trading") {
      if (state.phase !== "trading" || state.lastAnimatedRound !== round) {
        state.lastAnimatedRound = round;
        state.finalPct = Number(game.final_pct != null ? game.final_pct : 0);
        // ALWAYS client heavy-spike path — never draw server path
        state.path = generatePath(state.finalPct);
        state.cashed = state.cashed || [];
        // Use full trading window so timeProg matches client path 0→1
        const tradeMs = Number(game.trading_seconds || 13) * 1000;
        setPhase("trading", Math.max(tradeMs * 0.05, secondsLeft * 1000));
        state._tradeDurationMs = tradeMs;
        state._tradeStartedAt = performance.now() - (tradeMs - Math.max(0.2, secondsLeft) * 1000);
        setHostSpeaking(true);
      }
      // livePct follows client path in tick() only
      if (state._roundStake > 0 && state.side) {
        state.portfolio = portfolioFromPct(state.livePct);
      }
    } else if (nextPhase === "settled") {
      if (state.phase !== "settled") {
        state.finalPct = Number(game.final_pct != null ? game.final_pct : game.last_pct || state.finalPct);
        state.livePct = state.finalPct;
        showResultFlash(state.finalPct, typeof game.win === "number" ? game.win : null);
        setPhase("settled", Math.max(0.2, secondsLeft) * 1000);
        if (typeof game.win === "number" && game.win > 0) {
          state.lastWin = game.win;
        }
      }
    } else if (nextPhase === "betting") {
      if (state.phase !== "betting") {
        state.livePct = 0;
        state._roundStake = 0;
        if (!state.side) state.portfolio = 0;
        els.liveBadge.hidden = true;
        els.resultFlash.hidden = true;
        setPhase("betting", Math.max(0.2, secondsLeft) * 1000);
        setHostSpeaking(false);
      } else if (els.timerNum) {
        els.timerNum.textContent = String(Math.max(0, Math.ceil(secondsLeft)));
      }
    }
  }

  function showResultFlash(finalPct, win) {
    els.resultFlash.hidden = false;
    const move = `${finalPct >= 0 ? "+" : ""}${Number(finalPct).toFixed(1)}%`;
    if (state._roundStake > 0 && state.side) {
      const next = portfolioFromPct(finalPct);
      const won =
        (state.side === "up" && finalPct > 0) ||
        (state.side === "down" && finalPct < 0);
      els.resultFlash.className = `result-flash ${won ? "win" : "lose"}`;
      els.resultFlash.textContent = won
        ? `WIN · ${move} · ${win != null ? inr(win) : inr(next)}`
        : `LOSS · ${move}`;
    } else {
      els.resultFlash.className = "result-flash";
      els.resultFlash.textContent = `Closed at ${move}`;
    }
  }

  async function pollState() {
    try {
      // Public endpoint — drives graph/timer even without JWT
      const data = await api("/state/");
      try {
        applyGameClock(data);
      } catch (clockErr) {
        console.warn("applyGameClock", clockErr);
      }
      if (state.accessToken) {
        try { applyUserPayload(data); } catch (_) {}
        state.apiReady = true;
      } else {
        state.apiReady = false;
      }
      syncHud();
    } catch (e) {
      console.warn("poll", e);
    }
  }

  function syncHud() {
    els.balance.textContent = money(state.balance);
    els.portfolioValue.textContent = money(state.portfolio);
    els.stakeDisplay.textContent = state.stake >= 1000 ? (state.stake / 1000) + "K" : String(state.stake);
    syncChipActive();

    const canBet = state.phase === "betting" && state.apiReady;
    els.betUp.disabled = !canBet;
    els.betDown.disabled = !canBet;
    els.betUp.classList.toggle("selected", state.side === "up");
    els.betDown.classList.toggle("selected", state.side === "down");
    els.cashOutBtn.disabled = !(state.phase === "trading" && state.apiReady && state._roundStake > 0);
  }

  function updateLiveBadge(pct) {
    if (state.phase !== "trading") {
      els.liveBadge.hidden = true;
      return;
    }
    els.liveBadge.hidden = false;
    const up = pct >= 0;
    els.liveBadge.classList.toggle("up", up);
    els.liveArrow.textContent = up ? "▲" : "▼";
    els.livePct.textContent = Math.abs(pct).toFixed(0) + "%";
  }

  function setPhase(phase, durationMs) {
    state.phase = phase;
    state.phaseEndsAt = performance.now() + durationMs;

    if (phase === "betting") {
      els.betsBanner.hidden = false;
      els.betsBanner.className = "bets-banner";
      els.betsBanner.innerHTML = `PLACE YOUR BETS <span id="timerNum">${Math.ceil(durationMs / 1000)}</span>`;
      els.timerNum = $("timerNum");
      els.resultFlash.hidden = true;
      stopCashSim();
      setHostSpeaking(false);
    } else if (phase === "trading") {
      els.betsBanner.hidden = true;
      els.resultFlash.hidden = true;
      startCashSim();
      setHostSpeaking(true);
    } else {
      els.betsBanner.hidden = true;
      stopCashSim();
      setHostSpeaking(false);
    }
    syncHud();
  }

  function portfolioFromPct(pct) {
    const stake = state._roundStake || 0;
    if (!stake || !state.side) return 0;
    const aligned = state.side === "up" ? pct : -pct;
    return clamp(stake * (1 + aligned / 100), 0, stake * 2);
  }

  async function placeBet(side) {
    if (!state.accessToken) {
      return showToast("Login required — open Trading from the app");
    }
    if (state.phase !== "betting" || !state.apiReady) {
      return showToast(state.apiReady ? "Wait for betting" : "Login required");
    }
    if (state.pendingRequest) return;
    state.pendingRequest = true;
    try {
      const data = await api("/bets/", {
        method: "POST",
        requireAuth: true,
        body: JSON.stringify({ side, amount: state.stake }),
      });
      state.lastSide = side;
      state.lastStake = state.stake;
      applyUserPayload(data);
      if (data.game) applyGameClock(data.game);
      showToast(side.toUpperCase() + " ₹" + state.stake);
    } catch (e) {
      showToast(e.message || "Bet failed");
    } finally {
      state.pendingRequest = false;
    }
  }

  async function undoBet() {
    if (state.phase !== "betting" || !state.apiReady) return;
    if (state.pendingRequest) return;
    state.pendingRequest = true;
    try {
      const data = await api("/bets/undo/", { method: "POST", requireAuth: true, body: "{}" });
      applyUserPayload(data);
      if (data.game) applyGameClock(data.game);
    } catch (e) {
      showToast(e.message || "Undo failed");
    } finally {
      state.pendingRequest = false;
    }
  }

  function repeatBet() {
    if (state.phase !== "betting" || !state.lastSide) return;
    state.stake = state.lastStake;
    placeBet(state.lastSide);
  }

  async function cashOut() {
    if (state.phase !== "trading" || !state.apiReady) return;
    if (state.pendingRequest) return;
    state.pendingRequest = true;
    try {
      const data = await api("/bets/cashout/", { method: "POST", requireAuth: true, body: "{}" });
      applyUserPayload(data);
      if (data.game) applyGameClock(data.game);
      if (typeof data.payout === "number") {
        showToast("Cashed out " + inr(data.payout));
      }
    } catch (e) {
      showToast(e.message || "Cashout failed");
    } finally {
      state.pendingRequest = false;
    }
  }

  function bumpSentiment(side, amount) {
    if (!side) return;
    if (side === "up") {
      state.sentiment.upAmt = Math.max(0, state.sentiment.upAmt + amount);
      if (amount > 0) state.sentiment.upPlayers += 1;
    } else {
      state.sentiment.downAmt = Math.max(0, state.sentiment.downAmt + amount);
      if (amount > 0) state.sentiment.downPlayers += 1;
    }
    renderSentiment();
  }

  function tickSentimentNoise() {
    // Real crowd from server — no fake noise
  }

  function renderSentiment() {
    const u = state.sentiment.upAmt;
    const d = state.sentiment.downAmt;
    const total = u + d || 1;
    const upPct = Math.round((u / total) * 100);
    const downPct = 100 - upPct;
    els.upPctLabel.textContent = upPct + "%";
    els.downPctLabel.textContent = downPct + "%";
    els.upAmount.textContent = "₹ " + Math.round(u).toLocaleString("en-IN");
    els.downAmount.textContent = "₹ " + Math.round(d).toLocaleString("en-IN");
    els.upPlayers.textContent = String(state.sentiment.upPlayers);
    els.downPlayers.textContent = String(state.sentiment.downPlayers);
    // Resize both the bottom bar AND the background halves together
    els.sentFillUp.style.width = upPct + "%";
    document.getElementById("sentiment").style.gridTemplateColumns = `${upPct}% ${downPct}%`;
  }

  function pushCashedOut(name, mult, amt) {
    state.cashed.unshift({ name, mult, amt });
    if (state.cashed.length > 8) state.cashed.pop();
    renderCashedOut();
  }

  function renderCashedOut() {
    els.cashedOutList.innerHTML = state.cashed.map((c) => `
      <div class="co-row">
        <span class="name">${c.name}</span>
        <span class="mult">+${c.mult}%</span>
        <span class="amt">₹${c.amt.toFixed(2)}</span>
      </div>
    `).join("");
  }

  function startCashSim() {
    // Real cashouts come from server poll (game.cashouts)
    stopCashSim();
  }

  function stopCashSim() {
    clearInterval(cashSimTimer);
    cashSimTimer = null;
  }

  function generatePath(finalPct) {
    const N = 480;
    const points = [];
    let price = 0;
    let velocity = 0;   // momentum — gives the line "inertia" so it overshoots then reverses

    for (let i = 0; i < N; i++) {
      const progress = i / N;

      // ── Mean reversion toward 0 (first 75%) ─────────────────────────────
      // Keeps the line oscillating around center instead of trending one-way
      const meanRevert = -price * 0.04;

      // ── Pull toward final ────────────────────────────────────────────────
      // Last 5%: snap hard → price arrives at finalPct smoothly, no end spike
      // Last 25%: steady pull so line trends toward result
      // Before 55%: free wander, no pull
      const isExtreme = Math.abs(finalPct) >= 70;
      const pull = progress > 0.95
        ? (finalPct - price) * 0.55           // strong snap — eliminates end spike
        : progress > 0.75
          ? (finalPct - price) * (isExtreme ? 0.18 : 0.12)
          : progress > 0.55
            ? (finalPct - price) * (isExtreme ? 0.06 : 0.03)
            : 0;

      // ── Client graph: HEAVY spikes (must be visible — not damped away) ──
      const r = Math.random();
      let noise;
      if (progress > 0.95) {
        noise = rand(-0.5, 0.5);
      } else if (r > 0.96) {
        // Hard spike: jump price directly so the line visibly spikes
        const spike = rand(-22, 22);
        price = clamp(price + spike, -95, 95);
        velocity = spike * 0.2;
        points.push({ t: progress, v: price });
        continue;
      } else if (r > 0.88) {
        noise = rand(-7, 7);
      } else if (progress < 0.15) {
        noise = rand(-4, 4);
      } else {
        noise = rand(-1.5, 1.5);
      }

      // ── Momentum (velocity) ─────────────────────────────────────────────
      velocity = velocity * 0.75 + (meanRevert + pull + noise) * 0.25;
      price = clamp(price + velocity, -95, 95);

      points.push({ t: progress, v: price });
    }

    // Ensure exact landing at finalPct
    points.push({ t: 1, v: finalPct });
    return points;
  }

  function pickFinalPct() {
    let pct;
    const r = Math.random();
    // ~40% chance of extreme move (±70–95%) — so roughly every 2-3 rounds hits near 95
    if (r < 0.40) pct = rand(70, 95) * (Math.random() < 0.5 ? 1 : -1);
    // ~35% chance of strong move (±30–70%)
    else if (r < 0.75) pct = rand(30, 70) * (Math.random() < 0.5 ? 1 : -1);
    // ~25% chance of mild move (±8–30%)
    else pct = rand(8, 30) * (Math.random() < 0.5 ? 1 : -1);
    return Number(pct.toFixed(2));
  }

  function samplePath(progress) {
    if (!state.path.length) return 0;
    const t = clamp(progress, 0, 1);
    for (let i = 1; i < state.path.length; i++) {
      const a = state.path[i - 1];
      const b = state.path[i];
      if (t <= b.t) {
        const u = (t - a.t) / (b.t - a.t || 1);
        return a.v + (b.v - a.v) * u;
      }
    }
    return state.path[state.path.length - 1].v;
  }

  function startTrading() {
    state.cashed = [];
    renderCashedOut();

    if (state.portfolio > 0 && state.side) {
      state._roundStake = state.portfolio;
      state._lastEntry = state.portfolio;
    } else {
      state._roundStake = 0;
      state.side = state.side || null;
    }

    // Fresh chart each round — wipe previous line like Evolution
    state.path = [];
    state.livePct = 0;
    // Don't hard-reset viewCenter — let betting phase ease it back to 0 naturally
    drawChart(0);

    // Path/final come only from shared server clock (applyGameClock)
    setPhase("trading", TRADING_MS);
  }

  function settleRound() {
    state.livePct = state.finalPct;
    updateLiveBadge(state.finalPct);

    if (state._roundStake > 0 && state.side) {
      const next = portfolioFromPct(state.finalPct);
      const won =
        (state.side === "up" && state.finalPct > 0) ||
        (state.side === "down" && state.finalPct < 0);

      state.portfolio = next;
      els.resultFlash.hidden = false;
      els.resultFlash.className = `result-flash ${won ? "win" : "lose"}`;
      const move = `${state.finalPct >= 0 ? "+" : ""}${state.finalPct.toFixed(1)}%`;
      els.resultFlash.textContent = won
        ? `WIN · ${move} · Portfolio ${inr(next)}`
        : `LOSS · ${move} · Portfolio ${inr(next)}`;

      if (next < 0.01) {
        state.portfolio = 0;
        state.side = null;
        state.betHistory = [];
      }
    } else {
      els.resultFlash.hidden = false;
      els.resultFlash.className = "result-flash";
      els.resultFlash.textContent = `Closed at ${state.finalPct >= 0 ? "+" : ""}${state.finalPct.toFixed(1)}%`;
    }

    // Reset crowd sentiment for next round
    state.sentiment = {
      upAmt: Math.round(rand(12000, 22000)),
      downAmt: Math.round(rand(12000, 22000)),
      upPlayers: Math.round(rand(25, 60)),
      downPlayers: Math.round(rand(25, 55)),
    };
    renderSentiment();

    setPhase("settled", SETTLE_MS);
    drawChart(1);
    drawMini();
  }

  function openBetting() {
    state.livePct = 0;
    state._roundStake = 0;
    // Keep last path on screen during betting (like the real game)
    els.liveBadge.hidden = true;
    els.resultFlash.hidden = true;
    setPhase("betting", BETTING_MS);
    drawChart(state.path.length ? 1 : 0);
    drawMini();
  }

  function resizeCanvases() {
    [[els.chart, ctx], [els.miniChart, miniCtx]].forEach(([canvas, c]) => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
  }

  function drawChart(progress) {
    const rect = els.chart.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);

    const centerY = h * 0.5;
    const amp = h * 0.38;
    // Dynamic viewport: price-space center tracks livePct smoothly
    // yAt maps any price value to a canvas Y pixel
    const yAt = (v) => centerY - ((v - state.viewCenter) / 100) * amp;
    const xAt = (t) => t * w;

    // Light grid (fixed pixel rows)
    ctx.strokeStyle = "rgba(120, 140, 170, 0.13)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 5]);
    for (let i = 1; i < 6; i++) {
      const y = (h / 6) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Zero line — floats with the viewport
    const zeroY = yAt(0);
    if (zeroY >= 0 && zeroY <= h) {
      ctx.strokeStyle = "rgba(200, 210, 230, 0.50)";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(0, zeroY);
      ctx.lineTo(w, zeroY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (!state.path.length || progress <= 0) {
      ctx.strokeStyle = "rgba(100, 160, 220, 0.4)";
      ctx.lineWidth = 1.25;
      const startY = yAt(0);
      ctx.beginPath();
      ctx.moveTo(0, startY);
      ctx.lineTo(16, startY);
      ctx.stroke();
      return;
    }

    const visible = [];
    for (const p of state.path) {
      if (p.t > progress) break;
      visible.push(p);
    }
    const tipV = samplePath(progress);
    if (!visible.length || visible[visible.length - 1].t < progress) {
      visible.push({ t: progress, v: tipV });
    }
    if (visible.length < 2) return;

    const up = tipV >= 0;
    // Evolution-style: bright neon green / vivid red
    const color     = up ? "#00e676" : "#ff1744";
    const colorRgb  = up ? "0,230,118"  : "255,23,68";

    // ── Area fill: between the line and the floating zero line ────────────
    const zeroY2 = yAt(0);
    const gFill = up
      ? ctx.createLinearGradient(0, Math.min(zeroY2, 0), 0, zeroY2)
      : ctx.createLinearGradient(0, Math.max(zeroY2, h), 0, zeroY2);

    gFill.addColorStop(0,   `rgba(${colorRgb}, 0.30)`);
    gFill.addColorStop(0.6, `rgba(${colorRgb}, 0.10)`);
    gFill.addColorStop(1,   `rgba(${colorRgb}, 0)`);

    ctx.beginPath();
    ctx.moveTo(xAt(visible[0].t), zeroY2);
    for (let i = 0; i < visible.length; i++) {
      ctx.lineTo(xAt(visible[i].t), yAt(visible[i].v));
    }
    ctx.lineTo(xAt(visible[visible.length - 1].t), zeroY2);
    ctx.closePath();
    ctx.fillStyle = gFill;
    ctx.fill();

    // ── Main line ─────────────────────────────────────────────────────────
    // Pass 1: thick soft glow
    ctx.beginPath();
    for (let i = 0; i < visible.length; i++) {
      const x = xAt(visible[i].t);
      const y = yAt(visible[i].v);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(${colorRgb}, 0.22)`;
    ctx.lineWidth = 6;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowBlur = 0;
    ctx.stroke();

    // Pass 2: crisp sharp line on top
    ctx.beginPath();
    for (let i = 0; i < visible.length; i++) {
      const x = xAt(visible[i].t);
      const y = yAt(visible[i].v);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "miter";
    ctx.miterLimit = 10;
    ctx.lineCap = "square";
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // ── Tip marker ────────────────────────────────────────────────────────
    const last = visible[visible.length - 1];
    const tx = xAt(last.t);
    const ty = yAt(last.v);

    // Outer glow ring
    ctx.beginPath();
    ctx.arc(tx, ty, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${colorRgb}, 0.25)`;
    ctx.fill();
    // Solid dot
    ctx.beginPath();
    ctx.arc(tx, ty, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.fill();
    // White center
    ctx.beginPath();
    ctx.arc(tx, ty, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.shadowBlur = 0;
    ctx.fill();

    if (state.phase === "trading" || state.phase === "settled") {
      const badge = els.liveBadge;
      badge.style.left = clamp(tx, 48, w - 48) + "px";
      badge.style.top = clamp(ty, 28, h - 28) + "px";
      badge.style.transform = "translate(-50%, -130%)";
    }
  }

  function drawMini() {
    const rect = els.miniChart.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    if (!w || !h) return;
    miniCtx.clearRect(0, 0, w, h);

    const data = state.history.length ? state.history : [0];
    const mid = h / 2;
    miniCtx.strokeStyle = "rgba(140,160,190,0.12)";
    miniCtx.lineWidth = 1;
    miniCtx.beginPath();
    miniCtx.moveTo(0, mid);
    miniCtx.lineTo(w, mid);
    miniCtx.stroke();

    // stitch recent round path into mini if trading
    let series = data.slice();
    if (state.phase === "trading" && state.path.length) {
      const progress = 1 - Math.max(0, state.phaseEndsAt - performance.now()) / TRADING_MS;
      for (const p of state.path) {
        if (p.t > progress) break;
        series.push(p.v);
      }
    }

    if (series.length < 2) return;
    const lastV = series[series.length - 1];
    const miniColor = lastV >= 0 ? "0,230,118" : "255,23,68";

    miniCtx.beginPath();
    series.forEach((v, i) => {
      const x = (i / (series.length - 1)) * w;
      const y = mid - (v / 100) * (h * 0.38);
      if (i === 0) miniCtx.moveTo(x, y); else miniCtx.lineTo(x, y);
    });
    miniCtx.strokeStyle = `rgba(${miniColor}, 0.45)`;
    miniCtx.lineWidth = 1;
    miniCtx.shadowColor = `rgba(${miniColor}, 0.6)`;
    miniCtx.shadowBlur = 2;
    miniCtx.stroke();
    miniCtx.shadowBlur = 0;
  }

  function tradingProgress() {
    // Prefer server live_pct mapped onto path; else time-based
    if (!state.path.length) return 0;
    // Find closest path index to livePct for progress estimate
    let bestI = 0;
    let bestD = Infinity;
    for (let i = 0; i < state.path.length; i++) {
      const d = Math.abs(state.path[i].v - state.livePct);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    return bestI / Math.max(1, state.path.length - 1);
  }

  function tick(now) {
    const msLeft = state.phaseEndsAt - now;

    if (state.phase === "betting") {
      if (els.timerNum) els.timerNum.textContent = String(Math.max(0, Math.ceil(msLeft / 1000)));
      state.viewCenter += (0 - state.viewCenter) * 0.02;
      drawChart(state.path.length ? 1 : 0);
      drawMini();
    } else if (state.phase === "trading") {
      // Client heavy-spike path: progress from when this round's path started
      const dur = state._tradeDurationMs || TRADING_MS;
      const started = state._tradeStartedAt || (state.phaseEndsAt - dur);
      // Mild ease-in so the line feels a bit slower early, still finishes on time
      const rawProg = Math.max(0, Math.min(1, (now - started) / dur));
      const timeProg = Math.pow(rawProg, 1.12);
      if (state.path.length) {
        state.livePct = samplePath(timeProg);
      }
      if (state._roundStake > 0 && state.side) state.portfolio = portfolioFromPct(state.livePct);
      state.viewCenter += (state.livePct - state.viewCenter) * 0.04;
      updateLiveBadge(state.livePct);
      syncHud();
      drawChart(timeProg);
      drawMini();
    } else {
      state.viewCenter += (state.finalPct - state.viewCenter) * 0.1;
      drawChart(1);
      drawMini();
    }

    tickEcg();
    requestAnimationFrame(tick);
  }

  // Events
  let chipFanCloseTimer = null;

  function closeChipFan() {
    if (!els.chipStack) return;
    els.chipStack.classList.remove("open");
    els.chipStack.setAttribute("aria-expanded", "false");
    // Keep fan-* classes during close so reverse animation can play
    clearTimeout(chipFanCloseTimer);
    chipFanCloseTimer = setTimeout(() => {
      els.chipStack.querySelectorAll(".chip").forEach((c) => {
        c.classList.remove("fan-0", "fan-1", "fan-2", "fan-3", "fan-4");
      });
    }, 480);
  }

  function openChipFan() {
    if (!els.chipStack) return;
    clearTimeout(chipFanCloseTimer);
    const others = [...els.chipStack.querySelectorAll(".chip")].filter((c) => !c.classList.contains("active"));
    others.forEach((c, i) => {
      c.classList.remove("fan-0", "fan-1", "fan-2", "fan-3", "fan-4");
      c.classList.add(`fan-${Math.min(i, 4)}`);
    });
    // Paint collapsed state first, then open → CSS transition runs
    void els.chipStack.offsetWidth;
    requestAnimationFrame(() => {
      els.chipStack.classList.add("open");
      els.chipStack.setAttribute("aria-expanded", "true");
    });
  }

  function syncChipActive() {
    if (!els.chipStack) return;
    els.chipStack.querySelectorAll(".chip").forEach((c) => {
      const on = Number(c.dataset.amt) === state.stake;
      c.classList.toggle("active", on);
    });
  }

  els.betUp.addEventListener("click", () => placeBet("up"));
  els.betDown.addEventListener("click", () => placeBet("down"));
  els.cashOutBtn.addEventListener("click", cashOut);

  els.chipStack?.querySelectorAll(".chip").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (btn.classList.contains("active")) {
        if (els.chipStack.classList.contains("open")) closeChipFan();
        else openChipFan();
        return;
      }
      state.stake = Number(btn.dataset.amt);
      syncChipActive();
      closeChipFan();
      syncHud();
    });
  });

  document.addEventListener("click", (e) => {
    if (!els.chipStack?.classList.contains("open")) return;
    if (els.chipStack.contains(e.target)) return;
    closeChipFan();
  });

  document.getElementById("deposit")?.addEventListener("click", () => {
    showToast("Deposit from the Gundu app wallet");
  });

  document.getElementById("menuBtn")?.addEventListener("click", () => {
    showToast("Grow More · real wallet · 3% cash-out fee");
  });

  // ── Live host video (speaks continuously while graph/trading runs) ───────
  function getHostVideo() {
    const vid = document.getElementById("hostFace");
    if (!vid || typeof vid.play !== "function") return null;
    vid.muted = true;
    vid.playsInline = true;
    vid.loop = true;
    return vid;
  }

  function setHostSpeaking(on) {
    const vid = getHostVideo();
    if (!vid) return;
    if (on) {
      // Skip short closed-mouth hold at start of the continuous clip
      try { vid.currentTime = 0.35; } catch (_) {}
      vid.play().catch(() => {});
    } else {
      vid.pause();
      try { vid.currentTime = 0; } catch (_) {}
    }
  }

  function startHostTalking() {
    const vid = getHostVideo();
    if (!vid) return;
    // Only speak while the graph is running; resume after first gesture if blocked
    const resumeIfTrading = () => {
      if (state.phase === "trading") setHostSpeaking(true);
    };
    document.addEventListener("click", resumeIfTrading, { once: true });
    document.addEventListener("touchstart", resumeIfTrading, { once: true });
    setHostSpeaking(state.phase === "trading");
  }

  window.addEventListener("resize", () => {
    resizeCanvases();
    drawChart(state.phase === "settled" ? 1 : 0);
    drawMini();
  });

  // Boot — always poll public clock so graph runs; JWT only needed to bet
  resizeCanvases();
  renderSentiment();
  startHostTalking();
  requestAnimationFrame(tick);

  state.accessToken = readAccessToken();
  if (!state.accessToken) {
    state.apiReady = false;
  }
  syncHud();
  // Always start the loop — do not gate setInterval on first poll success
  pollState();
  setInterval(pollState, 350);
})();
