/** Gundu JWT + Chicken Road API helper */

const API_BASE = (() => {
  const host = location.hostname;
  if (host === "127.0.0.1" || host === "localhost") {
    return "http://127.0.0.1:8001/api/chicken-road";
  }
  return `${location.origin}/api/chicken-road`;
})();

export function readAccessToken() {
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

export async function api(path, { method = "GET", body, requireAuth = true } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = readAccessToken();
  if (requireAuth) {
    if (!token) throw new Error("Login required — open from the app");
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {}
  if (!res.ok) {
    const msg = (data && (data.detail || data.error)) || `Request failed (${res.status})`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
}
