#!/usr/bin/env bash
# Deploy Vortex 2 + VIP Vortex + casino tiles (same pattern as line / under6).
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
PASSWORD="${SERVER_PASSWORD:-Gunduata@123}"
LB="72.62.226.41"
APP="72.61.254.71"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH="sshpass -p $PASSWORD ssh -o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no -o ConnectTimeout=20"
SCP="sshpass -p $PASSWORD scp -o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no -o ConnectTimeout=20"

echo "=== 1) Casino lobby + tiles ==="
$SSH root@$LB "mkdir -p /var/www/gunduata/casino/images"
$SCP "$ROOT/casino/index.html" root@$LB:/var/www/gunduata/casino/index.html
$SCP "$ROOT/casino/games.js" root@$LB:/var/www/gunduata/casino/games.js
$SCP "$ROOT/casino/app.js" root@$LB:/var/www/gunduata/casino/app.js
$SCP "$ROOT/casino/images/vortex-2.png" root@$LB:/var/www/gunduata/casino/images/vortex-2.png
$SCP "$ROOT/casino/images/vip-vortex.png" root@$LB:/var/www/gunduata/casino/images/vip-vortex.png
$SSH root@$LB "chown -R www-data:www-data /var/www/gunduata/casino"

echo "=== 2) Static frontends → LB ==="
deploy_frontend() {
  local id="$1"
  local src="$2"
  echo "  /$id/ from $src"
  $SSH root@$LB "mkdir -p /var/www/gunduata/$id/css /var/www/gunduata/$id/js /var/www/gunduata/$id/images /var/www/gunduata/$id/sounds"
  $SCP "$src/index.html" "$src/styles.css" "root@$LB:/var/www/gunduata/$id/"
  $SCP -r "$src/css/." "root@$LB:/var/www/gunduata/$id/css/"
  $SCP -r "$src/js/." "root@$LB:/var/www/gunduata/$id/js/"
  if [[ -d "$src/sounds" ]]; then
    $SCP -r "$src/sounds/." "root@$LB:/var/www/gunduata/$id/sounds/"
  fi
  # images sit next to frontend (../images relative to js → /game/images)
  local imgs="$(dirname "$src")/images"
  for f in earth-flower.png fire-flame.png skull-icon.png spin-button.png water-wave.png wind-icon.png \
           vortex-bg-1-light.png vortex-bg-2-cosmos.png vortex-bg-3-soft.png vortex-bg-match.png vortex-bg-notext.png vip-vortex-bg.png; do
    [[ -f "$imgs/$f" ]] && $SCP "$imgs/$f" "root@$LB:/var/www/gunduata/$id/images/$f" || true
  done
  $SSH root@$LB "chown -R www-data:www-data /var/www/gunduata/$id"
}

deploy_frontend "vortex" "$ROOT/VORTEX/frontend"
deploy_frontend "vortex-1" "$ROOT/VORTEX/vortex-1/frontend"
deploy_frontend "vip-vortex" "$ROOT/VORTEX/vip-vortex/frontend"

echo "=== 3) Backends + compose → app server ==="
cd "$ROOT"
tar czf /tmp/vortex_games_backends.tgz \
  VORTEX/vortex-2/backend \
  VORTEX/vip-vortex/backend \
  docker-compose.vortex-games.yml
$SCP /tmp/vortex_games_backends.tgz root@$APP:/tmp/vortex_games_backends.tgz
$SSH root@$APP "cd /root/apk_of_ata && tar xzf /tmp/vortex_games_backends.tgz && docker compose -f docker-compose.vortex-games.yml up -d --build"

echo "=== 4) Patch nginx on LB ==="
$SSH root@$LB 'python3 - <<'"'"'PY'"'"'
from pathlib import Path
import re
conf = Path("/etc/nginx/sites-enabled/gunduata.tech")
text = conf.read_text()
marker = "# === VORTEX 2 / VIP (auto) ==="
if marker in text:
    text = re.sub(r"\n    # === VORTEX 2 / VIP \(auto\) ===.*?# === END VORTEX 2 / VIP ===\n", "\n", text, flags=re.S)
    print("removed old vortex-2 block")
block = """
    # === VORTEX 2 / VIP (auto) ===
    location = /vortex-2 { return 301 /vortex-2/$is_args$args; }
    location /vortex-2/ { alias /var/www/gunduata/vortex-2/; index index.html; add_header Cache-Control "no-cache"; }
    location = /vip-vortex { return 301 /vip-vortex/$is_args$args; }
    location /vip-vortex/ { alias /var/www/gunduata/vip-vortex/; index index.html; add_header Cache-Control "no-cache"; }

    location /api/vortex-2/ { proxy_pass http://72.61.254.71:8150/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; proxy_set_header Cookie $http_cookie; proxy_cookie_path / /; }
    location /api/vip-vortex/ { proxy_pass http://72.61.254.71:8151/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; proxy_set_header Cookie $http_cookie; proxy_cookie_path / /; }
    # === END VORTEX 2 / VIP ===
"""
text2, n = re.subn(r"(\n\s*location /api/ \{)", block + r"\1", text, count=1)
if n != 1:
    raise SystemExit("Could not find location /api/ to insert before")
conf.write_text(text2)
print("nginx block inserted")
PY
nginx -t && systemctl reload nginx && echo nginx_reloaded
'

echo "=== 5) Smoke ==="
for u in /casino/ /vortex-2/ /vip-vortex/ /api/vortex-2/state/ /api/vip-vortex/state/; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" -X GET "https://gunduata.tech$u" || echo err)
  echo "  $code $u"
done
echo "Done."
