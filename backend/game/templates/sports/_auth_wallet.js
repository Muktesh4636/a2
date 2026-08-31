/* Shared: read JWT (WebView / query) + show real wallet balance */
(function (global) {
  const ACCESS_KEYS = [
    'gundu_access_token',
    'access_token',
    'accessToken',
    'token',
  ];
  const REFRESH_KEYS = [
    'gundu_refresh_token',
    'refresh_token',
    'refreshToken',
  ];

  function readTokenFromAuthBlob(raw) {
    if (!raw) return null;
    try {
      const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return o.accessToken || o.access_token || o.token || null;
    } catch (_) {
      return null;
    }
  }

  function readRefreshFromAuthBlob(raw) {
    if (!raw) return '';
    try {
      const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return o.refreshToken || o.refresh_token || o.refresh || '';
    } catch (_) {
      return '';
    }
  }

  function persistToken(access, refresh) {
    try {
      if (access) {
        ACCESS_KEYS.forEach((k) => localStorage.setItem(k, access));
        sessionStorage.setItem('accessToken', access);
        sessionStorage.setItem('token', access);
      }
      if (refresh) {
        REFRESH_KEYS.forEach((k) => localStorage.setItem(k, refresh));
        sessionStorage.setItem('refreshToken', refresh);
      }
      if (access || refresh) {
        const both = JSON.stringify({
          accessToken: access || getAccessToken() || '',
          refreshToken: refresh || getRefreshToken() || '',
        });
        localStorage.setItem('auth', both);
        localStorage.setItem('kokoroko_auth', both);
      }
    } catch (_) {}
  }

  function clearTokens() {
    try {
      ACCESS_KEYS.forEach((k) => localStorage.removeItem(k));
      REFRESH_KEYS.forEach((k) => localStorage.removeItem(k));
      ['accessToken', 'token', 'refreshToken'].forEach((k) => sessionStorage.removeItem(k));
      localStorage.removeItem('auth');
      localStorage.removeItem('kokoroko_auth');
    } catch (_) {}
  }

  function getRefreshToken() {
    const p = new URLSearchParams(location.search);
    const q = p.get('refreshToken') || p.get('refresh_token') || p.get('refresh') || '';
    if (q) return q;
    try {
      const fromAuth = readRefreshFromAuthBlob(
        localStorage.getItem('auth') || localStorage.getItem('kokoroko_auth')
      );
      if (fromAuth) return fromAuth;
    } catch (_) {}
    for (const k of REFRESH_KEYS) {
      try {
        const v = localStorage.getItem(k);
        if (v) return v;
      } catch (_) {}
    }
    try {
      return sessionStorage.getItem('refreshToken') || '';
    } catch (_) {
      return '';
    }
  }

  function getAccessToken() {
    const p = new URLSearchParams(location.search);
    const qAccess = p.get('accessToken') || p.get('access_token') || p.get('token') || '';
    const qRefresh = p.get('refreshToken') || p.get('refresh_token') || p.get('refresh') || '';
    if (qAccess) {
      persistToken(qAccess, qRefresh);
      return qAccess;
    }
    const fromAuthQ = readTokenFromAuthBlob(p.get('auth'));
    if (fromAuthQ) {
      try {
        const o = JSON.parse(p.get('auth'));
        persistToken(fromAuthQ, o.refreshToken || o.refresh_token || '');
      } catch (_) {
        persistToken(fromAuthQ, '');
      }
      return fromAuthQ;
    }
    try {
      const fromAuthLs = readTokenFromAuthBlob(
        localStorage.getItem('auth') || localStorage.getItem('kokoroko_auth')
      );
      if (fromAuthLs) return fromAuthLs;
    } catch (_) {}
    return (
      localStorage.getItem('gundu_access_token') ||
      localStorage.getItem('access_token') ||
      localStorage.getItem('accessToken') ||
      localStorage.getItem('token') ||
      sessionStorage.getItem('accessToken') ||
      sessionStorage.getItem('token') ||
      ''
    );
  }

  let refreshInFlight = null;

  async function refreshAccessToken() {
    const refresh = getRefreshToken();
    if (!refresh) return '';
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      try {
        const r = await fetch('/api/auth/token/refresh/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ refresh }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          clearTokens();
          return '';
        }
        const access = j.access || j.access_token || '';
        const nextRefresh = j.refresh || j.refresh_token || refresh;
        if (!access) {
          clearTokens();
          return '';
        }
        persistToken(access, nextRefresh);
        try {
          window.dispatchEvent(new Event('kokoroko-auth'));
        } catch (_) {}
        return access;
      } catch (_) {
        return '';
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  }

  async function ensureAccessToken() {
    let token = getAccessToken();
    if (token) return token;
    return refreshAccessToken();
  }

  function loginUrl() {
    return '/login?next=' + encodeURIComponent(location.pathname + location.search);
  }

  function formatInr(raw) {
    const n = Number(String(raw ?? '').replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(n)) return '₹ —';
    return '₹ ' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  async function loadWalletBalance(elOrId) {
    const el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
    if (!el) return;
    let token = await ensureAccessToken();
    if (!token) {
      el.textContent = '₹ —';
      el.title = 'Login required';
      return;
    }
    try {
      let r = await fetch('/api/auth/wallet/', {
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ' + token,
        },
      });
      if (r.status === 401) {
        token = await refreshAccessToken();
        if (!token) {
          clearTokens();
          el.textContent = '₹ —';
          el.title = 'Session expired — tap to login';
          el.onclick = () => { location.href = loginUrl(); };
          return;
        }
        r = await fetch('/api/auth/wallet/', {
          headers: {
            Accept: 'application/json',
            Authorization: 'Bearer ' + token,
          },
        });
      }
      if (r.status === 401) {
        clearTokens();
        el.textContent = '₹ —';
        el.title = 'Session expired — tap to login';
        el.onclick = () => { location.href = loginUrl(); };
        return;
      }
      if (!r.ok) return;
      const j = await r.json();
      const data = j.data || j;
      const bal = data.balance ?? data.wallet_balance ?? data.available_balance;
      el.textContent = formatInr(bal);
      el.title = 'Your wallet';
      el.onclick = null;
    } catch (_) {}
  }

  function bootWallet(elOrId) {
    loadWalletBalance(elOrId);
    window.addEventListener('kokoroko-auth', () => loadWalletBalance(elOrId));
    // Re-check shortly after WebView injects localStorage
    setTimeout(() => loadWalletBalance(elOrId), 400);
    setTimeout(() => loadWalletBalance(elOrId), 1200);
  }

  function withAuthQuery(url) {
    try {
      const u = new URL(url, location.origin);
      const access = getAccessToken();
      const refresh = getRefreshToken();
      if (access && !u.searchParams.get('token') && !u.searchParams.get('accessToken')) {
        u.searchParams.set('token', access);
      }
      if (refresh && !u.searchParams.get('refresh') && !u.searchParams.get('refreshToken')) {
        u.searchParams.set('refresh', refresh);
      }
      return u.pathname + u.search + u.hash;
    } catch (_) {
      return url;
    }
  }

  global.GunduSportsAuth = {
    getAccessToken,
    getRefreshToken,
    persistToken,
    clearTokens,
    refreshAccessToken,
    ensureAccessToken,
    loadWalletBalance,
    bootWallet,
    formatInr,
    loginUrl,
    withAuthQuery,
  };
})(window);
