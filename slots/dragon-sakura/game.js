(function () {
  "use strict";
  const COLS = 5, ROWS = 3, START = 2000, KEY = "dragon-sakura-balance";
  const BETS = [0.5, 1, 2, 5, 10, 20];
  const BASE_SPIN_MS = 5200, REEL_STAGGER_MS = 280, BLUR_SYMBOLS = 52;
  const FREE_SPINS = 10, PETAL_LIFE = 3;
  const SYMBOLS = [
    { id: "dragon", wild: true, weight: 3, pays: [0, 0, 15, 80, 300] },
    { id: "koi", weight: 5, pays: [0, 0, 10, 40, 140] },
    { id: "samurai", weight: 6, pays: [0, 0, 8, 30, 100] },
    { id: "sakura", petal: true, weight: 5, pays: [0, 0, 5, 18, 60] },
    { id: "crane", weight: 7, pays: [0, 0, 5, 16, 55] },
    { id: "fan", weight: 9, pays: [0, 0, 4, 12, 40] },
    { id: "cat", weight: 10, pays: [0, 0, 3, 10, 35] },
    { id: "bell", weight: 12, pays: [0, 0, 3, 8, 25] },
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
    petalCount: document.getElementById("petalCount"), fsBadge: document.getElementById("fsBadge"),
    fsCount: document.getElementById("fsCount"),
  };
  let balance = Number(localStorage.getItem(KEY)) || START, betIndex = 2, spinning = false, auto = false;
  let freeSpins = 0, grid = [], strips = [], petals = {}; // key -> lives left
  const money = (n) => n.toFixed(2);
  const save = () => localStorage.setItem(KEY, String(balance));
  const pick = () => bag[Math.floor(Math.random() * bag.length)];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  function makeCell(id, extra) {
    const c = document.createElement("div");
    c.className = "cell" + (extra ? " " + extra : "");
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
      for (let r = 0; r < ROWS; r++) {
        const key = `${c},${r}`;
        let extra = "";
        if (wins.has(key)) extra += " win";
        if (petals[key]) extra += " petal";
        strip.appendChild(makeCell(grid[c][r], extra.trim()));
      }
    }
  }
  function updateHud() {
    els.balance.textContent = money(balance); els.bet.textContent = money(BETS[betIndex]);
    els.petalCount.textContent = String(Object.keys(petals).length);
    els.fsBadge.classList.toggle("hidden", freeSpins <= 0);
    els.fsCount.textContent = String(freeSpins);
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
  function applyPetalsToGrid() {
    Object.keys(petals).forEach((key) => {
      const [c, r] = key.split(",").map(Number);
      grid[c][r] = "dragon"; // sticky wild
    });
  }
  function agePetals() {
    const next = {};
    Object.entries(petals).forEach(([key, life]) => {
      if (life > 1) next[key] = life - 1;
    });
    petals = next;
  }
  function collectNewPetals() {
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        if (byId[grid[c][r]].petal) petals[`${c},${r}`] = PETAL_LIFE;
      }
    }
  }
  function linePay(line) {
    const ids = line.map((row, col) => grid[col][row]);
    let base = ids.find((id) => !byId[id].wild && !byId[id].petal);
    if (!base) base = ids.find((id) => byId[id].wild) || ids[0];
    let count = 0;
    for (const id of ids) {
      if (byId[id].wild || id === base) count += 1; else break;
    }
    if (count < 3) return { win: 0, cells: [] };
    return { win: (byId[base].pays[count - 1] || 0) * BETS[betIndex], cells: line.slice(0, count).map((row, col) => `${col},${row}`) };
  }
  function evaluate() {
    const winCells = new Set(); let total = 0, dragons = 0;
    for (const line of LINES) {
      const res = linePay(line);
      if (res.win > 0) { total += res.win; res.cells.forEach((k) => winCells.add(k)); }
    }
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
      if (grid[c][r] === "dragon" && !petals[`${c},${r}`]) dragons += 1;
    }
    // count natural dragons on grid before petal overlay confusion - recount from symbol ids that were dragon
    dragons = 0;
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
      if (strips[c].children[r] && grid[c][r] === "dragon") dragons += 1;
    }
    return { total, winCells, dragons };
  }
  function setBusy(busy) {
    spinning = busy; els.spinBtn.disabled = busy;
    els.betMinus.disabled = busy || freeSpins > 0; els.betPlus.disabled = busy || freeSpins > 0;
  }
  async function spinOnce() {
    if (spinning) return;
    const bet = BETS[betIndex], usingFree = freeSpins > 0;
    if (!usingFree) {
      if (balance < bet) { auto = false; updateHud(); return; }
      balance -= bet; save();
    } else freeSpins -= 1;
    els.winBanner.classList.add("hidden"); els.lastWin.textContent = money(0);
    setBusy(true); updateHud();
    agePetals();
    const next = Array.from({ length: COLS }, () => Array.from({ length: ROWS }, pick));
    // preserve petal positions after roll
    const locked = { ...petals };
    await Promise.all(next.map((ids, c) => rollReel(c, ids, BASE_SPIN_MS + c * REEL_STAGGER_MS)));
    Object.keys(locked).forEach((key) => {
      const [c, r] = key.split(",").map(Number);
      grid[c][r] = "dragon";
    });
    collectNewPetals();
    applyPetalsToGrid();
    let dragons = 0;
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
      if (next[c][r] === "dragon") dragons += 1;
    }
    const { total, winCells } = evaluate();
    paint(winCells);
    if (dragons >= 3) freeSpins += FREE_SPINS;
    if (total > 0) {
      balance += total; els.lastWin.textContent = money(total);
      els.winAmount.textContent = money(total); els.winBanner.classList.remove("hidden"); save();
    }
    setBusy(false); updateHud();
    if (auto || freeSpins > 0) setTimeout(spinOnce, total > 0 ? 1000 : 450);
  }
  els.spinBtn.addEventListener("click", () => { if (auto) { auto = false; updateHud(); return; } spinOnce(); });
  els.autoBtn.addEventListener("click", () => { auto = !auto; updateHud(); if (auto && !spinning) spinOnce(); });
  els.betMinus.addEventListener("click", () => { if (!spinning && freeSpins <= 0) { betIndex = Math.max(0, betIndex - 1); updateHud(); } });
  els.betPlus.addEventListener("click", () => { if (!spinning && freeSpins <= 0) { betIndex = Math.min(BETS.length - 1, betIndex + 1); updateHud(); } });
  buildUI();
})();
