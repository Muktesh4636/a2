/**
 * Casino Games lobby — tap → Play; long-press → sticky in-tile preview
 * Release keeps preview playing. Long-press another tile swaps preview.
 */
import { GAMES } from "./games.js";

const LONG_PRESS_MS = 420;
const MOVE_CANCEL_PX = 14;
/** Native Activities — cannot iframe-preview in the tile */
const NATIVE_ONLY = new Set(["chit-pat", "rangu"]);

function readAccessToken() {
  const params = new URLSearchParams(location.search);
  const q =
    params.get("token") ||
    params.get("access_token") ||
    params.get("accessToken") ||
    params.get("access");
  if (q) {
    try {
      localStorage.setItem("gundu_access_token", q);
    } catch (_) {}
    return q;
  }
  try {
    return (
      localStorage.getItem("gundu_access_token") ||
      localStorage.getItem("access_token") ||
      ""
    );
  } catch (_) {
    return "";
  }
}

function withToken(path) {
  const token = readAccessToken();
  const url = new URL(path, location.origin);
  if (token) url.searchParams.set("token", token);
  return url;
}

const grid = document.getElementById("gameGrid");
let selectedId = null;

let pressTimer = null;
let previewCard = null;
let previewGameId = null;
let pressStart = null;
let previewStartedThisPress = false;
let pressGame = null;
let pressCard = null;

function clearSelection() {
  selectedId = null;
  grid.querySelectorAll(".card.is-selected").forEach((el) => {
    el.classList.remove("is-selected");
  });
}

function selectCard(card, game) {
  if (selectedId === game.id) return;
  clearSelection();
  selectedId = game.id;
  card.classList.add("is-selected");
}

function playGame(game) {
  const url = withToken(game.path).toString();
  try {
    if (window.AndroidBridge && typeof window.AndroidBridge.openGame === "function") {
      window.AndroidBridge.openGame(game.id, url);
      return;
    }
  } catch (_) {}
  location.href = url;
}

function clearPressTimer() {
  if (pressTimer) {
    clearTimeout(pressTimer);
    pressTimer = null;
  }
}

function stopPreview() {
  clearPressTimer();
  if (previewCard) {
    previewCard.classList.remove("is-previewing");
    previewCard.querySelectorAll(".card-preview").forEach((el) => el.remove());
    previewCard = null;
    previewGameId = null;
  }
}

function startPreview(card, game) {
  if (NATIVE_ONLY.has(game.id)) return;
  // Already previewing this tile — keep it
  if (previewGameId === game.id && previewCard === card) {
    previewStartedThisPress = true;
    return;
  }
  // Switch: stop old preview, start this one
  stopPreview();
  clearSelection();
  previewStartedThisPress = true;
  previewCard = card;
  previewGameId = game.id;
  card.classList.add("is-previewing");

  const rect = card.getBoundingClientRect();
  const tileW = Math.max(1, Math.round(rect.width));
  const tileH = Math.max(1, Math.round(rect.height));

  const wrap = document.createElement("div");
  wrap.className = "card-preview";

  const iframe = document.createElement("iframe");
  const url = withToken(game.path);
  url.searchParams.set("preview", "1");
  iframe.src = url.toString();
  iframe.title = `${game.title} preview`;
  iframe.width = String(tileW);
  iframe.height = String(tileH);
  iframe.style.width = `${tileW}px`;
  iframe.style.height = `${tileH}px`;
  iframe.setAttribute("loading", "eager");
  iframe.setAttribute("allow", "autoplay");
  iframe.referrerPolicy = "no-referrer-when-downgrade";

  wrap.appendChild(iframe);
  card.querySelector(".card-media").appendChild(wrap);

  try {
    navigator.vibrate?.(18);
  } catch (_) {}
}

function onPressStart(e, card, game) {
  if (e.button != null && e.button !== 0) return;
  clearPressTimer();
  previewStartedThisPress = false;
  pressCard = card;
  pressGame = game;
  const pt = e.touches ? e.touches[0] : e;
  pressStart = { x: pt.clientX, y: pt.clientY };
  pressTimer = setTimeout(() => {
    pressTimer = null;
    if (pressCard === card && pressGame === game) {
      startPreview(card, game);
    }
  }, LONG_PRESS_MS);
}

function onPressMove(e) {
  if (!pressStart || !pressTimer) return;
  const pt = e.touches ? e.touches[0] : e;
  const dx = Math.abs(pt.clientX - pressStart.x);
  const dy = Math.abs(pt.clientY - pressStart.y);
  if (dx > MOVE_CANCEL_PX || dy > MOVE_CANCEL_PX) {
    clearPressTimer();
  }
}

function onPressEnd(e, card, game) {
  clearPressTimer();
  // Keep preview playing after release
  if (previewStartedThisPress || previewCard === card) {
    pressStart = null;
    pressCard = null;
    pressGame = null;
    previewStartedThisPress = false;
    return;
  }
  // Short tap → show Play
  if (pressCard === card) {
    selectCard(card, game);
  }
  pressStart = null;
  pressCard = null;
  pressGame = null;
  previewStartedThisPress = false;
}

/** These tiles already include the name in the artwork — skip CSS title overlay */
const TITLE_IN_ART = new Set([
  "gundu-ata",
  "stock-market",
  "auto-roulette",
  "chicken-road",
  "chicken-road-2",
  "vortex",
  "chit-pat",
  "rangu",
]);

function render() {
  grid.innerHTML = "";
  GAMES.forEach((game) => {
    const card = document.createElement("article");
    card.className = TITLE_IN_ART.has(game.id) ? "card art-has-frame" : "card";
    card.dataset.id = game.id;
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute(
      "aria-label",
      NATIVE_ONLY.has(game.id)
        ? game.title
        : `${game.title}. Long press to preview`
    );

    const media = document.createElement("div");
    media.className = "card-media";

    const img = document.createElement("img");
    img.className = "card-art";
    img.src = game.image;
    img.alt = game.title;
    img.loading = "lazy";
    img.decoding = "async";

    const overlay = document.createElement("div");
    overlay.className = "card-overlay";

    const play = document.createElement("button");
    play.type = "button";
    play.className = "play-btn";
    play.textContent = "Play";
    play.addEventListener("click", (e) => {
      e.stopPropagation();
      stopPreview();
      playGame(game);
    });

    overlay.appendChild(play);
    media.appendChild(img);
    if (!TITLE_IN_ART.has(game.id)) {
      const title = document.createElement("h2");
      title.className = "card-title";
      title.textContent = game.title;
      media.appendChild(title);
    }
    media.appendChild(overlay);
    card.appendChild(media);

    card.addEventListener("pointerdown", (e) => onPressStart(e, card, game));
    card.addEventListener("pointermove", onPressMove);
    card.addEventListener("pointerup", (e) => onPressEnd(e, card, game));
    card.addEventListener("pointercancel", () => {
      clearPressTimer();
      pressStart = null;
      pressCard = null;
      pressGame = null;
    });

    card.addEventListener("contextmenu", (e) => e.preventDefault());

    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectCard(card, game);
      }
    });

    grid.appendChild(card);
  });
}

document.getElementById("backBtn").addEventListener("click", () => {
  stopPreview();
  try {
    if (window.AndroidBridge && typeof window.AndroidBridge.goBack === "function") {
      window.AndroidBridge.goBack();
      return;
    }
  } catch (_) {}
  if (history.length > 1) history.back();
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".card")) {
    clearSelection();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopPreview();
});

try {
  if (window.AndroidBridge) document.body.classList.add("in-app");
  if (
    window.AndroidBridge &&
    typeof window.AndroidBridge.isSystemBarsInsetApplied === "function" &&
    window.AndroidBridge.isSystemBarsInsetApplied()
  ) {
    document.documentElement.classList.add("android-system-bars");
    document.body.classList.add("android-system-bars");
  }
} catch (_) {}

readAccessToken();
render();
