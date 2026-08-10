(() => {
  "use strict";

  const BETTING_MS = 7000;
  const TRADING_MS = 13000;
  const SETTLE_MS = 2500;
  const COMMISSION = 0.03;
  const CHIP_AMOUNTS = [10, 20, 50, 100, 500, 1000];
  const chipSfx = (() => {
    try {
      const a = new Audio(new URL("sounds/chip.wav", location.origin + "/trading/").href);
      a.preload = "auto";
      a.volume = 0.75;
      return a;
    } catch (_) {
      return null;
    }
  })();

  function playChipSound() {
    if (!chipSfx) return;
    try {
      chipSfx.currentTime = 0;
      void chipSfx.play();
    } catch (_) {}
  }

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
    chipSlotUp: $("chipSlotUp"),
    chipSlotDown: $("chipSlotDown"),
    totalBet: $("totalBet"),
    footerBalance: $("footerBalance"),
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
    holdGraphBlur: false,
    chipPlacements: [], // [{ side, amount }]
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

  function chipColorFor(amount) {
    const n = Math.max(0, Number(amount) || 0);
    // Range → chip art: 10–19→10, 20–49→20, 50–99→50, 100–499→100, 500–999→500, 1000+→1000
    if (n >= 1000) return 1000;
    if (n >= 500) return 500;
    if (n >= 100) return 100;
    if (n >= 50) return 50;
    if (n >= 20) return 20;
    if (n >= 10) return 10;
    return 10;
  }

  function chipAmountText(amount) {
    const n = Math.round(Number(amount) || 0);
    if (n >= 1000 && n % 1000 === 0) return `${n / 1000}K`;
    return String(n);
  }

  function chipAssetUrl(amount) {
    const color = chipColorFor(amount);
    // Always resolve under /trading/ even if the page URL has no trailing slash
    try {
      return new URL(`chips/chip-${color}.png`, location.origin + "/trading/").href;
    } catch (_) {
      return `chips/chip-${color}.png`;
    }
  }

  function chipSlotEl(side) {
    return side === "up" ? els.chipSlotUp : els.chipSlotDown;
  }

  function sideStakeTotal(side) {
    return state.chipPlacements
      .filter((c) => c.side === side)
      .reduce((a, c) => a + Number(c.amount || 0), 0);
  }

  function isChipFlyInProgress() {
    return !!(
      els.chipSlotUp?.classList.contains("awaiting-chip") ||
      els.chipSlotDown?.classList.contains("awaiting-chip")
    );
  }

  function renderPlacedChips() {
    for (const side of ["up", "down"]) {
      const slot = chipSlotEl(side);
      if (!slot) continue;
      const total = sideStakeTotal(side);
      slot.innerHTML = "";
      slot.classList.toggle("has-chips", total > 0);
      if (total <= 0) continue;
      const el = document.createElement("span");
      el.className = "placed-chip";
      el.dataset.chip = String(chipColorFor(total));
      el.style.backgroundImage = `url("${chipAssetUrl(total)}")`;
      el.title = `₹${total}`;
      // Opaque center so PNG denomination is hidden; show REAL total (e.g. 30 on 20-color)
      const cover = document.createElement("span");
      cover.className = "chip-cover";
      const label = document.createElement("span");
      label.className = "chip-amt";
      const text = chipAmountText(total);
      label.textContent = text;
      if (text.length >= 4) label.classList.add("len-4");
      else if (text.length >= 3) label.classList.add("len-3");
      cover.appendChild(label);
      el.appendChild(cover);
      slot.appendChild(el);
    }
    els.betUp?.classList.toggle("selected", sideStakeTotal("up") > 0);
    els.betDown?.classList.toggle("selected", sideStakeTotal("down") > 0);
  }

  function clearPlacedChips() {
    state.chipPlacements = [];
    renderPlacedChips();
  }

  function setSideStake(side, total) {
    const amt = Math.max(0, Number(total) || 0);
    state.chipPlacements = amt > 0 ? [{ side, amount: amt }] : [];
  }

  function flyChipToSide(side, addAmount, totalAfter) {
    const add = Number(addAmount) || state.stake;
    const total = Number(totalAfter) > 0 ? Number(totalAfter) : sideStakeTotal(side);
    const slot = chipSlotEl(side);
    const source = els.chipStack?.querySelector(".chip.active") || els.chipStack;
    if (!slot || !source) {
      renderPlacedChips();
      return;
    }

    const s = source.getBoundingClientRect();
    const t = slot.getBoundingClientRect();
    const fly = document.createElement("div");
    fly.className = "flying-chip";
    // Fly with the chip COLOR for the NEW total; label shows REAL total (e.g. 30)
    const flyTotal = total || add;
    fly.style.backgroundImage = `url("${chipAssetUrl(flyTotal)}")`;
    const flyCover = document.createElement("span");
    flyCover.className = "chip-cover";
    const flyLabel = document.createElement("span");
    flyLabel.className = "chip-amt";
    const flyText = chipAmountText(flyTotal);
    flyLabel.textContent = flyText;
    if (flyText.length >= 4) flyLabel.classList.add("len-4");
    else if (flyText.length >= 3) flyLabel.classList.add("len-3");
    flyCover.appendChild(flyLabel);
    fly.appendChild(flyCover);
    fly.style.left = `${s.left + s.width / 2}px`;
    fly.style.top = `${s.top + s.height / 2}px`;
    document.body.appendChild(fly);

    const dx = t.left + t.width / 2 - (s.left + s.width / 2);
    const dy = t.top + t.height / 2 - (s.top + s.height / 2);

    slot.classList.add("awaiting-chip");

    requestAnimationFrame(() => {
      fly.style.transform = `translate(${dx}px, ${dy}px) scale(0.62)`;
      fly.style.opacity = "0.92";
    });

    setTimeout(() => {
      fly.remove();
      slot.classList.remove("awaiting-chip");
      // Re-assert from state in case a poll tried to clear mid-flight
      if (state._roundStake > 0 && state.side) {
        setSideStake(state.side, state._roundStake);
      }
      renderPlacedChips();
    }, 430);
  }

  function syncChipsFromPending(pending) {
    if (!pending || !pending.side || !(Number(pending.stake) > 0)) {
      // Never wipe chips while a place/fly is in progress (poll race)
      if (state.pendingRequest || isChipFlyInProgress()) return;
      clearPlacedChips();
      return;
    }
    const stake = Number(pending.stake);
    const current = sideStakeTotal(pending.side);
    const sameSideOnly = state.chipPlacements.length > 0
      && state.chipPlacements.every((c) => c.side === pending.side);
    if (sameSideOnly && current === stake) {
      return;
    }
    setSideStake(pending.side, stake);
    if (!isChipFlyInProgress()) renderPlacedChips();
  }

  function applyUserPayload(data) {
    if (typeof data.balance === "number") state.balance = data.balance;
    if (typeof data.portfolio === "number") state.portfolio = data.portfolio;
    const pending = data.pending;
    if (pending && pending.side && Number(pending.stake) > 0) {
      state.side = pending.side;
      state._roundStake = Number(pending.stake);
      if (state.phase === "betting") state.portfolio = state._roundStake;
      syncChipsFromPending(pending);
    } else if (data.pending === null) {
      // Poll race: don't clear right after a successful place / during fly-in
      if (state.pendingRequest || isChipFlyInProgress()) {
        // keep local chips
      } else {
        state.side = null;
        state._roundStake = 0;
        if (state.phase !== "trading") state.portfolio = 0;
        clearPlacedChips();
      }
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
        // Use server win only when settlement has completed (win > 0);
        // if win is 0 the timer hasn't settled yet — fall back to client calc.
        showResultFlash(state.finalPct, typeof game.win === "number" && game.win > 0 ? game.win : null);
        setPhase("settled", Math.max(0.2, secondsLeft) * 1000);
        if (typeof game.win === "number" && game.win > 0) {
          state.lastWin = game.win;
        }
      } else if (typeof game.win === "number" && game.win > 0 && !state.lastWin) {
        // Settlement completed after we entered settled — refresh the flash with real payout
        state.lastWin = game.win;
        showResultFlash(state.finalPct, game.win);
      }
    } else if (nextPhase === "betting") {
      if (state.phase !== "betting") {
        state.livePct = 0;
        state._roundStake = 0;
        if (!state.side) state.portfolio = 0;
        clearPlacedChips();
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

  // A frozen chart is indistinguishable from a slow one, so say which it is.
  let linkBanner = null;
  let pollFailures = 0;

  function setLinkStatus(message) {
    if (!message) {
      if (linkBanner) linkBanner.hidden = true;
      return;
    }
    if (!linkBanner) {
      linkBanner = document.createElement("div");
      linkBanner.className = "link-banner";
      document.body.appendChild(linkBanner);
    }
    linkBanner.textContent = message;
    linkBanner.hidden = false;
  }

  async function pollState() {
    try {
      // Public endpoint — drives graph/timer even without JWT
      const data = await api("/state/");
      pollFailures = 0;
      setLinkStatus(data && data.stale ? "Market paused — reconnecting" : null);
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
      pollFailures++;
      // One dropped poll is normal on mobile; only surface a sustained outage.
      if (pollFailures >= 3) setLinkStatus("Reconnecting to market…");
      console.warn("poll", e);
    }
  }

  function syncHud() {
    els.balance.textContent = money(state.balance);
    els.portfolioValue.textContent = money(state.portfolio);
    els.stakeDisplay.textContent = state.stake >= 1000 ? (state.stake / 1000) + "K" : String(state.stake);
    if (els.totalBet) {
      const tb = state._roundStake || 0;
      els.totalBet.textContent = "₹" + (tb % 1 === 0 ? String(tb) : money(tb));
    }
    if (els.footerBalance) els.footerBalance.textContent = inr(state.balance);
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

    const chartArea = els.chart?.closest(".chart-area");
    const miniWrap = els.miniChart?.closest(".mini-wrap");
    if (phase === "settled") state.holdGraphBlur = true;
    if (phase === "trading") state.holdGraphBlur = false;
    // Blur finished graph until the next trading line opens
    const blur = state.holdGraphBlur && phase !== "trading";
    chartArea?.classList.toggle("is-finished", blur);
    miniWrap?.classList.toggle("is-finished", blur);

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
      const stakeAmt = state.stake;
      const data = await api("/bets/", {
        method: "POST",
        requireAuth: true,
        body: JSON.stringify({ side, amount: stakeAmt }),
      });
      state.lastSide = side;
      state.lastStake = stakeAmt;
      // One chip per side — color follows TOTAL stake ranges (10→20→50…)
      const prevSame =
        state.chipPlacements.length > 0 &&
        state.chipPlacements.every((c) => c.side === side)
          ? sideStakeTotal(side)
          : 0;
      const serverTotal =
        data.pending && data.pending.stake != null
          ? Number(data.pending.stake)
          : null;
      const totalAfter =
        serverTotal != null && serverTotal > 0
          ? serverTotal
          : prevSame + stakeAmt;
      state.side = side;
      state._roundStake = totalAfter;
      setSideStake(side, totalAfter);
      // Apply server wallet/crowd first, but chip sync is already set above
      applyUserPayload(data);
      if (data.game) applyGameClock(data.game);
      // Keep local chip state if a poll raced with pending:null
      state.side = side;
      state._roundStake = totalAfter;
      setSideStake(side, totalAfter);
      playChipSound();
      flyChipToSide(side, stakeAmt, totalAfter);
      showToast(side.toUpperCase() + " ₹" + stakeAmt);
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

  async function doubleBet() {
    if (state.phase !== "betting" || !state.apiReady) {
      return showToast(state.apiReady ? "Wait for betting" : "Login required");
    }
    // If a bet is pending, place the same amount again (doubles total stake).
    if (state._roundStake > 0 && state.side) {
      const prev = state.stake;
      state.stake = state._roundStake;
      await placeBet(state.side);
      state.stake = prev;
      syncHud();
      return;
    }
    // Otherwise double the selected chip (snap to next chip value).
    const doubled = Math.min(state.stake * 2, CHIP_AMOUNTS[CHIP_AMOUNTS.length - 1]);
    const snapped = CHIP_AMOUNTS.find((a) => a >= doubled) || CHIP_AMOUNTS[CHIP_AMOUNTS.length - 1];
    state.stake = snapped;
    syncHud();
    showToast("Chip ×2 → ₹" + state.stake);
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

  function drawPctAxis(yAt, w, h, amp, centerY) {
    const step = 20;
    const padY = 12;
    const pctTop = state.viewCenter + (centerY / amp) * 100;
    const pctBot = state.viewCenter - ((h - centerY) / amp) * 100;
    const start = Math.ceil(pctBot / step) * step;
    const end = Math.floor(pctTop / step) * step;

    ctx.save();
    ctx.font = "500 11px Inter, system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(180, 195, 215, 0.72)";
    ctx.strokeStyle = "rgba(140, 160, 185, 0.22)";
    ctx.lineWidth = 1;

    for (let pct = start; pct <= end; pct += step) {
      const y = yAt(pct);
      if (y < padY || y > h - padY) continue;

      const label = pct > 0 ? `+${pct}%` : `${pct}%`;

      ctx.beginPath();
      ctx.moveTo(w - 46, y);
      ctx.lineTo(w - 32, y);
      ctx.stroke();

      ctx.fillText(label, w - 8, y);
    }
    ctx.restore();
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
    const plotW = Math.max(40, w - 48);
    const xAt = (t) => t * plotW;

    // Light grid (fixed pixel rows)
    ctx.strokeStyle = "rgba(120, 140, 170, 0.13)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 5]);
    for (let i = 1; i < 6; i++) {
      const y = (h / 6) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(plotW, y);
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
      ctx.lineTo(plotW, zeroY);
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
      drawPctAxis(yAt, w, h, amp, centerY);
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
    if (visible.length < 2) {
      drawPctAxis(yAt, w, h, amp, centerY);
      return;
    }

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
      badge.style.left = clamp(tx, 48, plotW - 8) + "px";
      badge.style.top = clamp(ty, 28, h - 28) + "px";
      badge.style.transform = "translate(-50%, -130%)";
    }

    // Percentage scale on the right (drawn last so it stays readable)
    drawPctAxis(yAt, w, h, amp, centerY);
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
    playChipSound();
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
  document.getElementById("undoBtn")?.addEventListener("click", undoBet);
  document.getElementById("doubleBtn")?.addEventListener("click", doubleBet);

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

  // ── Live host: useful frames only, locked crop (no zoom in/out) ──
  const HOST_BASE = "photos/host-upright/live/";
  const HOST_VER = "63";
  const HOST_REST = "00-rest.png";
  // Skip frames that needed big scale correction (caused zoom)
  const HOST_IDLE = [HOST_REST, HOST_REST, "08-smile.png", HOST_REST];
  const HOST_SPEAK = [
    HOST_REST,
    "01-near.png",
    "11-talk.png",
    "01-near.png",
  ];
  const HOST_BLINK = ["09-blink-half.png", "10-blink-closed.png", "09-blink-half.png"];
  const HOST_CROSSFADE_MS = 180;
  // Identical inset on EVERY frame so size can't drift between swaps
  const HOST_INSET = 0.06;

  let hostSpeakingOn = false;
  let hostFrameI = 0;
  let hostTimer = null;
  let hostNextBlinkAt = 0;
  let hostBusyBlink = false;
  let hostCtx = null;
  let hostReady = false;
  let hostFadeRaf = null;
  let hostCurrentFile = HOST_REST;
  const hostBitmaps = Object.create(null);

  function ensureHostCtx() {
    const c = document.getElementById("hostFace");
    if (!c) return null;
    if (!hostCtx) {
      c.width = 360;
      c.height = 440;
      hostCtx = c.getContext("2d");
    }
    return hostCtx;
  }

  function drawHostLocked(ctx, bmp, alpha) {
    if (!ctx || !bmp) return;
    const iw = bmp.width;
    const ih = bmp.height;
    const sx = iw * HOST_INSET;
    const sy = ih * HOST_INSET;
    const sw = iw * (1 - 2 * HOST_INSET);
    const sh = ih * (1 - 2 * HOST_INSET);
    ctx.globalAlpha = alpha;
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, 360, 440);
    ctx.globalAlpha = 1;
  }

  function paintHostHard(file) {
    const ctx = ensureHostCtx();
    const bmp = hostBitmaps[file];
    if (!ctx || !bmp) return;
    drawHostLocked(ctx, bmp, 1);
    hostCurrentFile = file;
  }

  function crossfadeHost(toFile) {
    const fromFile = hostCurrentFile;
    const fromBmp = hostBitmaps[fromFile];
    const toBmp = hostBitmaps[toFile];
    if (!toBmp) return;
    if (!fromBmp || fromFile === toFile) {
      paintHostHard(toFile);
      return;
    }
    if (hostFadeRaf) cancelAnimationFrame(hostFadeRaf);
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / HOST_CROSSFADE_MS);
      const e = t * t * (3 - 2 * t);
      const ctx = ensureHostCtx();
      if (!ctx) return;
      drawHostLocked(ctx, fromBmp, 1);
      drawHostLocked(ctx, toBmp, e);
      if (t < 1) {
        hostFadeRaf = requestAnimationFrame(step);
      } else {
        hostCurrentFile = toFile;
        hostFadeRaf = null;
      }
    };
    hostFadeRaf = requestAnimationFrame(step);
  }

  function setHostFrame(file) {
    crossfadeHost(file);
  }

  function preloadHostFrames() {
    const names = [...new Set([...HOST_IDLE, ...HOST_SPEAK, ...HOST_BLINK])];
    return Promise.all(
      names.map(
        (f) =>
          new Promise((resolve) => {
            const im = new Image();
            im.decoding = "async";
            im.onload = () => {
              hostBitmaps[f] = im;
              resolve();
            };
            im.onerror = () => resolve();
            im.src = HOST_BASE + f + "?v=" + HOST_VER;
          })
      )
    ).then(() => {
      hostReady = !!hostBitmaps[HOST_REST];
      paintHostHard(HOST_REST);
    });
  }

  function scheduleHostBlink(now) {
    hostNextBlinkAt = now + 3200 + Math.random() * 4200;
  }

  function clearHostTimer() {
    if (hostTimer) {
      clearTimeout(hostTimer);
      hostTimer = null;
    }
  }

  function playHostBlink() {
    hostBusyBlink = true;
    let i = 0;
    const step = () => {
      if (i < HOST_BLINK.length) {
        setHostFrame(HOST_BLINK[i]);
        const hold = i === 1 ? 90 : 55;
        i += 1;
        hostTimer = setTimeout(step, hold);
        return;
      }
      hostBusyBlink = false;
      scheduleHostBlink(performance.now());
      const frames = hostSpeakingOn ? HOST_SPEAK : HOST_IDLE;
      setHostFrame(frames[hostFrameI % frames.length]);
      hostTimer = setTimeout(tickHostAvatar, hostSpeakingOn ? 140 : 480);
    };
    step();
  }

  function tickHostAvatar() {
    const now = performance.now();
    if (!hostBusyBlink && now >= hostNextBlinkAt) {
      playHostBlink();
      return;
    }
    const frames = hostSpeakingOn ? HOST_SPEAK : HOST_IDLE;
    hostFrameI = (hostFrameI + 1) % frames.length;
    setHostFrame(frames[hostFrameI]);
    const delay = hostSpeakingOn
      ? 170 + Math.floor(Math.random() * 90)
      : 750 + Math.floor(Math.random() * 500);
    hostTimer = setTimeout(tickHostAvatar, delay);
  }

  function setHostSpeaking(on) {
    hostSpeakingOn = !!on;
    if (!hostReady) return;
    clearHostTimer();
    hostBusyBlink = false;
    hostFrameI = 0;
    setHostFrame(hostSpeakingOn ? HOST_SPEAK[0] : HOST_IDLE[0]);
    if (!hostNextBlinkAt) scheduleHostBlink(performance.now());
    hostTimer = setTimeout(tickHostAvatar, hostSpeakingOn ? 120 : 520);
  }

  function startHostTalking() {
    ensureHostCtx();
    preloadHostFrames().then(() => {
      scheduleHostBlink(performance.now());
      setHostSpeaking(state.phase === "trading");
    });
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
    history.pushState({ gundu_game: "trading" }, "", location.href);
    window.addEventListener("popstate", () => {
      location.replace(casinoUrl());
    });
  } catch (_) {}
})();
