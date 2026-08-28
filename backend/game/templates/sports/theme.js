/**
 * Sports theme toggle — black (default) or white+emerald (Option A).
 * Shared across /sports/, /cricket/, /sports/match/
 */
(function (global) {
  var KEY = 'gundu_sports_theme';
  var META_DARK = '#0b0f14';
  var META_LIGHT = '#ffffff';

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
    var bar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (bar) bar.setAttribute('content', theme === 'light' ? 'default' : 'black-translucent');
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
      var next = toggle();
      write(next);
    });
  }

  // Apply ASAP (before body) to avoid flash
  try { apply(read()); } catch (_) {}

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.GunduSportsTheme = { read: read, apply: apply, toggle: toggle, write: write };
})(typeof window !== 'undefined' ? window : globalThis);
