/**
 * Vortex API client — JWT + /api/vortex/ (Gundu Wallet)
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

async function api(path, { method = "GET", body } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = readAccessToken();
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
