(function () {
  "use strict";

  const COLS = 5;
  const ROWS = 4;
  const START = 12345.67;
  const KEY = "neon-reels-balance";
  const MEGA_KEY = "neon-reels-mega";
  const MINI_KEY = "neon-reels-mini";
  const BETS = [0.5, 1, 2, 5, 10, 20.88];
  const BASE_SPIN_MS = 5200;
  const REEL_STAGGER_MS = 280;
  const BLUR_SYMBOLS = 56;

  const SYMBOLS = [
    { id: "robot", label: "Bot", weight: 3, pays: [0, 0, 12, 60, 250] },
    { id: "katana", label: "Blade", weight: 5, pays: [0, 0, 8, 35, 120] },
    { id: "chip", label: "Chip", scatter: true, weight: 4, pays: [0, 0, 2, 8, 40] },
    { id: "seven", label: "7", weight: 5, pays: [0, 0, 10, 40, 150] },
    { id: "dice", label: "Dice", weight: 8, pays: [0, 0, 5, 20, 70] },
    { id: "drink", label: "Fuel", weight: 9, pays: [0, 0, 4, 15, 50] },
    { id: "coin", label: "Coin", weight: 12, pays: [0, 0, 3, 10, 30] },
    { id: "wild", label: "Wild", wild: true, weight: 3, pays: [0, 0, 15, 80, 300] },
  ];

  const LINES = [
    [1, 1, 1, 1, 1],
    [0, 0, 0, 0, 0],
    [2, 2, 2, 2, 2],
    [3, 3, 3, 3, 3],
    [0, 1, 2, 1, 0],
    [3, 2, 1, 2, 3],
    [1, 0, 0, 0, 1],
    [2, 3, 3, 3, 2],
    [0, 0, 1, 2, 3],
    [3, 3, 2, 1, 0],
    [1, 2, 3, 2, 1],
    [2, 1, 0, 1, 2],
    [0, 1, 1, 1, 0],
    [3, 2, 2, 2, 3],
    [1, 1, 0, 1, 1],
    [2, 2, 3, 2, 2],
    [0, 1, 0, 1, 0],
    [3, 2, 3, 2, 3],
    [1, 0, 1, 2, 1],
    [2, 3, 2, 1, 2],
  ];

  const byId = Object.fromEntries(SYMBOLS.map((s) => [s.id, s]));
  const bag = SYMBOLS.flatMap((s) => Array(s.weight).fill(s.id));

  const els = {
    reels: document.getElementById("reels"),
    balance: document.getElementById("balance"),
    bet: document.getElementById("bet"),
    lastWin: document.getElementById("lastWin"),
    mega: document.getElementById("mega"),
    mini: document.getElementById("mini"),
    spinBtn: document.getElementById("spinBtn"),
    autoBtn: document.getElementById("autoBtn"),
    betMinus: document.getElementById("betMinus"),
    betPlus: document.getElementById("betPlus"),
    winBanner: document.getElementById("winBanner"),
    winAmount: document.getElementById("winAmount"),
    bonusOverlay: document.getElementById("bonusOverlay"),
    hackChips: document.getElementById("hackChips"),
    bonusTotal: document.getElementById("bonusTotal"),
  };

  let balance = Number(localStorage.getItem(KEY)) || START;
  let mega = Number(localStorage.getItem(MEGA_KEY)) || 10088.88;
  let mini = Number(localStorage.getItem(MINI_KEY)) || 208.88;
  let betIndex = 1;
  let spinning = false;
  let auto = false;
  let grid = [];
  let strips = [];

  function money(n) {
    return n.toFixed(2);
  }

  function save() {
    localStorage.setItem(KEY, String(balance));
    localStorage.setItem(MEGA_KEY, String(mega));
    localStorage.setItem(MINI_KEY, String(mini));
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
    els.mega.textContent = money(mega);
    els.mini.textContent = money(mini);
    els.autoBtn.classList.toggle("on", auto);
  }

  function tickJackpots() {
    mega += 0.08 + Math.random() * 0.12;
    mini += 0.01 + Math.random() * 0.03;
    updateHud();
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

    let chips = 0;
    let sevens = 0;
    let robots = 0;
    const chipCells = [];
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const id = grid[c][r];
        if (id === "chip") {
          chips += 1;
          chipCells.push(`${c},${r}`);
        }
        if (id === "seven") sevens += 1;
        if (id === "robot") robots += 1;
      }
    }

    let jackpotWin = 0;
    if (sevens >= 5) {
      jackpotWin += mini;
      mini = 50 + Math.random() * 20;
    }
    if (robots >= 4 && Math.random() < 0.35) {
      jackpotWin += mega;
      mega = 5000 + Math.random() * 1000;
    }
    if (chips >= 3) chipCells.forEach((k) => winCells.add(k));
    return { total: total + jackpotWin, winCells, chips };
  }

  function runHackBonus() {
    return new Promise((resolve) => {
      const prizes = [5, 10, 15, 25, 50, 100].map((m) => m * BETS[betIndex]);
      const picks = [];
      let sum = 0;
      els.hackChips.innerHTML = "";
      els.bonusTotal.textContent = money(0);
      els.bonusOverlay.classList.remove("hidden");

      for (let i = 0; i < 6; i++) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "hack-chip";
        btn.textContent = "◆";
        btn.addEventListener("click", () => {
          if (btn.classList.contains("revealed") || picks.length >= 3) return;
          const prize = prizes[Math.floor(Math.random() * prizes.length)];
          picks.push(prize);
          sum += prize;
          btn.classList.add("revealed");
          btn.textContent = money(prize);
          els.bonusTotal.textContent = money(sum);
          if (picks.length >= 3) {
            setTimeout(() => {
              els.bonusOverlay.classList.add("hidden");
              resolve(sum);
            }, 700);
          }
        });
        els.hackChips.appendChild(btn);
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
    mega += bet * 0.02;
    mini += bet * 0.005;
    save();
    els.winBanner.classList.add("hidden");
    els.lastWin.textContent = money(0);
    setBusy(true);
    updateHud();

    const next = Array.from({ length: COLS }, () => Array.from({ length: ROWS }, pick));
    await Promise.all(
      next.map((finalIds, c) => rollReel(c, finalIds, BASE_SPIN_MS + c * REEL_STAGGER_MS))
    );

    let { total, winCells, chips } = evaluate();
    paint(winCells);

    if (chips >= 3) {
      const bonus = await runHackBonus();
      total += bonus;
      paint(winCells);
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
    if (auto) setTimeout(spinOnce, total > 0 ? 950 : 420);
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

  setInterval(tickJackpots, 1200);
  buildUI();
})();
