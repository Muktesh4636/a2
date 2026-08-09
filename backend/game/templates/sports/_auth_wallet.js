/* Shared: read JWT (WebView / query) + show real wallet balance */
(function (global) {
  function readTokenFromAuthBlob(raw) {
    if (!raw) return null;
    try {
      const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return o.accessToken || o.access_token || o.token || null;
    } catch (_) {
      return null;
    }
  }

  function persistToken(access, refresh) {
    try {
      if (access) {
        localStorage.setItem('gundu_access_token', access);
        localStorage.setItem('access_token', access);
        localStorage.setItem('accessToken', access);
        localStorage.setItem('token', access);
        sessionStorage.setItem('accessToken', access);
        sessionStorage.setItem('token', access);
      }
      if (refresh) {
        localStorage.setItem('refresh_token', refresh);
        localStorage.setItem('refreshToken', refresh);
        sessionStorage.setItem('refreshToken', refresh);
      }
      if (access || refresh) {
        const both = JSON.stringify({ accessToken: access || '', refreshToken: refresh || '' });
        localStorage.setItem('auth', both);
        localStorage.setItem('kokoroko_auth', both);
      }
    } catch (_) {}
  }

  function getAccessToken() {
    const p = new URLSearchParams(location.search);
    const qAccess = p.get('accessToken') || p.get('access_token') || p.get('token') || '';
    const qRefresh = p.get('refreshToken') || p.get('refresh_token') || '';
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
      const fromAuthLs = readTokenFromAuthBlob(localStorage.getItem('auth') || localStorage.getItem('kokoroko_auth'));
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

  function formatInr(raw) {
    const n = Number(String(raw ?? '').replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(n)) return '₹ —';
    return '₹ ' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  async function loadWalletBalance(elOrId) {
    const el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
    if (!el) return;
    const token = getAccessToken();
    if (!token) {
      el.textContent = '₹ —';
      el.title = 'Login required';
      return;
    }
    try {
      const r = await fetch('/api/auth/wallet/', {
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ' + token,
        },
      });
      if (r.status === 401) {
        el.textContent = '₹ —';
        el.title = 'Session expired';
        return;
      }
      if (!r.ok) return;
      const j = await r.json();
      const data = j.data || j;
      const bal = data.balance ?? data.wallet_balance ?? data.available_balance;
      el.textContent = formatInr(bal);
      el.title = 'Your wallet';
    } catch (_) {}
  }

  function bootWallet(elOrId) {
    loadWalletBalance(elOrId);
    window.addEventListener('kokoroko-auth', () => loadWalletBalance(elOrId));
    // Re-check shortly after WebView injects localStorage
    setTimeout(() => loadWalletBalance(elOrId), 400);
    setTimeout(() => loadWalletBalance(elOrId), 1200);
  }

  global.GunduSportsAuth = {
    getAccessToken,
    persistToken,
    loadWalletBalance,
    bootWallet,
    formatInr,
  };
})(window);
