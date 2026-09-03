(function () {
  "use strict";

  const COLS = 5;
  const ROWS = 3;
  const START = 10000;
  const KEY = "sultans-treasure-balance";
  const BETS = [0.5, 1, 2.5, 5, 10, 25];
  const BASE_SPIN_MS = 5200;
  const REEL_STAGGER_MS = 300;
  const BLUR_SYMBOLS = 52;
  const FREE_SPINS = 8;

  const SYMBOLS = [
    { id: "tiger", wild: true, weight: 2, pays: [0, 0, 20, 100, 400] },
    { id: "lamp", scatter: true, weight: 3, pays: [0, 0, 0, 0, 0] },
    { id: "carpet", weight: 4, pays: [0, 0, 12, 55, 180] },
    { id: "scimitar", weight: 6, pays: [0, 0, 8, 30, 110] },
    { id: "ring", weight: 8, pays: [0, 0, 6, 22, 70] },
    { id: "camel", weight: 9, pays: [0, 0, 5, 16, 50] },
    { id: "urn", weight: 11, pays: [0, 0, 4, 12, 35] },
    { id: "ace", weight: 13, pays: [0, 0, 3, 8, 22] },
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

  const WISHES = [
    { label: "GOLDEN WISH", mult: 10 },
    { label: "ROYAL WISH", mult: 25 },
    { label: "SULTAN'S WISH", mult: 60 },
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
    turboBtn: document.getElementById("turboBtn"),
    betMinus: document.getElementById("betMinus"),
    betPlus: document.getElementById("betPlus"),
    winBanner: document.getElementById("winBanner"),
    winAmount: document.getElementById("winAmount"),
    fsBadge: document.getElementById("fsBadge"),
    fsCount: document.getElementById("fsCount"),
    genieOverlay: document.getElementById("genieOverlay"),
    lampRow: document.getElementById("lampRow"),
    genieResult: document.getElementById("genieResult"),
  };

  let balance = Number(localStorage.getItem(KEY)) || START;
  let betIndex = 2;
  let spinning = false;
  let auto = false;
  let turbo = false;
  let freeSpins = 0;
  let grid = [];
  let strips = [];

  function money(n) { return n.toFixed(2); }
  function save() { localStorage.setItem(KEY, String(balance)); }
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
    els.fsBadge.classList.toggle("hidden", freeSpins <= 0);
    els.fsCount.textContent = String(freeSpins);
    els.autoBtn.classList.toggle("on", auto);
    els.turboBtn.classList.toggle("on", turbo);
  }

  async function rollReel(col, finalIds, duration) {
    const strip = strips[col];
    const sequence = [];
    for (let r = 0; r < ROWS; r++) sequence.push(grid[col][r]);
    const blur = turbo ? Math.floor(BLUR_SYMBOLS / 3) : BLUR_SYMBOLS;
    for (let i = 0; i < blur + col * 3; i++) sequence.push(pick());
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

  function countLamps() {
    let n = 0;
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        if (byId[grid[c][r]].scatter) n += 1;
      }
    }
    return n;
  }

  function genieWish() {
    return new Promise((resolve) => {
      const prizes = WISHES.slice().sort(() => Math.random() - 0.5);
      els.lampRow.innerHTML = "";
      els.genieResult.classList.add("hidden");
      els.genieResult.textContent = "";
      els.genieOverlay.classList.remove("hidden");
      let done = false;
      prizes.forEach((prize, i) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.innerHTML = `<img src="assets/symbols/lamp.png" alt="lamp ${i + 1}">`;
        btn.addEventListener("click", async () => {
          if (done) return;
          done = true;
          btn.classList.add("revealed");
          const amount = prize.mult * BETS[betIndex];
          els.genieResult.textContent = `${prize.label} — ${money(amount)}!`;
          els.genieResult.classList.remove("hidden");
          await wait(1800);
          els.genieOverlay.classList.add("hidden");
          resolve(amount);
        });
        els.lampRow.appendChild(btn);
      });
    });
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

    const speed = turbo ? 0.35 : 1;
    const next = Array.from({ length: COLS }, () => Array.from({ length: ROWS }, pick));
    await Promise.all(next.map((ids, c) =>
      rollReel(c, ids, (BASE_SPIN_MS + c * REEL_STAGGER_MS) * speed)));

    let total = 0;
    const lamps = countLamps();
    const { total: lineWin, winCells } = evaluate();
    total += lineWin;
    paint(winCells);

    if (lamps >= 3) {
      await wait(500);
      total += await genieWish();
      freeSpins += FREE_SPINS;
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
  els.turboBtn.addEventListener("click", () => {
    turbo = !turbo; updateHud();
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
