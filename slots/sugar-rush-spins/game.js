(function () {
  "use strict";

  const COLS = 6;
  const ROWS = 5;
  const START = 1234.56;
  const KEY = "sugar-rush-balance";
  const BETS = [0.5, 1, 2, 5, 10];
  const MULTS = [1, 2, 3, 5, 7, 10];
  const BASE_SPIN_MS = 5200;
  const REEL_STAGGER_MS = 250;
  const BLUR_SYMBOLS = 48;
  const CLUSTER_PAY = {
    5: 2,
    6: 3,
    7: 5,
    8: 8,
    9: 12,
    10: 18,
    11: 25,
    12: 40,
  };

  const SYMBOLS = [
    { id: "heart", weight: 10 },
    { id: "bean", weight: 12 },
    { id: "orange", weight: 12 },
    { id: "lolli", weight: 9 },
    { id: "blue", weight: 11 },
    { id: "star", weight: 7 },
    { id: "rainbow", weight: 8 },
  ];

  const bag = SYMBOLS.flatMap((s) => Array(s.weight).fill(s.id));

  const els = {
    grid: document.getElementById("grid"),
    balance: document.getElementById("balance"),
    bet: document.getElementById("bet"),
    lastWin: document.getElementById("lastWin"),
    tumbleWin: document.getElementById("tumbleWin"),
    levels: document.getElementById("levels"),
    spinBtn: document.getElementById("spinBtn"),
    autoBtn: document.getElementById("autoBtn"),
    betMinus: document.getElementById("betMinus"),
    betPlus: document.getElementById("betPlus"),
    winBanner: document.getElementById("winBanner"),
    winAmount: document.getElementById("winAmount"),
  };

  let balance = Number(localStorage.getItem(KEY)) || START;
  let betIndex = 2;
  let spinning = false;
  let auto = false;
  let grid = [];
  let strips = [];
  let cells = [];
  let multIndex = 0;

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

  function makeCell(id, extraClass) {
    const cell = document.createElement("div");
    cell.className = "cell" + (extraClass ? " " + extraClass : "");
    cell.innerHTML = `<img src="assets/symbols/${id}.png" alt="${id}">`;
    return cell;
  }

  function stripStep(strip) {
    const cell = strip.querySelector(".cell");
    if (!cell) return 0;
    const gap = parseFloat(getComputedStyle(strip).rowGap || getComputedStyle(strip).gap) || 0;
    return cell.getBoundingClientRect().height + gap;
  }

  function syncCells() {
    cells = strips.map((strip) => Array.from(strip.children));
  }

  function buildLevels() {
    els.levels.innerHTML = "";
    MULTS.forEach((m, i) => {
      const el = document.createElement("div");
      el.className = "level" + (i === 0 ? " active" : "");
      el.dataset.i = String(i);
      el.textContent = `x${m}`;
      els.levels.appendChild(el);
    });
  }

  function setMult(i) {
    multIndex = Math.min(i, MULTS.length - 1);
    els.levels.querySelectorAll(".level").forEach((el) => {
      el.classList.toggle("active", Number(el.dataset.i) === multIndex);
    });
  }

  function buildUI() {
    els.grid.innerHTML = "";
    els.grid.classList.add("reel-grid");
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
      els.grid.appendChild(reel);
      strips.push(strip);
    }
    grid = Array.from({ length: COLS }, () => Array.from({ length: ROWS }, pick));
    buildLevels();
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
        strip.appendChild(makeCell(grid[c][r], wins.has(`${c},${r}`) ? "win" : ""));
      }
    }
    syncCells();
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
    for (let i = 0; i < BLUR_SYMBOLS + col * 2; i++) sequence.push(pick());
    finalIds.forEach((id) => sequence.push(id));

    strip.getAnimations().forEach((a) => a.cancel());
    strip.style.transition = "none";
    strip.style.transform = "translate3d(0,0,0)";
    strip.innerHTML = "";
    sequence.forEach((id) => strip.appendChild(makeCell(id)));
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
    finalIds.forEach((id) => strip.appendChild(makeCell(id)));
  }

  function neighbors(c, r) {
    return [
      [c - 1, r],
      [c + 1, r],
      [c, r - 1],
      [c, r + 1],
    ].filter(([x, y]) => x >= 0 && x < COLS && y >= 0 && y < ROWS);
  }

  function findClusters() {
    const seen = new Set();
    const clusters = [];
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const key = `${c},${r}`;
        if (seen.has(key)) continue;
        const id = grid[c][r];
        const stack = [[c, r]];
        const group = [];
        seen.add(key);
        while (stack.length) {
          const [x, y] = stack.pop();
          group.push([x, y]);
          for (const [nx, ny] of neighbors(x, y)) {
            const nk = `${nx},${ny}`;
            if (!seen.has(nk) && grid[nx][ny] === id) {
              seen.add(nk);
              stack.push([nx, ny]);
            }
          }
        }
        if (group.length >= 5) clusters.push({ id, cells: group });
      }
    }
    return clusters;
  }

  function clusterPay(size) {
    if (size >= 12) return CLUSTER_PAY[12];
    return CLUSTER_PAY[size] || 0;
  }

  async function removeAndDrop(clusters) {
    const remove = new Set();
    clusters.forEach((cl) => cl.cells.forEach(([c, r]) => remove.add(`${c},${r}`)));
    syncCells();
    remove.forEach((k) => {
      const [c, r] = k.split(",").map(Number);
      if (cells[c] && cells[c][r]) cells[c][r].classList.add("pop");
    });
    await wait(280);

    for (let c = 0; c < COLS; c++) {
      const remaining = [];
      for (let r = 0; r < ROWS; r++) {
        if (!remove.has(`${c},${r}`)) remaining.push(grid[c][r]);
      }
      const fill = Array.from({ length: ROWS - remaining.length }, pick);
      grid[c] = [...fill, ...remaining];
    }

    paint();
    syncCells();
    cells.flat().forEach((cell) => cell.classList.add("drop"));
    await wait(280);
    cells.flat().forEach((cell) => cell.classList.remove("drop"));
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
    els.tumbleWin.textContent = money(0);
    setMult(0);
    setBusy(true);
    updateHud();

    const next = Array.from({ length: COLS }, () => Array.from({ length: ROWS }, pick));
    await Promise.all(
      next.map((finalIds, c) => rollReel(c, finalIds, BASE_SPIN_MS + c * REEL_STAGGER_MS))
    );
    syncCells();

    let tumbleTotal = 0;
    let cascades = 0;

    while (true) {
      const clusters = findClusters();
      if (!clusters.length) break;

      const winSet = new Set();
      let roundPay = 0;
      for (const cl of clusters) {
        cl.cells.forEach(([c, r]) => winSet.add(`${c},${r}`));
        roundPay += clusterPay(cl.cells.length) * bet;
      }
      roundPay *= MULTS[multIndex];
      tumbleTotal += roundPay;
      els.tumbleWin.textContent = money(tumbleTotal);
      paint(winSet);
      await wait(450);
      await removeAndDrop(clusters);
      cascades += 1;
      setMult(cascades);
      await wait(200);
    }

    if (tumbleTotal > 0) {
      balance += tumbleTotal;
      els.lastWin.textContent = money(tumbleTotal);
      els.winAmount.textContent = money(tumbleTotal);
      els.winBanner.classList.remove("hidden");
      save();
    }

    setBusy(false);
    updateHud();
    if (auto) setTimeout(spinOnce, tumbleTotal > 0 ? 1000 : 450);
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
