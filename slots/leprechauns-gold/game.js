(function () {
  "use strict";

  const COLS = 5;
  const ROWS = 3;
  const START = 1234.56;
  const KEY = "leprechauns-gold-balance";
  const TRAIL_KEY = "leprechauns-gold-trail";
  const BETS = [0.5, 1, 2.5, 5, 10];
  const BASE_SPIN_MS = 5200;
  const REEL_STAGGER_MS = 300;
  const BLUR_SYMBOLS = 52;
  const TRAIL_GOAL = 7;
  const POT_MULT = 50;
  const LUCK_CHANCE = 0.12;

  const SYMBOLS = [
    { id: "clover", wild: true, weight: 2, pays: [0, 0, 18, 90, 350] },
    { id: "rainbow", trail: true, weight: 3, pays: [0, 0, 10, 40, 130] },
    { id: "hat", weight: 5, pays: [0, 0, 8, 30, 100] },
    { id: "pot", weight: 6, pays: [0, 0, 7, 25, 85] },
    { id: "horseshoe", weight: 8, pays: [0, 0, 5, 18, 55] },
    { id: "harp", weight: 9, pays: [0, 0, 4, 14, 40] },
    { id: "ale", weight: 11, pays: [0, 0, 3, 10, 30] },
    { id: "pipe", weight: 12, pays: [0, 0, 2, 7, 20] },
  ];

  const LINES = [
    [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2],
    [0, 1, 2, 1, 0], [2, 1, 0, 1, 2], [1, 0, 0, 0, 1],
    [1, 2, 2, 2, 1], [0, 0, 1, 2, 2], [2, 2, 1, 0, 0],
    [1, 0, 1, 2, 1], [1, 2, 1, 0, 1], [0, 1, 1, 1, 0],
    [2, 1, 1, 1, 2], [0, 1, 0, 1, 0], [2, 1, 2, 1, 2],
    [1, 1, 0, 1, 1], [1, 1, 2, 1, 1], [0, 2, 0, 2, 0],
    [2, 0, 2, 0, 2], [1, 0, 2, 0, 1],
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
    maxBtn: document.getElementById("maxBtn"),
    betMinus: document.getElementById("betMinus"),
    betPlus: document.getElementById("betPlus"),
    winBanner: document.getElementById("winBanner"),
    winAmount: document.getElementById("winAmount"),
    luckBanner: document.getElementById("luckBanner"),
    trailDots: document.getElementById("trailDots"),
  };

  let balance = Number(localStorage.getItem(KEY)) || START;
  let trail = Number(localStorage.getItem(TRAIL_KEY)) || 0;
  let betIndex = 2;
  let spinning = false;
  let auto = false;
  let grid = [];
  let strips = [];
  let tossedCells = new Set();

  function money(n) { return n.toFixed(2); }
  function save() {
    localStorage.setItem(KEY, String(balance));
    localStorage.setItem(TRAIL_KEY, String(trail));
  }
  function pick() { return bag[Math.floor(Math.random() * bag.length)]; }
  function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function makeCell(id, win, tossed) {
    const cell = document.createElement("div");
    cell.className = "cell" + (win ? " win" : "") + (tossed ? " tossed" : "");
    cell.innerHTML = `<img src="assets/symbols/${id}.png" alt="${id}">`;
    return cell;
  }

  function stripStep(strip) {
    const cell = strip.querySelector(".cell");
    if (!cell) return 0;
    const gap = parseFloat(getComputedStyle(strip).rowGap || getComputedStyle(strip).gap) || 0;
    return cell.getBoundingClientRect().height + gap;
  }

  function buildTrail() {
    els.trailDots.innerHTML = "";
    for (let i = 0; i < TRAIL_GOAL; i++) {
      const dot = document.createElement("i");
      if (i < trail) dot.classList.add("lit");
      els.trailDots.appendChild(dot);
    }
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
        const key = `${c},${r}`;
        strip.appendChild(makeCell(grid[c][r], wins.has(key), tossedCells.has(key)));
      }
    }
  }

  function updateHud() {
    els.balance.textContent = money(balance);
    els.bet.textContent = money(BETS[betIndex]);
    els.autoBtn.classList.toggle("on", auto);
    buildTrail();
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

  function collectRainbows() {
    let n = 0;
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        if (byId[grid[c][r]].trail) n += 1;
      }
    }
    trail += n;
    let bonus = 0;
    if (trail >= TRAIL_GOAL) {
      trail = 0;
      bonus = POT_MULT * BETS[betIndex];
    }
    return bonus;
  }

  function leprechaunToss() {
    tossedCells = new Set();
    const count = 2 + Math.floor(Math.random() * 3);
    const spots = [];
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        if (!byId[grid[c][r]].wild) spots.push([c, r]);
      }
    }
    spots.sort(() => Math.random() - 0.5);
    for (const [c, r] of spots.slice(0, count)) {
      grid[c][r] = "clover";
      tossedCells.add(`${c},${r}`);
    }
  }

  function linePay(line) {
    const ids = line.map((row, col) => grid[col][row]);
    let base = ids.find((id) => !byId[id].wild);
    if (!base) base = "clover";
    let count = 0;
    for (const id of ids) {
      if (byId[id].wild || id === base) count += 1;
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
    els.betMinus.disabled = busy;
    els.betPlus.disabled = busy;
    els.maxBtn.disabled = busy;
  }

  async function spinOnce() {
    if (spinning) return;
    const bet = BETS[betIndex];
    if (balance < bet) { auto = false; updateHud(); return; }
    balance -= bet;
    save();

    els.winBanner.classList.add("hidden");
    els.luckBanner.classList.add("hidden");
    els.lastWin.textContent = money(0);
    tossedCells = new Set();
    setBusy(true);
    updateHud();

    const next = Array.from({ length: COLS }, () => Array.from({ length: ROWS }, pick));
    await Promise.all(next.map((ids, c) => rollReel(c, ids, BASE_SPIN_MS + c * REEL_STAGGER_MS)));

    let { total, winCells } = evaluate();

    if (total === 0 && Math.random() < LUCK_CHANCE) {
      els.luckBanner.classList.remove("hidden");
      leprechaunToss();
      await wait(400);
      const re = evaluate();
      total = re.total;
      winCells = re.winCells;
      paint(winCells);
      await wait(900);
      els.luckBanner.classList.add("hidden");
    } else {
      paint(winCells);
    }

    total += collectRainbows();

    if (total > 0) {
      balance += total;
      els.lastWin.textContent = money(total);
      els.winAmount.textContent = money(total);
      els.winBanner.classList.remove("hidden");
    }
    save();
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
  els.maxBtn.addEventListener("click", () => {
    if (spinning) return;
    betIndex = BETS.length - 1;
    updateHud();
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
