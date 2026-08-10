(() => {
  // Same-origin when served by Django; otherwise point at the API server
  const API_BASE =
    window.AIR_BALLOON_API ||
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? (window.location.port === "8000" ? "/api" : "http://127.0.0.1:8000/api")
      : "/api/air-balloon");
  const TOKEN_KEY = "airBalloonPlayerToken";
  const START_BALANCE = 1000;

  let MIN_BET = 10;
  let MAX_BET = 5000;
  let BET_STEP = 10;
  const BASE_MULTIPLIER = 1;
  const MAX_HISTORY = 14;
  const PUMP_STROKE_MS = 420;
  let ROUND_GAP_MS = 3000;

  /* Filled: teardrop + mouth hole so the nozzle tip shows inside the neck */
  const INFLATED_PATH =
    "M100 20 C148 20 180 56 180 104 C180 150 152 178 128 194 C118 202 112 208 108 214 L110 226 C110 230 106 232 100 232 C94 232 90 230 90 226 L92 214 C88 208 82 202 72 194 C48 178 20 150 20 104 C20 56 52 20 100 20 Z M95 212 C95 209 97 208 100 208 C103 208 105 209 105 212 L104 226 C104 228 102 229 100 229 C98 229 96 228 96 226 Z";
  /* Empty: fallen RIGHT + mouth hole for the pipe */
  const LIMP_PATH =
    "M88 230 C88 214 96 206 100 204 C110 202 124 212 138 228 C154 248 166 272 162 294 C158 312 138 318 120 310 C104 302 92 282 90 258 C88 244 88 234 88 230 Z M95 210 C95 207 97 206 100 206 C103 206 105 207 105 210 L104 228 C104 230 102 231 100 231 C98 231 96 230 96 228 Z";

  const els = {
    balance: document.getElementById("balance"),
    rig: document.getElementById("rig"),
    balloonWrap: document.getElementById("balloonWrap"),
    balloonPath: document.getElementById("balloonPath"),
    balloonRim: document.getElementById("balloonRim"),
    multiplier: document.getElementById("multiplier"),
    burst: document.getElementById("burst"),
    burstCanvas: document.getElementById("burstCanvas"),
    statusLine: document.getElementById("statusLine"),
    betAmount: document.getElementById("betAmount"),
    betMinus: document.getElementById("betMinus"),
    betPlus: document.getElementById("betPlus"),
    pumpBtn: document.getElementById("pumpBtn"),
    cashoutBtn: document.getElementById("cashoutBtn"),
    pumpHint: document.getElementById("pumpHint"),
    cashHint: document.getElementById("cashHint"),
    potentialWin: document.getElementById("potentialWin"),
    lastCrash: document.getElementById("lastCrash"),
    pumpCount: document.getElementById("pumpCount"),
    historyTrack: document.getElementById("historyTrack"),
    skyGlow: document.getElementById("skyGlow"),
    dots: [...document.querySelectorAll(".pump-lights circle")],
  };

  const state = {
    balance: START_BALANCE,
    phase: "idle",
    bet: 50,
    multiplier: BASE_MULTIPLIER,
    pumps: 0,
    crashAt: 1,
    history: [],
    busy: false,
    cooldown: false,
  };

  const burstCtx = els.burstCanvas.getContext("2d");
  let burstAnim = null;
  let cooldownTimer = null;

  function money(n) {
    return `₹${n.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  function clampBet(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return MIN_BET;
    return Math.min(MAX_BET, Math.max(MIN_BET, Math.round(n / BET_STEP) * BET_STEP));
  }

  (function captureGunduToken() {
    try {
      const q = new URLSearchParams(location.search);
      const t = q.get("token") || q.get("access_token");
      if (t) localStorage.setItem("gundu_access_token", t);
    } catch (_) {}
  })();

  function getPlayerToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function setPlayerToken(token) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
  }

  async function api(path, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };
    const token = getPlayerToken();
    if (token) headers["X-Player-Token"] = token;
    const jwt = localStorage.getItem("gundu_access_token") || localStorage.getItem("access_token");
    if (jwt) headers["Authorization"] = "Bearer " + jwt;

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    let data = {};
    try {
      data = await res.json();
    } catch {
      data = { ok: false, error: "Invalid server response" };
    }

    if (data.player_token) setPlayerToken(data.player_token);

    if (!res.ok || data.ok === false) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.code = data.code || "error";
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function renderHistory(items) {
    state.history = (items || []).slice(0, MAX_HISTORY);
    els.historyTrack.innerHTML = "";
    state.history.forEach((item) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      if (item.crashed) chip.classList.add("crash");
      else if (item.value >= 2) chip.classList.add("high");
      chip.textContent = `${Number(item.value).toFixed(2)}x`;
      els.historyTrack.appendChild(chip);
    });
  }

  function applyServerState(data, { keepBusy = false } = {}) {
    if (typeof data.balance === "number") state.balance = data.balance;
    if (data.phase) state.phase = data.phase;
    if (data.round) {
      state.bet = data.round.bet;
      state.pumps = data.round.pumps;
      state.multiplier = data.round.multiplier;
    } else if (data.phase !== "playing") {
      state.pumps = data.event === "crashed" ? state.pumps : 0;
      if (data.phase === "idle" || data.phase === "ended") {
        state.multiplier = BASE_MULTIPLIER;
      }
    }

    if (typeof data.min_bet === "number") MIN_BET = data.min_bet;
    if (typeof data.max_bet === "number") MAX_BET = data.max_bet;
    if (typeof data.bet_step === "number") BET_STEP = data.bet_step;
    if (typeof data.round_gap_seconds === "number") {
      ROUND_GAP_MS = data.round_gap_seconds * 1000;
    }

    if (Array.isArray(data.history)) renderHistory(data.history);

    if (data.last_result?.crash_at) {
      els.lastCrash.textContent = `${Number(data.last_result.crash_at).toFixed(2)}x`;
    }
    if (data.crash_at) {
      els.lastCrash.textContent = `${Number(data.crash_at).toFixed(2)}x`;
    }

    if (!keepBusy) state.busy = false;

    const cooldownMs = Number(data.cooldown_ms || 0);
    if (cooldownMs > 0) {
      startRoundGap(cooldownMs);
    } else if (!data.cooldown) {
      state.cooldown = false;
      if (cooldownTimer) {
        clearInterval(cooldownTimer);
        cooldownTimer = null;
      }
    }
  }

  function balloonScaleForMultiplier(m) {
    const t = Math.min(1, (m - 1) / 9);
    const ease = 1 - Math.pow(1 - t, 1.25);
    return {
      width: 120 + ease * 160,
      height: 180 + ease * 200,
      font: 18 + ease * 18,
      tension: ease,
    };
  }

  function setStatus(text, kind = "") {
    els.statusLine.textContent = text;
    els.statusLine.classList.remove("win", "lose");
    if (kind) els.statusLine.classList.add(kind);
  }

  function updateDots() {
    const lit =
      state.phase !== "playing"
        ? 1
        : Math.min(3, Math.floor((state.pumps + 1) / 2));
    els.dots.forEach((dot, i) => dot.classList.toggle("on", i === lit));
  }

  function setBalloonPath(inflated) {
    const d = inflated ? INFLATED_PATH : LIMP_PATH;
    els.balloonPath.setAttribute("d", d);
    els.balloonPath.setAttribute("fill-rule", "evenodd");
    if (els.balloonRim) {
      els.balloonRim.setAttribute("d", d);
      els.balloonRim.setAttribute("fill-rule", "evenodd");
    }
  }

  function renderBalloon() {
    const limp =
      state.phase === "idle" || (state.phase === "ended" && state.pumps === 0);

    els.balloonWrap.classList.toggle("limp", limp);

    if (limp) {
      setBalloonPath(false);
      els.balloonWrap.style.width = "150px";
      els.balloonWrap.style.height = "120px";
      els.multiplier.style.fontSize = "";
      els.multiplier.textContent = "1.00x";
      els.balloonWrap.classList.remove("tense");
      if (els.skyGlow) {
        els.skyGlow.style.width = "90px";
        els.skyGlow.style.height = "90px";
        els.skyGlow.style.opacity = "0.18";
      }
      return;
    }

    if (els.skyGlow) els.skyGlow.style.opacity = "";

    setBalloonPath(true);
    const { width, height, font, tension } = balloonScaleForMultiplier(
      Math.max(state.multiplier, 1.05)
    );
    els.balloonWrap.style.width = `${width}px`;
    els.balloonWrap.style.height = `${height}px`;
    els.multiplier.style.fontSize = `${font}px`;
    els.multiplier.textContent = `${state.multiplier.toFixed(2)}x`;
    els.balloonWrap.classList.toggle("tense", tension > 0.4);

    if (els.skyGlow) {
      const g = 170 + tension * 170;
      els.skyGlow.style.width = `${g}px`;
      els.skyGlow.style.height = `${g}px`;
    }
  }

  function potential() {
    return state.phase === "playing" ? state.bet * state.multiplier : 0;
  }

  function render() {
    els.balance.textContent = money(state.balance);
    els.betAmount.value = String(state.bet);
    els.pumpCount.textContent = String(state.pumps);
    els.potentialWin.textContent = money(potential());
    els.cashHint.textContent = money(potential());

    const bettingLocked = state.phase === "playing" || state.busy || state.cooldown;
    els.betAmount.disabled = bettingLocked;
    els.betMinus.disabled = bettingLocked;
    els.betPlus.disabled = bettingLocked;
    document.querySelectorAll("[data-bet]").forEach((btn) => {
      btn.disabled = bettingLocked;
    });

    if (state.cooldown) {
      els.pumpBtn.disabled = true;
      els.cashoutBtn.disabled = true;
    } else if (state.phase === "idle") {
      els.pumpBtn.disabled = state.balance < MIN_BET || state.busy;
      els.pumpHint.textContent = "Start round";
      els.cashoutBtn.disabled = true;
    } else if (state.phase === "playing") {
      els.pumpBtn.disabled = state.busy;
      els.pumpHint.textContent = state.busy ? "Filling…" : "Push handle";
      els.cashoutBtn.disabled = state.busy;
    } else {
      els.pumpBtn.disabled = state.busy;
      els.pumpHint.textContent = "Play again";
      els.cashoutBtn.disabled = true;
    }

    renderBalloon();
    updateDots();
  }

  /** Real pump stroke: handle down → air rushes in → balloon fills */
  function playPumpStroke() {
    return new Promise((resolve) => {
      els.rig.classList.remove("pumping");
      els.balloonWrap.classList.remove("filling");
      void els.rig.offsetWidth;

      els.rig.classList.add("pumping");
      // Air hits balloon slightly after plunger starts pushing
      window.setTimeout(() => {
        els.balloonWrap.classList.add("filling");
      }, 140);

      window.setTimeout(() => {
        els.rig.classList.remove("pumping");
        els.balloonWrap.classList.remove("filling");
        resolve();
      }, PUMP_STROKE_MS + 40);
    });
  }

  function spawnBurstParticles() {
    const particles = [];
    const colors = ["#5aadff", "#2f8cff", "#8ec8ff", "#1f7ef0", "#ffffff", "#ff6b8a"];
    for (let i = 0; i < 42; i += 1) {
      const angle = (Math.PI * 2 * i) / 42 + Math.random() * 0.4;
      const speed = 2.2 + Math.random() * 5.5;
      particles.push({
        x: 160,
        y: 160,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.5,
        r: 2 + Math.random() * 5,
        life: 1,
        decay: 0.016 + Math.random() * 0.02,
        color: colors[(Math.random() * colors.length) | 0],
        stretch: 0.6 + Math.random() * 1.4,
      });
    }
    return particles;
  }

  function showBurst() {
    if (burstAnim) cancelAnimationFrame(burstAnim);
    els.burst.hidden = false;
    els.balloonWrap.style.opacity = "0";
    const particles = spawnBurstParticles();
    const start = performance.now();

    const tick = (now) => {
      const elapsed = now - start;
      burstCtx.clearRect(0, 0, 320, 320);

      const ringT = Math.min(1, elapsed / 420);
      burstCtx.beginPath();
      burstCtx.arc(160, 160, 20 + ringT * 110, 0, Math.PI * 2);
      burstCtx.strokeStyle = `rgba(100, 180, 255, ${1 - ringT})`;
      burstCtx.lineWidth = 3;
      burstCtx.stroke();

      let alive = false;
      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.12;
        p.vx *= 0.99;
        p.life -= p.decay;
        if (p.life <= 0) return;
        alive = true;
        burstCtx.save();
        burstCtx.globalAlpha = Math.max(0, p.life);
        burstCtx.fillStyle = p.color;
        burstCtx.beginPath();
        burstCtx.ellipse(
          p.x,
          p.y,
          p.r * p.stretch,
          p.r,
          Math.atan2(p.vy, p.vx),
          0,
          Math.PI * 2
        );
        burstCtx.fill();
        burstCtx.restore();
      });

      if (alive || elapsed < 500) {
        burstAnim = requestAnimationFrame(tick);
      } else {
        els.burst.hidden = true;
        els.balloonWrap.style.opacity = "";
        burstCtx.clearRect(0, 0, 320, 320);
        state.pumps = 0;
        renderBalloon();
      }
    };

    burstAnim = requestAnimationFrame(tick);
  }

  function startRoundGap(ms = ROUND_GAP_MS) {
    if (cooldownTimer) {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
    }

    state.cooldown = true;
    const endsAt = Date.now() + Math.max(0, ms);

    const tick = () => {
      const leftMs = endsAt - Date.now();
      if (leftMs <= 0) {
        clearInterval(cooldownTimer);
        cooldownTimer = null;
        state.cooldown = false;
        els.pumpHint.textContent =
          state.phase === "ended" ? "Play again" : "Start round";
        setStatus("Place a bet, then pump to inflate");
        render();
        return;
      }
      const secs = Math.ceil(leftMs / 1000);
      els.pumpHint.textContent = `Next game in ${secs}s`;
      els.pumpBtn.disabled = true;
      els.cashoutBtn.disabled = true;
    };

    tick();
    cooldownTimer = setInterval(tick, 200);
    render();
  }

  async function startRound() {
    if (state.cooldown) return false;

    const bet = clampBet(els.betAmount.value);
    if (bet > state.balance) {
      setStatus("Not enough balance for that bet", "lose");
      return false;
    }

    try {
      const data = await api("/round/start/", {
        method: "POST",
        body: JSON.stringify({ bet }),
      });
      els.burst.hidden = true;
      els.balloonWrap.style.opacity = "";
      applyServerState(data, { keepBusy: true });
      state.phase = "playing";
      state.bet = bet;
      state.pumps = 0;
      state.multiplier = BASE_MULTIPLIER;
      setStatus(data.message || "Push the pump — air fills the balloon");
      render();
      return true;
    } catch (err) {
      if (err.code === "cooldown" && err.data) {
        applyServerState(err.data);
        setStatus(err.message, "lose");
        render();
        return false;
      }
      setStatus(err.message || "Could not start round", "lose");
      render();
      return false;
    }
  }

  async function pump() {
    if (state.busy || state.cooldown) return;

    state.busy = true;
    render();

    try {
      if (state.phase === "idle" || state.phase === "ended") {
        const started = await startRound();
        if (!started) {
          state.busy = false;
          render();
          return;
        }
      }
      if (state.phase !== "playing") {
        state.busy = false;
        render();
        return;
      }

      const stroke = playPumpStroke();
      const dataPromise = api("/round/pump/", { method: "POST", body: "{}" });

      // Optimistic mid-stroke swell; server result wins after the stroke
      window.setTimeout(() => {
        if (state.phase === "playing" && !state.cooldown) {
          renderBalloon();
        }
      }, 200);

      const data = await dataPromise;
      await stroke;

      if (data.event === "crashed") {
        state.multiplier = data.multiplier || state.multiplier;
        state.pumps = data.pumps || state.pumps;
        state.phase = "ended";
        applyServerState(data);
        showBurst();
        setStatus(data.message || "Balloon blasted — bet lost", "lose");
        render();
        return;
      }

      applyServerState(data);
      setStatus(data.message || `Air in — ${state.multiplier.toFixed(2)}x`);
      render();
    } catch (err) {
      state.busy = false;
      if (err.data) applyServerState(err.data);
      setStatus(err.message || "Pump failed", "lose");
      render();
    }
  }

  async function cashOut() {
    if (state.phase !== "playing" || state.busy || state.cooldown) return;
    state.busy = true;
    render();

    try {
      const data = await api("/round/cashout/", { method: "POST", body: "{}" });
      applyServerState(data);
      setStatus(data.message || "Cashed out", "win");
      render();
    } catch (err) {
      state.busy = false;
      if (err.data) applyServerState(err.data);
      setStatus(err.message || "Cash out failed", "lose");
      render();
    }
  }

  function setBet(value) {
    if (state.phase === "playing" || state.busy || state.cooldown) return;
    state.bet = clampBet(value);
    els.betAmount.value = String(state.bet);
  }

  els.pumpBtn.addEventListener("click", () => {
    pump();
  });
  els.cashoutBtn.addEventListener("click", cashOut);

  els.betMinus.addEventListener("click", () => setBet(state.bet - BET_STEP));
  els.betPlus.addEventListener("click", () => setBet(state.bet + BET_STEP));
  els.betAmount.addEventListener("change", () => setBet(els.betAmount.value));

  document.querySelectorAll("[data-bet]").forEach((btn) => {
    btn.addEventListener("click", () => setBet(btn.dataset.bet));
  });

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      pump();
    } else if (e.key === "c" || e.key === "C") {
      cashOut();
    }
  });

  async function loadGunduWallet() {
    const jwt =
      localStorage.getItem("gundu_access_token") ||
      localStorage.getItem("access_token") ||
      "";
    if (!jwt) {
      if (els.balance) els.balance.title = "Login required";
      return;
    }
    try {
      const r = await fetch("/api/auth/wallet/", {
        headers: {
          Accept: "application/json",
          Authorization: "Bearer " + jwt,
        },
      });
      if (!r.ok) return;
      const j = await r.json();
      const data = j.data || j;
      const bal = Number(data.balance ?? data.wallet_balance ?? data.available_balance);
      if (Number.isFinite(bal)) {
        state.balance = bal;
        if (els.balance) {
          els.balance.textContent = money(state.balance);
          els.balance.title = "Your Gundu wallet";
        }
      }
    } catch (_) {}
  }

  async function bootstrap() {
    setStatus("Connecting to server…");
    render();
    try {
      const data = await api("/bootstrap/");
      applyServerState(data);
      // Prefer real Gundu wallet over demo player balance
      await loadGunduWallet();
      if (data.round) {
        setStatus(data.message || "Round in progress — pump or cash out");
      } else if (data.cooldown) {
        setStatus("Wait for the next game…");
      } else {
        setStatus("Place a bet, then pump to inflate");
      }
      render();
    } catch (err) {
      await loadGunduWallet();
      setStatus(
        "Backend offline — start Django: cd backend && .venv/bin/python manage.py runserver",
        "lose"
      );
      render();
    }
  }

  bootstrap();
  setTimeout(loadGunduWallet, 400);
  setTimeout(loadGunduWallet, 1200);
})();
