/**
 * Casino Games lobby — tap a tile → Play overlay → open game with JWT
 */
import { GAMES } from "./games.js";

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
  return url.toString();
}

const grid = document.getElementById("gameGrid");
let selectedId = null;

function clearSelection() {
  selectedId = null;
  grid.querySelectorAll(".card.is-selected").forEach((el) => {
    el.classList.remove("is-selected");
  });
}

function selectCard(card, game) {
  if (selectedId === game.id) {
    // second tap on same card keeps Play visible (do nothing)
    return;
  }
  clearSelection();
  selectedId = game.id;
  card.classList.add("is-selected");
}

function playGame(game) {
  const url = withToken(game.path);
  // Native WebView can intercept this; also works in browser
  try {
    if (window.AndroidBridge && typeof window.AndroidBridge.openGame === "function") {
      window.AndroidBridge.openGame(game.id, url);
      return;
    }
  } catch (_) {}
  location.href = url;
}

function render() {
  grid.innerHTML = "";
  GAMES.forEach((game) => {
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.id = game.id;
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-label", game.title);

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
      playGame(game);
    });

    overlay.appendChild(play);
    card.appendChild(img);
    card.appendChild(overlay);

    card.addEventListener("click", () => selectCard(card, game));
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
  try {
    if (window.AndroidBridge && typeof window.AndroidBridge.goBack === "function") {
      window.AndroidBridge.goBack();
      return;
    }
  } catch (_) {}
  if (history.length > 1) history.back();
});

// Tap empty space clears selection
document.addEventListener("click", (e) => {
  if (!e.target.closest(".card")) clearSelection();
});

readAccessToken();
render();
