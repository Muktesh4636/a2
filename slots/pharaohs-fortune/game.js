/**
 * Shared reel-roll helpers — copied into each classic slot game.
 * Each reel is a window + tall strip that translatesY for a real roll.
 */
(function () {
  "use strict";

  const COLS = 5;
  const ROWS = 3;
  const START_BALANCE = 1000;
  const BALANCE_KEY = "pharaohs-fortune-balance";
  const BETS = [0.2, 0.5, 1, 2, 5, 10, 20];
  const BASE_SPIN_MS = 5200;
  const REEL_STAGGER_MS = 280;
  const BLUR_SYMBOLS = 52;
  const FREE_SPINS_AWARD = 10;

  const SYMBOLS = [
    { id: "pharaoh", label: "Wild", wild: true, weight: 3, pays: [0, 0, 10, 50, 200] },
    { id: "scarab", label: "Scarab", weight: 6, pays: [0, 0, 8, 30, 100] },
    { id: "eye", label: "Horus", weight: 7, pays: [0, 0, 6, 25, 80] },
    { id: "ankh", label: "Ankh", weight: 8, pays: [0, 0, 5, 20, 60] },
    { id: "pyramid", label: "Scatter", scatter: true, weight: 4, pays: [0, 0, 2, 10, 50] },
    { id: "a", label: "A", weight: 12, pays: [0, 0, 3, 10, 30] },
    { id: "k", label: "K", weight: 12, pays: [0, 0, 3, 8, 25] },
    { id: "q", label: "Q", weight: 14, pays: [0, 0, 2, 6, 20] },
    { id: "j", label: "J", weight: 14, pays: [0, 0, 2, 5, 15] },
  ];

  const LINES = [
    [1, 1, 1, 1, 1],
    [0, 0, 0, 0, 0],
    [2, 2, 2, 2, 2],
    [0, 1, 2, 1, 0],
    [2, 1, 0, 1, 2],
    [0, 0, 1, 2, 2],
    [2, 2, 1, 0, 0],
    [1, 0, 0, 0, 1],
    [1, 2, 2, 2, 1],
    [0, 1, 1, 1, 0],
    [2, 1, 1, 1, 2],
    [1, 0, 1, 2, 1],
    [1, 2, 1, 0, 1],
    [0, 1, 0, 1, 0],
    [2, 1, 2, 1, 2],
    [1, 1, 0, 1, 1],
    [1, 1, 2, 1, 1],
    [0, 0, 2, 0, 0],
    [2, 2, 0, 2, 2],
    [0, 2, 0, 2, 0],
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
    fsBadge: document.getElementById("fsBadge"),
    fsCount: document.getElementById("fsCount"),
  };

  let balance = Number(localStorage.getItem(BALANCE_KEY)) || START_BALANCE;
  let betIndex = 2;
  let betMult = 1;
  let spinning = false;
  let auto = false;
  let freeSpins = 0;
  let grid = [];
  let strips = [];
  let windows = [];

  function money(n) {
    return n.toFixed(2);
  }

  function save() {
    localStorage.setItem(BALANCE_KEY, String(balance));
  }

  function pick() {
    return bag[Math.floor(Math.random() * bag.length)];
  }

  function currentBet() {
    return BETS[betIndex] * betMult;
  }

  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

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
    windows = [];
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
      windows.push(win);
      strips.push(strip);
    }
    grid = Array.from({ length: COLS }, () => Array.from({ length: ROWS }, pick));
    paint();
    updateHud();
  }

  function paint(wins = new Set()) {
    for (let c = 0; c < COLS; c++) {
      const strip = strips[c];
      strip.style.transition = "none";
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
    els.bet.textContent = money(currentBet());
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
    strip.style.transition = "none";
    strip.style.transform = "translate3d(0,0,0)";
    strip.innerHTML = "";
    sequence.forEach((id) => strip.appendChild(makeCell(id, false)));
    strip.classList.add("rolling");
    void strip.offsetHeight;
    const travel = stripStep(strip) * (sequence.length - ROWS);

    const anim = strip.animate(
      [
        { transform: "translate3d(0, 0, 0)" },
        { transform: `translate3d(0, ${-travel}px, 0)` },
      ],
      {
        duration,
        easing: "cubic-bezier(0.12, 0.55, 0.08, 1)",
        fill: "forwards",
      }
    );
    await anim.finished;

    strip.classList.remove("rolling");
    grid[col] = finalIds.slice();
    strip.getAnimations().forEach((a) => a.cancel());
    strip.style.transform = "translate3d(0,0,0)";
    strip.innerHTML = "";
    finalIds.forEach((id) => strip.appendChild(makeCell(id, false)));
  }

  function linePay(line) {
    const ids = line.map((row, col) => grid[col][row]);
    let base = ids.find((id) => !byId[id].wild && !byId[id].scatter);
    if (!base) base = ids.find((id) => byId[id].wild) || ids[0];

    let count = 0;
    for (const id of ids) {
      const s = byId[id];
      if (s.scatter) break;
      if (s.wild || id === base) count += 1;
      else break;
    }
    if (count < 3) return { win: 0, cells: [] };
    const mult = byId[base].pays[count - 1] || 0;
    const winCells = line.slice(0, count).map((row, col) => `${col},${row}`);
    return { win: mult * currentBet(), cells: winCells };
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

    let scatters = 0;
    const scatterCells = [];
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        if (byId[grid[c][r]].scatter) {
          scatters += 1;
          scatterCells.push(`${c},${r}`);
        }
      }
    }
    if (scatters >= 3) {
      total += (byId.pyramid.pays[scatters - 1] || 0) * currentBet();
      scatterCells.forEach((k) => winCells.add(k));
    }
    return { total, winCells, scatters };
  }

  function setBusy(busy) {
    spinning = busy;
    els.spinBtn.disabled = busy;
    els.betMinus.disabled = busy || freeSpins > 0;
    els.betPlus.disabled = busy || freeSpins > 0;
  }

  async function spinOnce() {
    if (spinning) return;
    const bet = currentBet();
    const usingFree = freeSpins > 0;

    if (!usingFree) {
      if (balance < bet) {
        auto = false;
        updateHud();
        return;
      }
      balance -= bet;
      save();
    } else {
      freeSpins -= 1;
    }

    els.winBanner.classList.add("hidden");
    els.lastWin.textContent = money(0);
    setBusy(true);
    updateHud();

    const next = Array.from({ length: COLS }, () => Array.from({ length: ROWS }, pick));
    await Promise.all(
      next.map((finalIds, c) => rollReel(c, finalIds, BASE_SPIN_MS + c * REEL_STAGGER_MS))
    );

    const { total, winCells, scatters } = evaluate();
    paint(winCells);

    if (total > 0) {
      balance += total;
      save();
      els.lastWin.textContent = money(total);
      els.winAmount.textContent = money(total);
      els.winBanner.classList.remove("hidden");
    }

    if (scatters >= 3) freeSpins += FREE_SPINS_AWARD;

    setBusy(false);
    updateHud();

    if (auto || freeSpins > 0) {
      setTimeout(spinOnce, total > 0 ? 900 : 400);
    }
  }

  els.spinBtn.addEventListener("click", () => {
    if (auto) {
      auto = false;
      updateHud();
      return;
    }
    spinOnce();
  });

  els.autoBtn.addEventListener("click", () => {
    auto = !auto;
    updateHud();
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

  document.getElementById("mults").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-m]");
    if (!btn || spinning || freeSpins > 0) return;
    betMult = Number(btn.dataset.m);
    document.querySelectorAll("#mults button").forEach((b) => b.classList.toggle("on", b === btn));
    updateHud();
  });

  buildUI();
})();
