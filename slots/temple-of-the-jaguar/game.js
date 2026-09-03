(function () {
  "use strict";
  const COLS = 5, ROWS = 3, START = 1500, KEY = "temple-jaguar-balance";
  const BETS = [0.5, 1, 2, 5, 10, 20];
  const BASE_SPIN_MS = 5200, REEL_STAGGER_MS = 280, BLUR_SYMBOLS = 52;
  const SYMBOLS = [
    { id: "jaguar", wild: true, weight: 3, pays: [0, 0, 12, 60, 250] },
    { id: "sun", weight: 5, pays: [0, 0, 10, 40, 150] },
    { id: "emerald", weight: 6, pays: [0, 0, 8, 30, 100] },
    { id: "toucan", weight: 7, pays: [0, 0, 5, 20, 70] },
    { id: "idol", scatter: true, weight: 4, pays: [0, 0, 2, 10, 40] },
    { id: "frog", weight: 9, pays: [0, 0, 4, 14, 45] },
    { id: "calendar", weight: 10, pays: [0, 0, 3, 10, 35] },
    { id: "axe", weight: 11, pays: [0, 0, 3, 8, 25] },
    { id: "a", weight: 12, pays: [0, 0, 2, 6, 20] },
    { id: "k", weight: 12, pays: [0, 0, 2, 5, 18] },
    { id: "q", weight: 13, pays: [0, 0, 2, 5, 15] },
    { id: "j", weight: 13, pays: [0, 0, 2, 4, 12] },
  ];
  const LINES = [
    [1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2],
    [0,0,1,2,2],[2,2,1,0,0],[1,0,0,0,1],[1,2,2,2,1],[0,1,1,1,0],
    [2,1,1,1,2],[1,0,1,2,1],[1,2,1,0,1],[0,1,0,1,0],[2,1,2,1,2],
    [1,1,0,1,1],[1,1,2,1,1],[0,0,2,0,0],[2,2,0,2,2],[0,2,0,2,0],
  ];
  const byId = Object.fromEntries(SYMBOLS.map((s) => [s.id, s]));
  const bag = SYMBOLS.flatMap((s) => Array(s.weight).fill(s.id));
  const els = {
    reels: document.getElementById("reels"), balance: document.getElementById("balance"),
    bet: document.getElementById("bet"), lastWin: document.getElementById("lastWin"),
    spinBtn: document.getElementById("spinBtn"), autoBtn: document.getElementById("autoBtn"),
    betMinus: document.getElementById("betMinus"), betPlus: document.getElementById("betPlus"),
    winBanner: document.getElementById("winBanner"), winAmount: document.getElementById("winAmount"),
    bonusOverlay: document.getElementById("bonusOverlay"), paths: document.getElementById("paths"),
    bonusTotal: document.getElementById("bonusTotal"),
  };
  let balance = Number(localStorage.getItem(KEY)) || START, betIndex = 2, spinning = false, auto = false, grid = [], strips = [];
  const money = (n) => n.toFixed(2);
  const save = () => localStorage.setItem(KEY, String(balance));
  const pick = () => bag[Math.floor(Math.random() * bag.length)];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  function makeCell(id, win) {
    const c = document.createElement("div");
    c.className = "cell" + (win ? " win" : "");
    c.innerHTML = `<img src="assets/symbols/${id}.png" alt="${id}">`;
    return c;
  }
  function stripStep(strip) {
    const cell = strip.querySelector(".cell");
    if (!cell) return 0;
    const gap = parseFloat(getComputedStyle(strip).rowGap || getComputedStyle(strip).gap) || 0;
    return cell.getBoundingClientRect().height + gap;
  }
  function buildUI() {
    els.reels.innerHTML = ""; strips = [];
    for (let c = 0; c < COLS; c++) {
      const reel = document.createElement("div"); reel.className = "reel";
      const win = document.createElement("div"); win.className = "reel-window";
      const strip = document.createElement("div"); strip.className = "reel-strip";
      win.appendChild(strip); reel.appendChild(win); els.reels.appendChild(reel); strips.push(strip);
    }
    grid = Array.from({ length: COLS }, () => Array.from({ length: ROWS }, pick));
    paint(); updateHud();
  }
  function paint(wins = new Set()) {
    for (let c = 0; c < COLS; c++) {
      const strip = strips[c];
      strip.getAnimations().forEach((a) => a.cancel());
      strip.style.transform = "translate3d(0,0,0)"; strip.classList.remove("rolling"); strip.innerHTML = "";
      for (let r = 0; r < ROWS; r++) strip.appendChild(makeCell(grid[c][r], wins.has(`${c},${r}`)));
    }
  }
  function updateHud() {
    els.balance.textContent = money(balance); els.bet.textContent = money(BETS[betIndex]);
    els.autoBtn.classList.toggle("on", auto);
  }
  async function rollReel(col, finalIds, duration) {
    const strip = strips[col], sequence = [];
    for (let r = 0; r < ROWS; r++) sequence.push(grid[col][r]);
    for (let i = 0; i < BLUR_SYMBOLS + col * 3; i++) sequence.push(pick());
    finalIds.forEach((id) => sequence.push(id));
    strip.getAnimations().forEach((a) => a.cancel());
    strip.style.transform = "translate3d(0,0,0)"; strip.innerHTML = "";
    sequence.forEach((id) => strip.appendChild(makeCell(id)));
    strip.classList.add("rolling"); void strip.offsetHeight;
    const travel = stripStep(strip) * (sequence.length - ROWS);
    const anim = strip.animate(
      [{ transform: "translate3d(0,0,0)" }, { transform: `translate3d(0,${-travel}px,0)` }],
      { duration, easing: "cubic-bezier(0.12, 0.55, 0.08, 1)", fill: "forwards" }
    );
    await anim.finished;
    strip.classList.remove("rolling"); grid[col] = finalIds.slice();
    strip.getAnimations().forEach((a) => a.cancel());
    strip.style.transform = "translate3d(0,0,0)"; strip.innerHTML = "";
    finalIds.forEach((id) => strip.appendChild(makeCell(id)));
  }
  function linePay(line) {
    const ids = line.map((row, col) => grid[col][row]);
    let base = ids.find((id) => !byId[id].wild && !byId[id].scatter);
    if (!base) base = ids.find((id) => byId[id].wild) || ids[0];
    let count = 0;
    for (const id of ids) {
      const s = byId[id]; if (s.scatter) break;
      if (s.wild || id === base) count += 1; else break;
    }
    if (count < 3) return { win: 0, cells: [] };
    return { win: (byId[base].pays[count - 1] || 0) * BETS[betIndex], cells: line.slice(0, count).map((row, col) => `${col},${row}`) };
  }
  function evaluate() {
    const winCells = new Set(); let total = 0, idols = 0; const idolCells = [];
    for (const line of LINES) {
      const res = linePay(line);
      if (res.win > 0) { total += res.win; res.cells.forEach((k) => winCells.add(k)); }
    }
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
      if (grid[c][r] === "idol") { idols += 1; idolCells.push(`${c},${r}`); }
    }
    if (idols >= 3) {
      total += (byId.idol.pays[Math.min(idols, 5) - 1] || 0) * BETS[betIndex];
      idolCells.forEach((k) => winCells.add(k));
    }
    return { total, winCells, idols };
  }
  function templeTrail() {
    return new Promise((resolve) => {
      const prizes = [5, 10, 25, 50, 100].map((m) => m * BETS[betIndex]);
      els.paths.innerHTML = ""; els.bonusTotal.textContent = money(0);
      els.bonusOverlay.classList.remove("hidden");
      let done = false;
      ["LEFT", "CENTER", "RIGHT"].forEach((label) => {
        const btn = document.createElement("button");
        btn.type = "button"; btn.className = "path-btn"; btn.textContent = label;
        btn.addEventListener("click", () => {
          if (done) return; done = true;
          const prize = prizes[Math.floor(Math.random() * prizes.length)];
          btn.classList.add("opened"); btn.textContent = money(prize);
          els.bonusTotal.textContent = money(prize);
          setTimeout(() => { els.bonusOverlay.classList.add("hidden"); resolve(prize); }, 700);
        });
        els.paths.appendChild(btn);
      });
    });
  }
  function setBusy(busy) {
    spinning = busy; els.spinBtn.disabled = busy; els.betMinus.disabled = busy; els.betPlus.disabled = busy;
  }
  async function spinOnce() {
    if (spinning) return;
    const bet = BETS[betIndex];
    if (balance < bet) { auto = false; updateHud(); return; }
    balance -= bet; save();
    els.winBanner.classList.add("hidden"); els.lastWin.textContent = money(0);
    setBusy(true); updateHud();
    const next = Array.from({ length: COLS }, () => Array.from({ length: ROWS }, pick));
    await Promise.all(next.map((ids, c) => rollReel(c, ids, BASE_SPIN_MS + c * REEL_STAGGER_MS)));
    let { total, winCells, idols } = evaluate();
    paint(winCells);
    if (idols >= 3) { total += await templeTrail(); }
    if (total > 0) {
      balance += total; els.lastWin.textContent = money(total);
      els.winAmount.textContent = money(total); els.winBanner.classList.remove("hidden"); save();
    }
    setBusy(false); updateHud();
    if (auto) setTimeout(spinOnce, total > 0 ? 1000 : 450);
  }
  els.spinBtn.addEventListener("click", () => { if (auto) { auto = false; updateHud(); return; } spinOnce(); });
  els.autoBtn.addEventListener("click", () => { auto = !auto; updateHud(); if (auto && !spinning) spinOnce(); });
  els.betMinus.addEventListener("click", () => { if (!spinning) { betIndex = Math.max(0, betIndex - 1); updateHud(); } });
  els.betPlus.addEventListener("click", () => { if (!spinning) { betIndex = Math.min(BETS.length - 1, betIndex + 1); updateHud(); } });
  buildUI();
})();
