const API_BASE =
  import.meta.env.VITE_API_URL ||
  (typeof location !== "undefined" &&
  (location.hostname === "localhost" || location.hostname === "127.0.0.1")
    ? "http://127.0.0.1:8000/api"
    : "/api/horse-racing");

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function fetchHorses() {
  return request("/horses/");
}

export async function createRace(totalLaps = 3) {
  return request("/races/", {
    method: "POST",
    body: JSON.stringify({ total_laps: totalLaps }),
  });
}

export async function finishRace(raceId, payload) {
  return request(`/races/${raceId}/finish/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function placeBet(raceId, payload) {
  return request(`/races/${raceId}/bets/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function healthCheck() {
  return request("/health/");
}
