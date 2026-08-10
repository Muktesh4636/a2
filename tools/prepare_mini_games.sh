#!/usr/bin/env bash
# Patch + build Mines / Plinko / Air Balloon frontends for gunduata.tech deploy.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

patch_mines_client() {
  local game="$1"
  local api="/api/${game}"
  local file="$ROOT/Mines/${game}/frontend/src/api/client.ts"
  [ -f "$file" ] || { echo "skip client $game"; return; }
  # Rewrite API base + capture JWT from query for WebView
  python3 - "$file" "$api" "$game" <<'PY'
import sys, re
path, api, game = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(path).read()
src = re.sub(
    r"const API_BASE = import\.meta\.env\.VITE_API_URL \?\? 'http://127\.0\.0\.1:\d+/api'",
    f"const API_BASE = import.meta.env.VITE_API_URL ?? '{api}'",
    src,
    count=1,
)
if "gundu_access_token" not in src:
    inject = '''
function captureGunduToken() {
  try {
    const q = new URLSearchParams(location.search)
    const t = q.get('token') || q.get('access_token')
    if (t) localStorage.setItem('gundu_access_token', t)
  } catch (_) {}
}
captureGunduToken()
'''
    src = src.replace("const API_BASE", inject + "\nconst API_BASE", 1)
if "Authorization" not in src:
    src = src.replace(
        "const playerId = getPlayerId()\n  if (playerId) headers['X-Player-Id'] = playerId",
        "const playerId = getPlayerId()\n  if (playerId) headers['X-Player-Id'] = playerId\n"
        "  const jwt = localStorage.getItem('gundu_access_token') || localStorage.getItem('access_token')\n"
        "  if (jwt) headers['Authorization'] = `Bearer ${jwt}`",
    )
open(path, 'w').write(src)
print('patched', path)
PY
}

patch_vite_base() {
  local dir="$1"
  local base="$2"
  local cfg=""
  [ -f "$dir/vite.config.ts" ] && cfg="$dir/vite.config.ts"
  [ -f "$dir/vite.config.js" ] && cfg="$dir/vite.config.js"
  [ -n "$cfg" ] || return
  python3 - "$cfg" "$base" <<'PY'
import sys, re
path, base = sys.argv[1], sys.argv[2]
src = open(path).read()
if "base:" in src:
    src = re.sub(r"base:\s*['\"][^'\"]*['\"]", f"base: '{base}'", src)
else:
    src = re.sub(
        r"defineConfig\(\s*\{",
        f"defineConfig({{\n  base: '{base}',",
        src,
        count=1,
    )
open(path, 'w').write(src)
print('vite base', path, base)
PY
}

build_fe() {
  local dir="$1"
  echo ">> build $dir"
  (cd "$dir" && npm install --silent && npm run build)
}

# --- Mines family ---
for game in mines steps boxes snake slide cases drop; do
  FE="$ROOT/Mines/$game/frontend"
  [ -d "$FE" ] || continue
  patch_mines_client "$game"
  patch_vite_base "$FE" "/${game}/"
  build_fe "$FE" || echo "BUILD FAILED $game"
done

# --- Plinko ---
PL="$ROOT/plinko/frontend"
patch_vite_base "$PL" "/plinko/"
# Capture token even though balance is local for now
python3 - <<PY
from pathlib import Path
p = Path("$PL/src/main.js")
src = p.read_text()
if "gundu_access_token" not in src:
    boot = '''
(function captureGunduToken() {
  try {
    const q = new URLSearchParams(location.search);
    const t = q.get("token") || q.get("access_token");
    if (t) localStorage.setItem("gundu_access_token", t);
  } catch (_) {}
})();
'''
    p.write_text(boot + src)
    print("patched plinko token capture")
PY
build_fe "$PL" || echo "BUILD FAILED plinko"

# --- Air Balloon (static, no vite build) ---
AB="$ROOT/Air_ballon_pump/frontend/game.js"
python3 - <<PY
from pathlib import Path
p = Path("$AB")
src = p.read_text()
src = src.replace(
'''  const API_BASE =
    window.AIR_BALLOON_API ||
    (window.location.port === "8000" ? "/api" : "http://127.0.0.1:8000/api");''',
'''  const API_BASE =
    window.AIR_BALLOON_API ||
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? (window.location.port === "8000" ? "/api" : "http://127.0.0.1:8000/api")
      : "/api/air-balloon");'''
)
if "gundu_access_token" not in src:
    src = src.replace(
        "function getPlayerToken() {",
        '''(function captureGunduToken() {
    try {
      const q = new URLSearchParams(location.search);
      const t = q.get("token") || q.get("access_token");
      if (t) localStorage.setItem("gundu_access_token", t);
    } catch (_) {}
  })();

  function getPlayerToken() {'''
    )
if "Authorization" not in src:
    src = src.replace(
        'if (token) headers["X-Player-Token"] = token;',
        'if (token) headers["X-Player-Token"] = token;\n'
        '    const jwt = localStorage.getItem("gundu_access_token") || localStorage.getItem("access_token");\n'
        '    if (jwt) headers["Authorization"] = `Bearer ${jwt}`;'
    )
p.write_text(src)
print("patched air balloon")
PY

echo "DONE prepare_mini_games"
