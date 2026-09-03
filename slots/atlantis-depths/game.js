(function () {
  "use strict";

  const COLS = 5;
  const ROWS = 4;
  const START = 10245;
  const KEY = "atlantis-depths-balance";
  const PEARL_KEY = "atlantis-pearls";
  const BETS = [0.5, 1, 2.5, 5, 10];
  const BASE_SPIN_MS = 5200;
  const REEL_STAGGER_MS = 280;
  const BLUR_SYMBOLS = 56;
  const PEARL_GOAL = 8;
  const FREE_SPINS = 8;

  const SYMBOLS = [
    { id: "wild", wild: true, weight: 2, pays: [0, 0, 15, 80, 300] },
    { id: "mermaid", expand: true, weight: 3, pays: [0, 0, 12, 60, 200] },
    { id: "trident", weight: 4, pays: [0, 0, 10, 45, 150] },
    { id: "pearl", pearl: true, weight: 5, pays: [0, 0, 6, 25, 80] },
    { id: "turtle", weight: 7, pays: [0, 0, 5, 18, 60] },
    { id: "seahorse", weight: 8, pays: [0, 0, 4, 14, 45] },
    { id: "vase", weight: 10, pays: [0, 0, 3, 10, 35] },
    { id: "crab", weight: 12, pays: [0, 0, 3, 8, 25] },
    { id: "gem", weight: 12, pays: [0, 0, 2, 6, 20] },
  ];

  const LINES = [
    [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [3, 3, 3, 3, 3],
    [0, 1, 2, 1, 0], [3, 2, 1, 2, 3], [1, 0, 0, 0, 1], [2, 3, 3, 3, 2],
    [0, 0, 1, 2, 3], [3, 3, 2, 1, 0], [1, 2, 3, 2, 1], [2, 1, 0, 1, 2],
    [0, 1, 1, 1, 0], [3, 2, 2, 2, 3], [1, 1, 0, 1, 1], [2, 2, 3, 2, 2],
    [0, 1, 0, 1, 0], [3, 2, 3, 2, 3], [1, 0, 1, 2, 1], [2, 3, 2, 1, 2],
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
    pearlFill: document.getElementById("pearlFill"),
    pearlCount: document.getElementById("pearlCount"),
    fsBadge: document.getElementById("fsBadge"),
    fsCount: document.getElementById("fsCount"),
  };

  let balance = Number(localStorage.getItem(KEY)) || START;
  let pearls = Number(localStorage.getItem(PEARL_KEY)) || 0;
  let betIndex = 2;
  let spinning = false;
  let auto = false;
  let freeSpins = 0;
  let grid = [];
  let strips = [];

  function money(n) { return n.toFixed(2); }
  function save() {
    localStorage.setItem(KEY, String(balance));
    localStorage.setItem(PEARL_KEY, String(pearls));
  }
  function pick() { return bag[Math.floor(Math.random() * bag.length)]; }
  function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function makeCell(id, win) {
    const cell = document.createElement("div");
    cell.className = "cell" + (win ? " win" : "");
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

  function paint(wins = new Set()) {
    for (let c = 0; c < COLS; c++) {
      const strip = strips[c];
      strip.getAnimations().forEach((a) => a.cancel());
      strip.style.transform = "translate3d(0,0,0)";
      strip.classList.remove("rolling");
      strip.innerHTML = "";
      for (let r = 0; r < ROWS; r++) {
        strip.appendChild(makeCell(grid[c][r], wins.has(`${c},${r}`)));
      }
    }
  }

  function updateHud() {
    els.balance.textContent = money(balance);
    els.bet.textContent = money(BETS[betIndex]);
    els.pearlCount.textContent = `${pearls}/${PEARL_GOAL}`;
    els.pearlFill.style.height = `${(pearls / PEARL_GOAL) * 100}%`;
    els.fsBadge.classList.toggle("hidden", freeSpins <= 0);
    els.fsCount.textContent = String(freeSpins);
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

  function expandMermaids() {
    for (let c = 0; c < COLS; c++) {
      if (grid[c].some((id) => byId[id].expand)) {
        grid[c] = Array.from({ length: ROWS }, () => "wild");
      }
    }
  }

  function collectPearls() {
    let n = 0;
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        if (byId[grid[c][r]].pearl) n += 1;
      }
    }
    pearls = Math.min(PEARL_GOAL, pearls + n);
    if (pearls >= PEARL_GOAL) {
      pearls = 0;
      freeSpins += FREE_SPINS;
    }
  }

  function linePay(line) {
    const ids = line.map((row, col) => grid[col][row]);
    let base = ids.find((id) => !byId[id].wild && !byId[id].pearl);
    if (!base) base = ids.find((id) => byId[id].wild) || ids[0];
    let count = 0;
    for (const id of ids) {
      const s = byId[id];
      if (s.pearl && !s.wild) break;
      if (s.wild || id === base) count += 1;
      else break;
    }
    if (count < 3) return { win: 0, cells: [] };
    const mult = (byId[base] && byId[base].pays[count - 1]) || 0;
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
    els.betMinus.disabled = busy || freeSpins > 0;
    els.betPlus.disabled = busy || freeSpins > 0;
  }

  async function spinOnce() {
    if (spinning) return;
    const bet = BETS[betIndex];
    const usingFree = freeSpins > 0;
    if (!usingFree) {
      if (balance < bet) { auto = false; updateHud(); return; }
      balance -= bet;
      save();
    } else freeSpins -= 1;

    els.winBanner.classList.add("hidden");
    els.lastWin.textContent = money(0);
    setBusy(true);
    updateHud();

    const next = Array.from({ length: COLS }, () => Array.from({ length: ROWS }, pick));
    await Promise.all(next.map((ids, c) => rollReel(c, ids, BASE_SPIN_MS + c * REEL_STAGGER_MS)));

    expandMermaids();
    collectPearls();
    const { total, winCells } = evaluate();
    paint(winCells);

    if (total > 0) {
      balance += total;
      els.lastWin.textContent = money(total);
      els.winAmount.textContent = money(total);
      els.winBanner.classList.remove("hidden");
    }
    save();
    setBusy(false);
    updateHud();
    if (auto || freeSpins > 0) setTimeout(spinOnce, total > 0 ? 1000 : 450);
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
    if (spinning || freeSpins > 0) return;
    betIndex = Math.max(0, betIndex - 1);
    updateHud();
  });
  els.betPlus.addEventListener("click", () => {
    if (spinning || freeSpins > 0) return;
    betIndex = Math.min(BETS.length - 1, betIndex + 1);
    updateHud();
  });

  buildUI();
})();
