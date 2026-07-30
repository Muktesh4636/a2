/**
 * Chicken Road — back to Casino (works on Vite build without rebuild)
 */
(function () {
  function token() {
    const q = new URLSearchParams(location.search).get("token");
    if (q) {
      try { localStorage.setItem("gundu_access_token", q); } catch (_) {}
      return q;
    }
    try {
      return localStorage.getItem("gundu_access_token") || localStorage.getItem("access_token") || "";
    } catch (_) {
      return "";
    }
  }

  function casinoUrl() {
    const u = new URL("/casino/", location.origin);
    const t = token();
    if (t) u.searchParams.set("token", t);
    return u.toString();
  }

  function goCasino() {
    location.href = casinoUrl();
  }

  function injectBack() {
    if (document.getElementById("gunduBackBtn")) return;
    const header = document.querySelector(".header") || document.querySelector("header");
    if (!header) return false;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "gunduBackBtn";
    btn.className = "gundu-back";
    btn.setAttribute("aria-label", "Back to Casino");
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15.5 4.5 8 12l7.5 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    btn.addEventListener("click", goCasino);
    header.insertBefore(btn, header.firstChild);
    header.classList.add("has-gundu-back");
    return true;
  }

  function boot() {
    if (!injectBack()) {
      setTimeout(boot, 200);
      return;
    }
    try {
      history.pushState({ gundu_game: "chicken-road" }, "", location.href);
      window.addEventListener("popstate", () => {
        location.replace(casinoUrl());
      });
    } catch (_) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
