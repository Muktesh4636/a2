/**
 * Shared card-table SFX — bet / deal / flip / win / lose.
 * Expects ./sounds/{bet,deal,flip,win,lose}.mp3 next to the page.
 */
(function (global) {
  const BASE = new URL("./sounds/", location.href).href;
  const cache = new Map();
  let unlocked = false;

  const VOL = {
    bet: 0.55,
    deal: 0.5,
    flip: 0.62,
    win: 0.9,
    lose: 0.85,
  };

  function get(key) {
    try {
      let a = cache.get(key);
      if (!a) {
        a = new Audio(`${BASE}${key}.mp3`);
        a.preload = "auto";
        a.volume = VOL[key] ?? 0.8;
        a.load();
        cache.set(key, a);
      }
      return a;
    } catch (_) {
      return null;
    }
  }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    ["bet", "deal", "flip", "win", "lose"].forEach((k) => {
      const a = get(k);
      if (!a) return;
      try {
        a.muted = true;
        a.volume = 0;
        const p = a.play();
        const finish = () => {
          a.pause();
          a.currentTime = 0;
          a.muted = false;
          a.volume = VOL[k] ?? 0.8;
        };
        if (p && typeof p.then === "function") {
          p.then(finish).catch(() => {
            a.muted = false;
            a.volume = VOL[k] ?? 0.8;
          });
        } else finish();
      } catch (_) {
        a.muted = false;
        a.volume = VOL[k] ?? 0.8;
      }
    });
  }

  function play(key, rate = 1) {
    unlock();
    const base = get(key);
    if (!base) return;
    try {
      const a = base.cloneNode(true);
      a.volume = VOL[key] ?? 0.8;
      a.playbackRate = rate;
      a.currentTime = 0;
      const p = a.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => {
          try {
            base.currentTime = 0;
            void base.play().catch(() => {});
          } catch (_) {}
        });
      }
    } catch (_) {
      try {
        base.currentTime = 0;
        void base.play().catch(() => {});
      } catch (_) {}
    }
  }

  global.CardSfx = {
    unlock,
    bet: () => play("bet"),
    deal: () => play("deal", 0.95 + Math.random() * 0.1),
    flip: () => play("flip", 0.97 + Math.random() * 0.06),
    win: () => play("win"),
    lose: () => play("lose"),
  };

  ["bet", "deal", "flip", "win", "lose"].forEach(get);
})(window);
