/**
 * Vortex API client — JWT + /api/vortex/ (Gundu Wallet)
 * Refreshes access token on 401 when a refresh token is available.
 */
const API_BASE = (() => {
  const host = location.hostname;
  if (host === "127.0.0.1" || host === "localhost") {
    return "http://127.0.0.1:8001/api/vortex";
  }
  return `${location.origin}/api/vortex`;
})();

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

function readRefreshToken() {
  try {
    return (
      localStorage.getItem("gundu_refresh_token") ||
      localStorage.getItem("refresh_token") ||
      ""
    );
  } catch (_) {
    return "";
  }
}

function storeAccessToken(token) {
  if (!token) return;
  try {
    localStorage.setItem("gundu_access_token", token);
    localStorage.setItem("access_token", token);
  } catch (_) {}
}

let refreshPromise = null;

async function refreshAccessToken() {
  const refresh = readRefreshToken();
  if (!refresh) return "";
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${location.origin}/api/auth/token/refresh/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        cache: "no-store",
        body: JSON.stringify({ refresh }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return "";
      const access = data.access || data.access_token || "";
      if (access) storeAccessToken(access);
      return access;
    } catch (_) {
      return "";
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

async function api(path, { method = "GET", body, _retried = false } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let token = readAccessToken();
  if (!token) throw new Error("Login required — open from the app");
  headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    cache: "no-store",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = { ok: false, error: "Invalid response" };
  }

  if (res.status === 401 && !_retried) {
    const next = await refreshAccessToken();
    if (next) {
      return api(path, { method, body, _retried: true });
    }
  }

  if (!res.ok) {
    const err = new Error(
      data.error || data.detail || data.message || `HTTP ${res.status}`
    );
    err.data = data;
    err.status = res.status;
    throw err;
  }
  return data;
}

export const fetchState = () => api("/state/");
export const postBet = (bet) => api("/bet/", { method: "POST", body: { bet } });
export const postSpin = () =>
  api("/spin/", { method: "POST", body: { t: Date.now(), n: Math.random() } });
export const postCashout = () => api("/cashout/", { method: "POST", body: {} });
export const postPart = () => api("/part/", { method: "POST", body: {} });
