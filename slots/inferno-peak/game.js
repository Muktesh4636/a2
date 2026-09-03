(function () {
  "use strict";

  const COLS = 5;
  const ROWS = 4;
  const START = 5000;
  const KEY = "inferno-peak-balance";
  const BETS = [0.5, 1, 2.5, 5, 10];
  const BASE_SPIN_MS = 5200;
  const REEL_STAGGER_MS = 280;
  const BLUR_SYMBOLS = 56;
  const FIRE_MULTS = [1, 2, 3, 5, 8, 12, 20];

  const SYMBOLS = [
    { id: "phoenix", wild: true, weight: 2, pays: [0, 0, 15, 80, 300] },
    { id: "eye", weight: 4, pays: [0, 0, 12, 50, 180] },
    { id: "nugget", weight: 5, pays: [0, 0, 10, 40, 140] },
    { id: "crystal", weight: 6, pays: [0, 0, 8, 28, 100] },
    { id: "skull", weight: 8, pays: [0, 0, 6, 20, 70] },
    { id: "ember", weight: 10, pays: [0, 0, 4, 14, 45] },
    { id: "obsidian", weight: 11, pays: [0, 0, 3, 10, 30] },
    { id: "rune", weight: 12, pays: [0, 0, 2, 7, 20] },
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
    fireMult: document.getElementById("fireMult"),
    fireFill: document.getElementById("fireFill"),
  };

  let balance = Number(localStorage.getItem(KEY)) || START;
  let betIndex = 2;
  let spinning = false;
  let auto = false;
  let fire = 0;
  let grid = [];
  let strips = [];

  function money(n) { return n.toFixed(2); }
  function save() { localStorage.setItem(KEY, String(balance)); }
  function pick() { return bag[Math.floor(Math.random() * bag.length)]; }
  function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
  function currentMult() { return FIRE_MULTS[Math.min(fire, FIRE_MULTS.length - 1)]; }

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

  function paint(wins = new Set()) {
    for (let c = 0; c < COLS; c++) {
      const strip = strips[c];
      strip.getAnimations().forEach((a) => a.cancel());
      strip.style.transform = "translate3d(0,0,0)";
      strip.classList.remove("rolling");
      strip.innerHTML = "";
      for (let r = 0; r < ROWS; r++) {
        strip.appendChild(makeCell(grid[c][r], wins.has(`${c},${r}`) ? "win" : ""));
      }
    }
  }

  function updateHud() {
    els.balance.textContent = money(balance);
    els.bet.textContent = money(BETS[betIndex]);
    els.fireMult.textContent = `×${currentMult()}`;
    els.fireFill.style.height = `${Math.min(100, ((fire + 1) / FIRE_MULTS.length) * 100)}%`;
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

  function linePay(line) {
    const ids = line.map((row, col) => grid[col][row]);
    let base = ids.find((id) => !byId[id].wild);
    if (!base) base = "phoenix";
    let count = 0;
    for (const id of ids) {
      if (byId[id].wild || id === base) count += 1;
      else break;
    }
    if (count < 3) return { win: 0, cells: [] };
    const mult = ((byId[base] && byId[base].pays[count - 1]) || 0) * currentMult();
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

  async function cascade(winCells) {
    winCells.forEach((k) => {
      const [c, r] = k.split(",").map(Number);
      const cell = strips[c].children[r];
      if (cell) cell.classList.add("pop");
    });
    await wait(280);
    for (let c = 0; c < COLS; c++) {
      const keep = [];
      for (let r = 0; r < ROWS; r++) {
        if (!winCells.has(`${c},${r}`)) keep.push(grid[c][r]);
      }
      const fill = Array.from({ length: ROWS - keep.length }, pick);
      grid[c] = [...fill, ...keep];
    }
    paint();
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
    els.lastWin.textContent = money(0);
    fire = 0;
    setBusy(true);
    updateHud();

    const next = Array.from({ length: COLS }, () => Array.from({ length: ROWS }, pick));
    await Promise.all(next.map((ids, c) => rollReel(c, ids, BASE_SPIN_MS + c * REEL_STAGGER_MS)));

    let tumbleTotal = 0;
    while (true) {
      const { total, winCells } = evaluate();
      if (total <= 0 || winCells.size === 0) break;
      tumbleTotal += total;
      paint(winCells);
      updateHud();
      els.lastWin.textContent = money(tumbleTotal);
      await wait(450);
      await cascade(winCells);
      fire += 1;
      updateHud();
      await wait(200);
    }

    if (tumbleTotal > 0) {
      balance += tumbleTotal;
      els.winAmount.textContent = money(tumbleTotal);
      els.winBanner.classList.remove("hidden");
      save();
    }
    setBusy(false);
    updateHud();
    if (auto) setTimeout(spinOnce, tumbleTotal > 0 ? 1000 : 450);
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
