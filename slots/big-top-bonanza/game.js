(function () {
  "use strict";

  const COLS = 5;
  const ROWS = 3;
  const START = 2500;
  const KEY = "big-top-bonanza-balance";
  const TRAIL_KEY = "big-top-bonanza-trail";
  const BETS = [0.5, 1, 2.5, 5, 10];
  const BASE_SPIN_MS = 5200;
  const REEL_STAGGER_MS = 300;
  const BLUR_SYMBOLS = 52;
  const TRAIL_GOAL = 6;

  const SYMBOLS = [
    { id: "star", wild: true, weight: 2, pays: [0, 0, 18, 90, 350] },
    { id: "ticket", trail: true, weight: 3, pays: [0, 0, 8, 30, 100] },
    { id: "clown", weight: 4, pays: [0, 0, 12, 50, 180] },
    { id: "tent", weight: 5, pays: [0, 0, 10, 40, 130] },
    { id: "elephant", weight: 7, pays: [0, 0, 7, 25, 80] },
    { id: "hoop", weight: 9, pays: [0, 0, 5, 18, 55] },
    { id: "popcorn", weight: 11, pays: [0, 0, 4, 12, 35] },
    { id: "balloon", weight: 12, pays: [0, 0, 3, 8, 22] },
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

  const BOOTHS = [
    { label: "RING TOSS", mult: 15, img: "hoop" },
    { label: "STRONGMAN", mult: 30, img: "elephant" },
    { label: "JACKPOT TENT", mult: 75, img: "tent" },
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
    trailDots: document.getElementById("trailDots"),
    boothOverlay: document.getElementById("boothOverlay"),
    boothRow: document.getElementById("boothRow"),
    boothResult: document.getElementById("boothResult"),
  };

  let balance = Number(localStorage.getItem(KEY)) || START;
  let trail = Number(localStorage.getItem(TRAIL_KEY)) || 0;
  let betIndex = 2;
  let spinning = false;
  let auto = false;
  let grid = [];
  let strips = [];

  function money(n) { return n.toFixed(2); }
  function save() {
    localStorage.setItem(KEY, String(balance));
    localStorage.setItem(TRAIL_KEY, String(trail));
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
        strip.appendChild(makeCell(grid[c][r], wins.has(`${c},${r}`)));
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

  function collectTickets() {
    let n = 0;
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        if (byId[grid[c][r]].trail) n += 1;
      }
    }
    trail += n;
    return trail >= TRAIL_GOAL;
  }

  function carnivalBooths() {
    return new Promise((resolve) => {
      const prizes = BOOTHS.slice().sort(() => Math.random() - 0.5);
      els.boothRow.innerHTML = "";
      els.boothResult.classList.add("hidden");
      els.boothOverlay.classList.remove("hidden");
      let done = false;
      prizes.forEach((booth) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.innerHTML = `<img src="assets/symbols/${booth.img}.png" alt="${booth.label}"><strong>${booth.label}</strong>`;
        btn.addEventListener("click", async () => {
          if (done) return;
          done = true;
          const amount = booth.mult * BETS[betIndex];
          els.boothResult.textContent = `${booth.label} — ${money(amount)}!`;
          els.boothResult.classList.remove("hidden");
          await wait(1600);
          els.boothOverlay.classList.add("hidden");
          resolve(amount);
        });
        els.boothRow.appendChild(btn);
      });
    });
  }

  function linePay(line) {
    const ids = line.map((row, col) => grid[col][row]);
    let base = ids.find((id) => !byId[id].wild);
    if (!base) base = "star";
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
  }

  async function spinOnce() {
    if (spinning) return;
    const bet = BETS[betIndex];
    if (balance < bet) { auto = false; updateHud(); return; }
    balance -= bet;
    save();

    els.winBanner.classList.add("hidden");
    els.lastWin.textContent = money(0);
    setBusy(true);
    updateHud();

    const next = Array.from({ length: COLS }, () => Array.from({ length: ROWS }, pick));
    await Promise.all(next.map((ids, c) => rollReel(c, ids, BASE_SPIN_MS + c * REEL_STAGGER_MS)));

    let { total, winCells } = evaluate();
    paint(winCells);

    if (collectTickets()) {
      trail = 0;
      await wait(400);
      total += await carnivalBooths();
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
