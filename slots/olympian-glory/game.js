(function () {
  "use strict";

  const COLS = 5;
  const ROWS = 3;
  const START = 10000;
  const KEY = "olympian-glory-balance";
  const BETS = [0.5, 1, 2.5, 5, 10];
  const BASE_SPIN_MS = 5200;
  const REEL_STAGGER_MS = 300;
  const BLUR_SYMBOLS = 52;
  const FREE_SPINS = 10;

  const SYMBOLS = [
    { id: "laurel", wild: true, weight: 2, pays: [0, 0, 18, 90, 350] },
    { id: "bolt", scatter: true, weight: 3, pays: [0, 0, 0, 0, 0] },
    { id: "owl", weight: 4, pays: [0, 0, 12, 50, 180] },
    { id: "trident", weight: 5, pays: [0, 0, 10, 40, 140] },
    { id: "sandals", weight: 7, pays: [0, 0, 7, 25, 80] },
    { id: "amphora", weight: 9, pays: [0, 0, 5, 18, 55] },
    { id: "lyre", weight: 11, pays: [0, 0, 4, 12, 35] },
    { id: "alpha", weight: 13, pays: [0, 0, 3, 8, 22] },
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

  const GODS = [
    { id: "zeus", name: "ZEUS", desc: "10 Free Spins", img: "bolt", favor: "free" },
    { id: "athena", name: "ATHENA", desc: "Sticky Wilds", img: "owl", favor: "sticky" },
    { id: "poseidon", name: "POSEIDON", desc: "×3 Win Boost", img: "trident", favor: "mult" },
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
    favorBadge: document.getElementById("favorBadge"),
    favorMult: document.getElementById("favorMult"),
    godOverlay: document.getElementById("godOverlay"),
    godRow: document.getElementById("godRow"),
    godResult: document.getElementById("godResult"),
  };

  let balance = Number(localStorage.getItem(KEY)) || START;
  let betIndex = 2;
  let spinning = false;
  let auto = false;
  let freeSpins = 0;
  let stickyMode = 0;
  let winMult = 1;
  let stickyCells = new Set();
  let grid = [];
  let strips = [];

  function money(n) { return n.toFixed(2); }
  function save() { localStorage.setItem(KEY, String(balance)); }
  function pick() { return bag[Math.floor(Math.random() * bag.length)]; }
  function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function makeCell(id, win, sticky) {
    const cell = document.createElement("div");
    cell.className = "cell" + (win ? " win" : "") + (sticky ? " sticky" : "");
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
        const key = `${c},${r}`;
        strip.appendChild(makeCell(grid[c][r], wins.has(key), stickyCells.has(key)));
      }
    }
  }

  function updateHud() {
    els.balance.textContent = money(balance);
    els.bet.textContent = money(BETS[betIndex]);
    els.fsBadge.classList.toggle("hidden", freeSpins <= 0);
    els.fsCount.textContent = String(freeSpins);
    els.favorBadge.classList.toggle("hidden", winMult <= 1);
    els.favorMult.textContent = String(winMult);
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

  function countBolts() {
    let n = 0;
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        if (byId[grid[c][r]].scatter) n += 1;
      }
    }
    return n;
  }

  function godsFavor() {
    return new Promise((resolve) => {
      els.godRow.innerHTML = "";
      els.godResult.classList.add("hidden");
      els.godOverlay.classList.remove("hidden");
      let done = false;
      GODS.forEach((god) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.innerHTML = `<img src="assets/symbols/${god.img}.png" alt="${god.name}"><strong>${god.name}</strong><small>${god.desc}</small>`;
        btn.addEventListener("click", async () => {
          if (done) return;
          done = true;
          els.godResult.textContent = `${god.name} — ${god.desc}!`;
          els.godResult.classList.remove("hidden");
          await wait(1400);
          els.godOverlay.classList.add("hidden");
          resolve(god.favor);
        });
        els.godRow.appendChild(btn);
      });
    });
  }

  function applyStickyWilds() {
    stickyCells = new Set();
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        if (byId[grid[c][r]].wild) stickyCells.add(`${c},${r}`);
      }
    }
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
    const mult = ((byId[base] && byId[base].pays[count - 1]) || 0) * winMult;
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
    } else {
      freeSpins -= 1;
      if (stickyMode > 0) stickyMode -= 1;
      if (freeSpins <= 0 && winMult > 1) winMult = 1;
    }

    els.winBanner.classList.add("hidden");
    els.lastWin.textContent = money(0);
    setBusy(true);
    updateHud();

    const carried = stickyMode > 0 ? new Set(stickyCells) : new Set();
    const next = Array.from({ length: COLS }, (_, c) =>
      Array.from({ length: ROWS }, (_, r) => (carried.has(`${c},${r}`) ? "laurel" : pick())));
    await Promise.all(next.map((ids, c) => rollReel(c, ids, BASE_SPIN_MS + c * REEL_STAGGER_MS)));

    stickyCells = carried;
    if (stickyMode > 0) applyStickyWilds();

    let total = 0;
    const { total: lineWin, winCells } = evaluate();
    total += lineWin;
    paint(winCells);

    if (countBolts() >= 3) {
      await wait(400);
      const favor = await godsFavor();
      if (favor === "free") freeSpins += FREE_SPINS;
      if (favor === "sticky") { stickyMode = 5; applyStickyWilds(); paint(winCells); }
      if (favor === "mult") winMult = 3;
    }

    if (total > 0) {
      balance += total;
      els.lastWin.textContent = money(total);
      els.winAmount.textContent = money(total);
      els.winBanner.classList.remove("hidden");
    }
    if (stickyMode <= 0) stickyCells = new Set();
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
