/**
 * Shared site auth — read JWT from any login flow (React /login, Unity WebGL, APK ?token=).
 */
export function looksLikeJwt(value) {
  if (!value || typeof value !== "string") return false;
  const parts = value.split(".");
  return parts.length === 3 && parts[0].length > 10 && value.length > 40;
}

function readAuthBlob(raw) {
  if (!raw) return null;
  try {
    const o = typeof raw === "string" ? JSON.parse(raw) : raw;
    return o.accessToken || o.access_token || o.access || o.token || null;
  } catch (_) {
    return null;
  }
}

function readRefreshFromBlob(raw) {
  if (!raw) return "";
  try {
    const o = typeof raw === "string" ? JSON.parse(raw) : raw;
    return o.refreshToken || o.refresh_token || o.refresh || "";
  } catch (_) {
    return "";
  }
}

const ACCESS_KEYS = [
  "gundu_access_token",
  "access_token",
  "accessToken",
  "token",
  "sikwin_access",
  "kiran_access",
  "sai_access",
];

const REFRESH_KEYS = [
  "gundu_refresh_token",
  "refresh_token",
  "refreshToken",
  "sikwin_refresh",
  "kiran_refresh",
  "sai_refresh",
];

/** Prevent persist → kokoroko-auth → read → persist loops (blank casino after login). */
let persistDepth = 0;
let lastPersistedAccess = "";
let lastPersistedRefresh = "";

export function persistGunduTokens(access, refresh) {
  if (!access) return;
  const refreshVal = refresh || "";
  // No-op when unchanged — avoids infinite kokoroko-auth re-entry.
  if (access === lastPersistedAccess && refreshVal === lastPersistedRefresh) {
    try {
      if (localStorage.getItem("gundu_access_token") === access) return;
    } catch (_) {}
  }
  if (persistDepth > 0) return;
  persistDepth += 1;
  try {
    lastPersistedAccess = access;
    lastPersistedRefresh = refreshVal;
    localStorage.setItem("gundu_access_token", access);
    localStorage.setItem("access_token", access);
    localStorage.setItem("accessToken", access);
    localStorage.setItem("token", access);
    sessionStorage.setItem("accessToken", access);
    sessionStorage.setItem("token", access);
    if (refreshVal) {
      localStorage.setItem("gundu_refresh_token", refreshVal);
      localStorage.setItem("refresh_token", refreshVal);
      localStorage.setItem("refreshToken", refreshVal);
      sessionStorage.setItem("refreshToken", refreshVal);
    }
    const both = JSON.stringify({
      accessToken: access,
      refreshToken: refreshVal,
      access_token: access,
      refresh_token: refreshVal,
    });
    localStorage.setItem("auth", both);
    localStorage.setItem("kokoroko_auth", both);
    window.dispatchEvent(new CustomEvent("kokoroko-auth"));
  } catch (_) {
  } finally {
    persistDepth -= 1;
  }
}

/** After capturing ?token= from login redirect, drop it from the address bar. */
function scrubAuthQueryParams() {
  try {
    const url = new URL(location.href);
    let changed = false;
    for (const key of [
      "token",
      "access_token",
      "accessToken",
      "access",
      "refresh",
      "refresh_token",
      "refreshToken",
    ]) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    if (changed) {
      history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    }
  } catch (_) {}
}

export function readGunduAccessToken() {
  try {
    const params = new URLSearchParams(location.search);
    const fromQuery =
      params.get("token") ||
      params.get("access_token") ||
      params.get("accessToken") ||
      params.get("access");
    const refreshFromQuery =
      params.get("refresh") ||
      params.get("refresh_token") ||
      params.get("refreshToken") ||
      "";
    if (fromQuery && looksLikeJwt(fromQuery)) {
      persistGunduTokens(fromQuery, refreshFromQuery);
      scrubAuthQueryParams();
      return fromQuery;
    }

    for (const key of ACCESS_KEYS) {
      const v = localStorage.getItem(key);
      if (looksLikeJwt(v)) {
        // Warm in-memory cache only — do not re-persist / re-dispatch on every read.
        lastPersistedAccess = v;
        lastPersistedRefresh = readGunduRefreshToken() || lastPersistedRefresh;
        return v;
      }
    }

    for (const key of ["auth", "kokoroko_auth"]) {
      const fromBlob = readAuthBlob(localStorage.getItem(key));
      if (looksLikeJwt(fromBlob)) {
        lastPersistedAccess = fromBlob;
        lastPersistedRefresh =
          readRefreshFromBlob(localStorage.getItem(key)) || lastPersistedRefresh;
        return fromBlob;
      }
    }

    for (const key of ["accessToken", "token"]) {
      const v = sessionStorage.getItem(key);
      if (looksLikeJwt(v)) {
        lastPersistedAccess = v;
        lastPersistedRefresh =
          sessionStorage.getItem("refreshToken") || lastPersistedRefresh;
        return v;
      }
    }

    // Unity WebGL PlayerPrefs / franchise keys with non-standard names
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || /refresh/i.test(key)) continue;
      if (!/access|token/i.test(key)) continue;
      const v = localStorage.getItem(key);
      if (looksLikeJwt(v)) {
        lastPersistedAccess = v;
        lastPersistedRefresh = readGunduRefreshToken() || lastPersistedRefresh;
        return v;
      }
    }
  } catch (_) {}
  return "";
}

export function readGunduRefreshToken() {
  try {
    const params = new URLSearchParams(location.search);
    const fromQuery =
      params.get("refresh") ||
      params.get("refresh_token") ||
      params.get("refreshToken");
    if (fromQuery) return fromQuery;
    if (lastPersistedRefresh) return lastPersistedRefresh;
    for (const key of REFRESH_KEYS) {
      const v = localStorage.getItem(key);
      if (v) return v;
    }
    for (const key of ["auth", "kokoroko_auth"]) {
      const r = readRefreshFromBlob(localStorage.getItem(key));
      if (r) return r;
    }
    return sessionStorage.getItem("refreshToken") || sessionStorage.getItem("refresh_token") || "";
  } catch (_) {
    return "";
  }
}

export function withAuthUrl(path) {
  const token = readGunduAccessToken();
  const url = new URL(path, location.origin);
  if (token) url.searchParams.set("token", token);
  const refresh = readGunduRefreshToken();
  if (refresh) url.searchParams.set("refresh", refresh);
  return url;
}
