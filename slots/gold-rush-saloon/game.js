(function () {
  "use strict";

  const COLS = 5;
  const ROWS = 3;
  const START = 1234.5;
  const KEY = "gold-rush-balance";
  const JP_KEY = "gold-rush-jackpot";
  const BETS = [0.5, 1, 2.5, 5, 10, 25];
  const BASE_SPIN_MS = 5200;
  const REEL_STAGGER_MS = 280;
  const BLUR_SYMBOLS = 52;

  const SYMBOLS = [
    { id: "wild", wild: true, weight: 3, pays: [0, 0, 12, 60, 250] },
    { id: "badge", weight: 5, pays: [0, 0, 10, 40, 150] },
    { id: "revolver", weight: 6, pays: [0, 0, 8, 30, 100] },
    { id: "whiskey", weight: 7, pays: [0, 0, 5, 20, 70] },
    { id: "nugget", weight: 7, pays: [0, 0, 5, 18, 60] },
    { id: "horseshoe", weight: 9, pays: [0, 0, 4, 12, 40] },
    { id: "dynamite", dynamite: true, weight: 4, pays: [0, 0, 3, 10, 30] },
    { id: "hat", weight: 11, pays: [0, 0, 3, 8, 25] },
    { id: "wanted", scatter: true, weight: 4, pays: [0, 0, 2, 10, 40] },
  ];

  const LINES = [
    [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2],
    [0, 1, 2, 1, 0], [2, 1, 0, 1, 2], [0, 0, 1, 2, 2],
    [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1],
    [0, 1, 1, 1, 0], [2, 1, 1, 1, 2], [1, 0, 1, 2, 1],
    [1, 2, 1, 0, 1], [0, 1, 0, 1, 0], [2, 1, 2, 1, 2],
    [1, 1, 0, 1, 1], [1, 1, 2, 1, 1], [0, 0, 2, 0, 0],
    [2, 2, 0, 2, 2], [0, 2, 0, 2, 0], [0, 2, 1, 2, 0],
    [2, 0, 1, 0, 2], [1, 0, 2, 0, 1], [1, 2, 0, 2, 1],
    [0, 1, 2, 0, 1],
  ];

  const byId = Object.fromEntries(SYMBOLS.map((s) => [s.id, s]));
  const bag = SYMBOLS.flatMap((s) => Array(s.weight).fill(s.id));

  const els = {
    reels: document.getElementById("reels"),
    balance: document.getElementById("balance"),
    bet: document.getElementById("bet"),
    lastWin: document.getElementById("lastWin"),
    jackpot: document.getElementById("jackpot"),
    spinBtn: document.getElementById("spinBtn"),
    autoBtn: document.getElementById("autoBtn"),
    betMinus: document.getElementById("betMinus"),
    betPlus: document.getElementById("betPlus"),
    winBanner: document.getElementById("winBanner"),
    winAmount: document.getElementById("winAmount"),
    boomFlash: document.getElementById("boomFlash"),
  };

  let balance = Number(localStorage.getItem(KEY)) || START;
  let jackpot = Number(localStorage.getItem(JP_KEY)) || 125000;
  let betIndex = 2;
  let spinning = false;
  let auto = false;
  let grid = [];
  let strips = [];

  function money(n) { return n.toFixed(2); }
  function save() {
    localStorage.setItem(KEY, String(balance));
    localStorage.setItem(JP_KEY, String(jackpot));
  }
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

  function paint(wins = new Set(), boom = new Set()) {
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
        if (boom.has(key)) extra += " boom";
        strip.appendChild(makeCell(grid[c][r], extra.trim()));
      }
    }
  }

  function updateHud() {
    els.balance.textContent = money(balance);
    els.bet.textContent = money(BETS[betIndex]);
    els.jackpot.textContent = money(jackpot);
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

  function findDynamite() {
    const spots = [];
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        if (byId[grid[c][r]].dynamite) spots.push([c, r]);
      }
    }
    return spots;
  }

  async function dynamiteRespin(spots) {
    const boom = new Set();
    const refill = new Set();
    spots.forEach(([c, r]) => {
      boom.add(`${c},${r}`);
      for (let dc = -1; dc <= 1; dc++) {
        for (let dr = -1; dr <= 1; dr++) {
          const nc = c + dc;
          const nr = r + dr;
          if (nc >= 0 && nc < COLS && nr >= 0 && nr < ROWS) {
            boom.add(`${nc},${nr}`);
            refill.add(`${nc},${nr}`);
          }
        }
      }
    });
    els.boomFlash.classList.remove("hidden");
    paint(new Set(), boom);
    await wait(600);
    refill.forEach((key) => {
      const [c, r] = key.split(",").map(Number);
      grid[c][r] = pick();
    });
    paint();
    els.boomFlash.classList.add("hidden");
    await wait(200);
  }

  function linePay(line) {
    const ids = line.map((row, col) => grid[col][row]);
    let base = ids.find((id) => !byId[id].wild && !byId[id].scatter && !byId[id].dynamite);
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
    let wanted = 0;
    const wantedCells = [];
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        if (grid[c][r] === "wanted") {
          wanted += 1;
          wantedCells.push(`${c},${r}`);
        }
      }
    }
    if (wanted >= 3) {
      total += (byId.wanted.pays[wanted - 1] || 0) * BETS[betIndex];
      wantedCells.forEach((k) => winCells.add(k));
      if (wanted >= 5 && Math.random() < 0.15) {
        total += jackpot * 0.01;
        jackpot = 100000 + Math.random() * 20000;
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
    jackpot += bet * 0.05;
    save();
    els.winBanner.classList.add("hidden");
    els.boomFlash.classList.add("hidden");
    els.lastWin.textContent = money(0);
    setBusy(true);
    updateHud();

    const next = Array.from({ length: COLS }, () => Array.from({ length: ROWS }, pick));
    await Promise.all(next.map((ids, c) => rollReel(c, ids, BASE_SPIN_MS + c * REEL_STAGGER_MS)));

    const dyn = findDynamite();
    if (dyn.length) await dynamiteRespin(dyn);

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

  setInterval(() => { jackpot += 0.5 + Math.random(); updateHud(); }, 1500);
  buildUI();
})();
