(function () {
  "use strict";
  const COLS = 5, ROWS = 4, START = 8888.88, KEY = "cosmic-jackpot-balance";
  const BETS = [0.5, 1, 2, 5, 10];
  const BASE_SPIN_MS = 5200, REEL_STAGGER_MS = 280, BLUR_SYMBOLS = 56;
  const MULTS = [1, 2, 3, 5, 8, 12];
  const FREE_SPINS = 8;
  const SYMBOLS = [
    { id: "wild", wild: true, weight: 3, pays: [0, 0, 15, 80, 300] },
    { id: "astro", weight: 4, pays: [0, 0, 12, 50, 180] },
    { id: "planet", weight: 5, pays: [0, 0, 10, 40, 140] },
    { id: "rocket", weight: 6, pays: [0, 0, 8, 30, 100] },
    { id: "alien", weight: 7, pays: [0, 0, 6, 22, 75] },
    { id: "asteroid", weight: 8, pays: [0, 0, 5, 18, 55] },
    { id: "laser", weight: 10, pays: [0, 0, 4, 12, 40] },
    { id: "ufo", scatter: true, weight: 4, pays: [0, 0, 2, 10, 40] },
    { id: "stars", weight: 12, pays: [0, 0, 3, 8, 25] },
  ];
  const LINES = [
    [1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[3,3,3,3,3],
    [0,1,2,1,0],[3,2,1,2,3],[1,0,0,0,1],[2,3,3,3,2],
    [0,0,1,2,3],[3,3,2,1,0],[1,2,3,2,1],[2,1,0,1,2],
    [0,1,1,1,0],[3,2,2,2,3],[1,1,0,1,1],[2,2,3,2,2],
    [0,1,0,1,0],[3,2,3,2,3],[1,0,1,2,1],[2,3,2,1,2],
  ];
  const byId = Object.fromEntries(SYMBOLS.map((s) => [s.id, s]));
  const bag = SYMBOLS.flatMap((s) => Array(s.weight).fill(s.id));
  const els = {
    reels: document.getElementById("reels"), balance: document.getElementById("balance"),
    bet: document.getElementById("bet"), lastWin: document.getElementById("lastWin"),
    spinBtn: document.getElementById("spinBtn"), autoBtn: document.getElementById("autoBtn"),
    betMinus: document.getElementById("betMinus"), betPlus: document.getElementById("betPlus"),
    winBanner: document.getElementById("winBanner"), winAmount: document.getElementById("winAmount"),
    orbitMult: document.getElementById("orbitMult"), fsBadge: document.getElementById("fsBadge"),
    fsCount: document.getElementById("fsCount"),
  };
  let balance = Number(localStorage.getItem(KEY)) || START, betIndex = 1, spinning = false, auto = false;
  let freeSpins = 0, orbit = 0, grid = [], strips = [];
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
      for (let r = 0; r < ROWS; r++) strip.appendChild(makeCell(grid[c][r], wins.has(`${c},${r}`) ? "win" : ""));
    }
  }
  function updateHud() {
    els.balance.textContent = money(balance); els.bet.textContent = money(BETS[betIndex]);
    els.orbitMult.textContent = `x${MULTS[Math.min(orbit, MULTS.length - 1)]}`;
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
    const mult = (byId[base].pays[count - 1] || 0) * MULTS[Math.min(orbit, MULTS.length - 1)];
    return { win: mult * BETS[betIndex], cells: line.slice(0, count).map((row, col) => `${col},${row}`) };
  }
  function evaluate() {
    const winCells = new Set(); let total = 0, ufos = 0;
    for (const line of LINES) {
      const res = linePay(line);
      if (res.win > 0) { total += res.win; res.cells.forEach((k) => winCells.add(k)); }
    }
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) if (grid[c][r] === "ufo") ufos += 1;
    return { total, winCells, ufos };
  }
  async function cascade(winCells) {
    winCells.forEach((k) => {
      const [c, r] = k.split(",").map(Number);
      const cell = strips[c].children[r];
      if (cell) cell.classList.add("pop");
    });
    await wait(280);
    for (let c = 0; c < COLS; c++) {
      const keep = [];
      for (let r = 0; r < ROWS; r++) if (!winCells.has(`${c},${r}`)) keep.push(grid[c][r]);
      const fill = Array.from({ length: ROWS - keep.length }, pick);
      grid[c] = [...fill, ...keep];
    }
    paint();
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
    orbit = 0; setBusy(true); updateHud();
    const next = Array.from({ length: COLS }, () => Array.from({ length: ROWS }, pick));
    await Promise.all(next.map((ids, c) => rollReel(c, ids, BASE_SPIN_MS + c * REEL_STAGGER_MS)));
    let tumbleTotal = 0, cascades = 0, ufoHit = false;
    while (true) {
      const { total, winCells, ufos } = evaluate();
      if (ufos >= 3) ufoHit = true;
      if (total <= 0 || winCells.size === 0) break;
      tumbleTotal += total; paint(winCells); updateHud();
      els.lastWin.textContent = money(tumbleTotal);
      await wait(450); await cascade(winCells);
      cascades += 1; orbit = cascades; updateHud(); await wait(200);
    }
    if (ufoHit) freeSpins += FREE_SPINS;
    if (tumbleTotal > 0) {
      balance += tumbleTotal; els.winAmount.textContent = money(tumbleTotal);
      els.winBanner.classList.remove("hidden"); save();
    }
    setBusy(false); updateHud();
    if (auto || freeSpins > 0) setTimeout(spinOnce, tumbleTotal > 0 ? 1000 : 450);
  }
  els.spinBtn.addEventListener("click", () => { if (auto) { auto = false; updateHud(); return; } spinOnce(); });
  els.autoBtn.addEventListener("click", () => { auto = !auto; updateHud(); if (auto && !spinning) spinOnce(); });
  els.betMinus.addEventListener("click", () => { if (!spinning && freeSpins <= 0) { betIndex = Math.max(0, betIndex - 1); updateHud(); } });
  els.betPlus.addEventListener("click", () => { if (!spinning && freeSpins <= 0) { betIndex = Math.min(BETS.length - 1, betIndex + 1); updateHud(); } });
  buildUI();
})();
