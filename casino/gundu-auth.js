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

export function persistGunduTokens(access, refresh) {
  if (!access) return;
  try {
    localStorage.setItem("gundu_access_token", access);
    localStorage.setItem("access_token", access);
    localStorage.setItem("accessToken", access);
    localStorage.setItem("token", access);
    sessionStorage.setItem("accessToken", access);
    sessionStorage.setItem("token", access);
    if (refresh) {
      localStorage.setItem("gundu_refresh_token", refresh);
      localStorage.setItem("refresh_token", refresh);
      localStorage.setItem("refreshToken", refresh);
      sessionStorage.setItem("refreshToken", refresh);
    }
    const both = JSON.stringify({
      accessToken: access,
      refreshToken: refresh || "",
      access_token: access,
      refresh_token: refresh || "",
    });
    localStorage.setItem("auth", both);
    localStorage.setItem("kokoroko_auth", both);
    window.dispatchEvent(new CustomEvent("kokoroko-auth"));
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
    const refreshFromQuery = params.get("refresh") || params.get("refresh_token") || params.get("refreshToken") || "";
    if (fromQuery && looksLikeJwt(fromQuery)) {
      persistGunduTokens(fromQuery, refreshFromQuery);
      return fromQuery;
    }

    for (const key of ACCESS_KEYS) {
      const v = localStorage.getItem(key);
      if (looksLikeJwt(v)) {
        persistGunduTokens(v, readGunduRefreshToken());
        return v;
      }
    }

    for (const key of ["auth", "kokoroko_auth"]) {
      const fromBlob = readAuthBlob(localStorage.getItem(key));
      if (looksLikeJwt(fromBlob)) {
        persistGunduTokens(fromBlob, readRefreshFromBlob(localStorage.getItem(key)));
        return fromBlob;
      }
    }

    for (const key of ["accessToken", "token"]) {
      const v = sessionStorage.getItem(key);
      if (looksLikeJwt(v)) {
        persistGunduTokens(v, sessionStorage.getItem("refreshToken") || "");
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
        persistGunduTokens(v, readGunduRefreshToken());
        return v;
      }
    }
  } catch (_) {}
  return "";
}

export function readGunduRefreshToken() {
  try {
    const params = new URLSearchParams(location.search);
    const fromQuery = params.get("refresh") || params.get("refresh_token") || params.get("refreshToken");
    if (fromQuery) return fromQuery;
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
