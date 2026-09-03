(function () {
  "use strict";

  const COLS = 5;
  const ROWS = 3;
  const START = 1250;
  const KEY = "thunder-asgard-balance";
  const BETS = [0.5, 1, 2.5, 5, 10, 25];
  const BASE_SPIN_MS = 5200;
  const REEL_STAGGER_MS = 280;
  const BLUR_SYMBOLS = 52;

  const SYMBOLS = [
    { id: "hammer", wild: true, weight: 3, pays: [0, 0, 12, 60, 250] },
    { id: "raven", weight: 5, pays: [0, 0, 8, 35, 120] },
    { id: "ship", weight: 6, pays: [0, 0, 6, 25, 90] },
    { id: "horn", weight: 7, pays: [0, 0, 5, 20, 70] },
    { id: "rune", weight: 8, pays: [0, 0, 4, 15, 50] },
    { id: "shield", weight: 9, pays: [0, 0, 4, 12, 40] },
    { id: "a", weight: 12, pays: [0, 0, 3, 10, 30] },
    { id: "k", weight: 12, pays: [0, 0, 3, 8, 25] },
    { id: "q", weight: 14, pays: [0, 0, 2, 6, 20] },
    { id: "j", weight: 14, pays: [0, 0, 2, 5, 15] },
  ];

  const LINES = [
    [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2],
    [0, 1, 2, 1, 0], [2, 1, 0, 1, 2], [0, 0, 1, 2, 2],
    [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1],
    [0, 1, 1, 1, 0], [2, 1, 1, 1, 2], [1, 0, 1, 2, 1],
    [1, 2, 1, 0, 1], [0, 1, 0, 1, 0], [2, 1, 2, 1, 2],
    [1, 1, 0, 1, 1], [1, 1, 2, 1, 1], [0, 0, 2, 0, 0],
    [2, 2, 0, 2, 2], [0, 2, 0, 2, 0],
  ];

  const byId = Object.fromEntries(SYMBOLS.map((s) => [s.id, s]));
  const bag = SYMBOLS.flatMap((s) => Array(s.weight).fill(s.id));

  const els = {
    reels: document.getElementById("reels"),
    balance: document.getElementById("balance"),
    bet: document.getElementById("bet"),
    lastWin: document.getElementById("lastWin"),
    spinBtn: document.getElementById("spinBtn"),
    autoBtn: document.getElementById("autoBtn"),
    betMinus: document.getElementById("betMinus"),
    betPlus: document.getElementById("betPlus"),
    winBanner: document.getElementById("winBanner"),
    winAmount: document.getElementById("winAmount"),
    strikeFlash: document.getElementById("strikeFlash"),
  };

  let balance = Number(localStorage.getItem(KEY)) || START;
  let betIndex = 2;
  let spinning = false;
  let auto = false;
  let grid = [];
  let strips = [];

  function money(n) { return n.toFixed(2); }
  function save() { localStorage.setItem(KEY, String(balance)); }
  function pick() { return bag[Math.floor(Math.random() * bag.length)]; }
  function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function makeCell(id, extra) {
    const cell = document.createElement("div");
    cell.className = "cell" + (extra ? " " + extra : "");
    cell.innerHTML = `<img src="assets/symbols/${id}.png" alt="${id}">`;
    return cell;
  }

  function stripStep(strip) {
    const cell = strip.querySelector(".cell");
    if (!cell) return 0;
    const gap = parseFloat(getComputedStyle(strip).rowGap || getComputedStyle(strip).gap) || 0;
    return cell.getBoundingClientRect().height + gap;
  }

  function buildUI() {
    els.reels.innerHTML = "";
    strips = [];
    for (let c = 0; c < COLS; c++) {
      const reel = document.createElement("div");
      reel.className = "reel";
      const win = document.createElement("div");
      win.className = "reel-window";
      const strip = document.createElement("div");
      strip.className = "reel-strip";
      win.appendChild(strip);
      reel.appendChild(win);
      els.reels.appendChild(reel);
      strips.push(strip);
    }
    grid = Array.from({ length: COLS }, () => Array.from({ length: ROWS }, pick));
    paint();
    updateHud();
  }

  function paint(wins = new Set(), struck = new Set()) {
    for (let c = 0; c < COLS; c++) {
      const strip = strips[c];
      strip.getAnimations().forEach((a) => a.cancel());
      strip.style.transform = "translate3d(0,0,0)";
      strip.classList.remove("rolling");
      strip.innerHTML = "";
      for (let r = 0; r < ROWS; r++) {
        const key = `${c},${r}`;
        let extra = "";
        if (wins.has(key)) extra += " win";
        if (struck.has(key)) extra += " struck";
        strip.appendChild(makeCell(grid[c][r], extra.trim()));
      }
    }
  }

  function updateHud() {
    els.balance.textContent = money(balance);
    els.bet.textContent = money(BETS[betIndex]);
    els.autoBtn.classList.toggle("on", auto);
  }

  async function rollReel(col, finalIds, duration) {
    const strip = strips[col];
    const sequence = [];
    for (let r = 0; r < ROWS; r++) sequence.push(grid[col][r]);
    for (let i = 0; i < BLUR_SYMBOLS + col * 3; i++) sequence.push(pick());
    finalIds.forEach((id) => sequence.push(id));

    strip.getAnimations().forEach((a) => a.cancel());
    strip.style.transform = "translate3d(0,0,0)";
    strip.innerHTML = "";
    sequence.forEach((id) => strip.appendChild(makeCell(id)));
    strip.classList.add("rolling");
    void strip.offsetHeight;
    const travel = stripStep(strip) * (sequence.length - ROWS);
    const anim = strip.animate(
      [{ transform: "translate3d(0,0,0)" }, { transform: `translate3d(0,${-travel}px,0)` }],
      { duration, easing: "cubic-bezier(0.12, 0.55, 0.08, 1)", fill: "forwards" }
    );
    await anim.finished;
    strip.classList.remove("rolling");
    grid[col] = finalIds.slice();
    strip.getAnimations().forEach((a) => a.cancel());
    strip.style.transform = "translate3d(0,0,0)";
    strip.innerHTML = "";
    finalIds.forEach((id) => strip.appendChild(makeCell(id)));
  }

  function lightningStrike() {
    const struck = new Set();
    if (Math.random() > 0.32) return struck;
    const count = 2 + Math.floor(Math.random() * 3);
    const spots = [];
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) spots.push([c, r]);
    for (let i = spots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [spots[i], spots[j]] = [spots[j], spots[i]];
    }
    for (let i = 0; i < count; i++) {
      const [c, r] = spots[i];
      grid[c][r] = "hammer";
      struck.add(`${c},${r}`);
    }
    return struck;
  }

  function linePay(line) {
    const ids = line.map((row, col) => grid[col][row]);
    let base = ids.find((id) => !byId[id].wild);
    if (!base) base = ids[0];
    let count = 0;
    for (const id of ids) {
      if (byId[id].wild || id === base) count += 1;
      else break;
    }
    if (count < 3) return { win: 0, cells: [] };
    const mult = byId[base].pays[count - 1] || 0;
    return {
      win: mult * BETS[betIndex],
      cells: line.slice(0, count).map((row, col) => `${col},${row}`),
    };
  }

  function evaluate() {
    const winCells = new Set();
    let total = 0;
    for (const line of LINES) {
      const res = linePay(line);
      if (res.win > 0) {
        total += res.win;
        res.cells.forEach((k) => winCells.add(k));
      }
    }
    return { total, winCells };
  }

  function setBusy(busy) {
    spinning = busy;
    els.spinBtn.disabled = busy;
    els.betMinus.disabled = busy;
    els.betPlus.disabled = busy;
  }

  async function spinOnce() {
    if (spinning) return;
    const bet = BETS[betIndex];
    if (balance < bet) { auto = false; updateHud(); return; }
    balance -= bet;
    save();
    els.winBanner.classList.add("hidden");
    els.strikeFlash.classList.add("hidden");
    els.lastWin.textContent = money(0);
    setBusy(true);
    updateHud();

    const next = Array.from({ length: COLS }, () => Array.from({ length: ROWS }, pick));
    await Promise.all(next.map((ids, c) => rollReel(c, ids, BASE_SPIN_MS + c * REEL_STAGGER_MS)));

    const struck = lightningStrike();
    if (struck.size) {
      els.strikeFlash.classList.remove("hidden");
      paint(new Set(), struck);
      await wait(700);
    }

    const { total, winCells } = evaluate();
    paint(winCells, struck);

    if (total > 0) {
      balance += total;
      els.lastWin.textContent = money(total);
      els.winAmount.textContent = money(total);
      els.winBanner.classList.remove("hidden");
      save();
    }

    setBusy(false);
    updateHud();
    if (auto) setTimeout(spinOnce, total > 0 ? 1000 : 450);
  }

  els.spinBtn.addEventListener("click", () => {
    if (auto) { auto = false; updateHud(); return; }
    spinOnce();
  });
  els.autoBtn.addEventListener("click", () => {
    auto = !auto; updateHud();
    if (auto && !spinning) spinOnce();
  });
  els.betMinus.addEventListener("click", () => {
    if (spinning) return;
    betIndex = Math.max(0, betIndex - 1);
    updateHud();
  });
  els.betPlus.addEventListener("click", () => {
    if (spinning) return;
    betIndex = Math.min(BETS.length - 1, betIndex + 1);
    updateHud();
  });

  buildUI();
})();
