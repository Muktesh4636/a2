(function () {
  "use strict";

  const COLS = 5;
  const ROWS = 3;
  const START = 1250;
  const KEY = "jackpot-plunder-balance";
  const BETS = [0.5, 1, 2.5, 5, 10, 25];
  const BASE_SPIN_MS = 5200;
  const REEL_STAGGER_MS = 280;
  const BLUR_SYMBOLS = 52;

  const SYMBOLS = [
    { id: "skull", label: "Wild", wild: true, weight: 3, pays: [0, 0, 12, 60, 250] },
    { id: "chest", label: "Scatter", scatter: true, weight: 4, pays: [0, 0, 2, 10, 40] },
    { id: "parrot", label: "Parrot", weight: 6, pays: [0, 0, 8, 30, 100] },
    { id: "cutlass", label: "Swords", weight: 7, pays: [0, 0, 6, 25, 80] },
    { id: "rum", label: "Rum", weight: 9, pays: [0, 0, 5, 18, 55] },
    { id: "compass", label: "Compass", weight: 10, pays: [0, 0, 4, 14, 45] },
    { id: "coin", label: "Coin", weight: 14, pays: [0, 0, 3, 10, 30] },
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
    chestOverlay: document.getElementById("chestOverlay"),
    chests: document.getElementById("chests"),
  };

  let balance = Number(localStorage.getItem(KEY)) || START;
  let betIndex = 2;
  let spinning = false;
  let auto = false;
  let grid = [];
  let strips = [];

  function money(n) {
    return n.toFixed(2);
  }

  function save() {
    localStorage.setItem(KEY, String(balance));
  }

  function pick() {
    return bag[Math.floor(Math.random() * bag.length)];
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

  function evaluateWays() {
    const winCells = new Set();
    let total = 0;
    const paySymbols = SYMBOLS.filter((s) => !s.scatter);

    for (const sym of paySymbols) {
      const matches = [];
      for (let c = 0; c < COLS; c++) {
        const rows = [];
        for (let r = 0; r < ROWS; r++) {
          const id = grid[c][r];
          if (id === sym.id || byId[id].wild) rows.push(r);
        }
        if (rows.length === 0) break;
        matches.push(rows);
      }
      if (matches.length < 3) continue;

      let ways = 1;
      matches.forEach((rows) => {
        ways *= rows.length;
      });
      const mult = sym.pays[matches.length - 1] || 0;
      const win = ways * mult * (BETS[betIndex] / 10);
      if (win > 0) {
        total += win;
        matches.forEach((rows, c) => rows.forEach((r) => winCells.add(`${c},${r}`)));
      }
    }

    let chests = 0;
    const chestCells = [];
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        if (grid[c][r] === "chest") {
          chests += 1;
          chestCells.push(`${c},${r}`);
        }
      }
    }
    if (chests >= 3) {
      total += (byId.chest.pays[chests - 1] || 0) * BETS[betIndex];
      chestCells.forEach((k) => winCells.add(k));
    }

    return { total, winCells, chests };
  }

  function pickChestBonus() {
    return new Promise((resolve) => {
      const prizes = [5, 10, 25, 50, 100].map((m) => m * BETS[betIndex]);
      els.chests.innerHTML = "";
      els.chestOverlay.classList.remove("hidden");
      let done = false;

      for (let i = 0; i < 3; i++) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "chest-btn";
        btn.innerHTML = `<img src="assets/symbols/chest.png" alt="chest" style="width:70%;height:70%;object-fit:contain">`;
        btn.addEventListener("click", () => {
          if (done) return;
          done = true;
          const prize = prizes[Math.floor(Math.random() * prizes.length)];
          btn.classList.add("opened");
          btn.textContent = money(prize);
          setTimeout(() => {
            els.chestOverlay.classList.add("hidden");
            resolve(prize);
          }, 700);
        });
        els.chests.appendChild(btn);
      }
    });
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
    if (balance < bet) {
      auto = false;
      updateHud();
      return;
    }

    balance -= bet;
    save();
    els.winBanner.classList.add("hidden");
    els.lastWin.textContent = money(0);
    setBusy(true);
    updateHud();

    const next = Array.from({ length: COLS }, () => Array.from({ length: ROWS }, pick));
    await Promise.all(
      next.map((finalIds, c) => rollReel(c, finalIds, BASE_SPIN_MS + c * REEL_STAGGER_MS))
    );

    let { total, winCells, chests } = evaluateWays();
    paint(winCells);

    if (chests >= 3) {
      const bonus = await pickChestBonus();
      total += bonus;
    }

    if (total > 0) {
      balance += total;
      els.lastWin.textContent = money(total);
      els.winAmount.textContent = money(total);
      els.winBanner.classList.remove("hidden");
    }

    save();
    setBusy(false);
    updateHud();
    if (auto) setTimeout(spinOnce, total > 0 ? 900 : 420);
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
