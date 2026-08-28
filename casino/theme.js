/**
 * Casino theme toggle — black+orange (default) or white+navy/gold (Option C).
 */
(function (global) {
  var KEY = 'gundu_casino_theme';
  var META_DARK = '#050505';
  var META_LIGHT = '#f4f6f8';

  function read() {
    try {
      var t = localStorage.getItem(KEY);
      if (t === 'light' || t === 'dark') return t;
    } catch (_) {}
    return 'dark';
  }

  function write(theme) {
    try { localStorage.setItem(KEY, theme); } catch (_) {}
  }

  function apply(theme) {
    theme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.classList.toggle('theme-light', theme === 'light');
    document.documentElement.classList.toggle('theme-dark', theme === 'dark');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? META_LIGHT : META_DARK);
    document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
      btn.setAttribute('title', theme === 'light' ? 'Switch to black theme' : 'Switch to white theme');
      btn.textContent = theme === 'light' ? '🌙' : '☀️';
    });
    return theme;
  }

  function toggle() {
    return apply(read() === 'light' ? 'dark' : 'light');
  }

  function init() {
    apply(read());
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest && e.target.closest('[data-theme-toggle]');
      if (!btn) return;
      e.preventDefault();
      write(toggle());
    });
  }

  try { apply(read()); } catch (_) {}

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.GunduCasinoTheme = { read: read, apply: apply, toggle: toggle, write: write };
})(typeof window !== 'undefined' ? window : globalThis);
