/**
 * Plinko SFX via HTMLAudioElement (reliable in WebView / mobile).
 * Files in /plinko/sounds/*.mp3
 */

const cache = new Map();
let unlocked = false;
let lastPegAt = 0;

const BASE = (import.meta.env.BASE_URL || "/plinko/").replace(/\/?$/, "/");

function urlFor(name) {
  return `${BASE}sounds/${name}.mp3`;
}

function getAudio(name) {
  try {
    let a = cache.get(name);
    if (!a) {
      a = new Audio(urlFor(name));
      a.preload = "auto";
      a.volume = 0.95;
      cache.set(name, a);
    }
    return a;
  } catch {
    return null;
  }
}

/** Unlock all clips on first user tap (required on mobile). */
export function unlockGameAudio() {
  if (unlocked) return;
  unlocked = true;
  for (const name of ["drop", "peg", "bucket_low", "bucket_mid", "bucket_high"]) {
    const a = getAudio(name);
    if (!a) continue;
    try {
      a.muted = true;
      a.volume = 0;
      const p = a.play();
      const finish = () => {
        a.pause();
        a.currentTime = 0;
        a.muted = false;
        a.volume = 0.95;
      };
      if (p && typeof p.then === "function") {
        p.then(finish).catch(() => {
          a.muted = false;
          a.volume = 0.95;
        });
      } else {
        finish();
      }
    } catch {
      a.muted = false;
      a.volume = 0.95;
    }
  }
}

function play(name) {
  unlockGameAudio();
  const base = getAudio(name);
  if (!base) return;
  try {
    const a = base.cloneNode(true);
    a.volume = 0.95;
    a.currentTime = 0;
    void a.play().catch(() => {
      try {
        base.currentTime = 0;
        void base.play().catch(() => {});
      } catch {
        /* ignore */
      }
    });
  } catch {
    try {
      base.currentTime = 0;
      void base.play().catch(() => {});
    } catch {
      /* ignore */
    }
  }
}

/** Ball release */
export function playDropSound() {
  play("drop");
}

/** Peg bounce — rate-limited */
export function playPegSound() {
  const now = performance.now();
  if (now - lastPegAt < 26) return;
  lastPegAt = now;
  play("peg");
}

/** Bucket land — pick clip by multiplier */
export function playBucketSound(mult = 1) {
  const m = Number(mult) || 1;
  if (m < 0.6) play("bucket_low");
  else if (m < 1.5) play("bucket_mid");
  else play("bucket_high");
}

// Preload
for (const name of ["drop", "peg", "bucket_low", "bucket_mid", "bucket_high"]) {
  getAudio(name);
}
