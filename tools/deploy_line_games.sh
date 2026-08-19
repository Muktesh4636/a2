#!/usr/bin/env bash
# Deploy Line games frontends + backends + casino tiles (JWT WebView same as chicken / roulette).
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
PASSWORD="${SERVER_PASSWORD:-Gunduata@123}"
LB="72.62.226.41"
APP="72.61.254.71"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH="sshpass -p $PASSWORD ssh -o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no -o ConnectTimeout=20"
SCP="sshpass -p $PASSWORD scp -o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no -o ConnectTimeout=20"

GAMES="circle-game stop-bar spin-dial mines-path dice-over-under color-match wheel-pockets wave-surf keno-pick hi-lo-cards"

echo "=== 0) Build frontends ==="
if [[ "${SKIP_BUILD:-0}" == "1" ]]; then
  echo "  SKIP_BUILD=1 — using existing dist/"
else
for g in $GAMES; do
  echo "  build $g"
  (cd "$ROOT/line/$g" && npm install --silent && npm run build)
done
fi

echo "=== 1) Casino lobby ==="
$SSH root@$LB "mkdir -p /var/www/gunduata/casino/images"
$SCP "$ROOT/casino/games.js" root@$LB:/var/www/gunduata/casino/games.js
$SCP "$ROOT/casino/app.js" root@$LB:/var/www/gunduata/casino/app.js
for g in $GAMES; do
  $SCP "$ROOT/casino/images/$g.jpeg" "root@$LB:/var/www/gunduata/casino/images/$g.jpeg"
done
$SSH root@$LB "chown -R www-data:www-data /var/www/gunduata/casino"

echo "=== 2) Static frontends → LB ==="
for g in $GAMES; do
  SRC="$ROOT/line/$g/dist"
  echo "  /$g/ from $SRC"
  $SSH root@$LB "mkdir -p /var/www/gunduata/$g"
  $SCP -r "$SRC/"* "root@$LB:/var/www/gunduata/$g/"
  $SSH root@$LB "chown -R www-data:www-data /var/www/gunduata/$g"
done

echo "=== 3) Backends + compose → app server ==="
cd "$ROOT"
tar czf /tmp/line_games_backends.tgz \
  line/circle-game/backend line/stop-bar/backend line/spin-dial/backend \
  line/mines-path/backend line/dice-over-under/backend line/color-match/backend \
  line/wheel-pockets/backend line/wave-surf/backend line/keno-pick/backend \
  line/hi-lo-cards/backend docker-compose.line-games.yml
$SCP /tmp/line_games_backends.tgz root@$APP:/tmp/line_games_backends.tgz
$SSH root@$APP "cd /root/apk_of_ata && tar xzf /tmp/line_games_backends.tgz && docker compose -f docker-compose.line-games.yml up -d --build"

echo "=== 4) Patch nginx on LB ==="
$SSH root@$LB 'python3 - <<'"'"'PY'"'"'
from pathlib import Path
import re
conf = Path("/etc/nginx/sites-enabled/gunduata.tech")
text = conf.read_text()
marker = "# === LINE GAMES (auto) ==="
if marker in text:
    print("nginx line-games block already present")
else:
    block = """
    # === LINE GAMES (auto) ===
    location = /circle-game { return 301 /circle-game/$is_args$args; }
    location /circle-game/ { alias /var/www/gunduata/circle-game/; try_files $uri $uri/ /circle-game/index.html; }
    location = /stop-bar { return 301 /stop-bar/$is_args$args; }
    location /stop-bar/ { alias /var/www/gunduata/stop-bar/; try_files $uri $uri/ /stop-bar/index.html; }
    location = /spin-dial { return 301 /spin-dial/$is_args$args; }
    location /spin-dial/ { alias /var/www/gunduata/spin-dial/; try_files $uri $uri/ /spin-dial/index.html; }
    location = /mines-path { return 301 /mines-path/$is_args$args; }
    location /mines-path/ { alias /var/www/gunduata/mines-path/; try_files $uri $uri/ /mines-path/index.html; }
    location = /dice-over-under { return 301 /dice-over-under/$is_args$args; }
    location /dice-over-under/ { alias /var/www/gunduata/dice-over-under/; try_files $uri $uri/ /dice-over-under/index.html; }
    location = /color-match { return 301 /color-match/$is_args$args; }
    location /color-match/ { alias /var/www/gunduata/color-match/; try_files $uri $uri/ /color-match/index.html; }
    location = /wheel-pockets { return 301 /wheel-pockets/$is_args$args; }
    location /wheel-pockets/ { alias /var/www/gunduata/wheel-pockets/; try_files $uri $uri/ /wheel-pockets/index.html; }
    location = /wave-surf { return 301 /wave-surf/$is_args$args; }
    location /wave-surf/ { alias /var/www/gunduata/wave-surf/; try_files $uri $uri/ /wave-surf/index.html; }
    location = /keno-pick { return 301 /keno-pick/$is_args$args; }
    location /keno-pick/ { alias /var/www/gunduata/keno-pick/; try_files $uri $uri/ /keno-pick/index.html; }
    location = /hi-lo-cards { return 301 /hi-lo-cards/$is_args$args; }
    location /hi-lo-cards/ { alias /var/www/gunduata/hi-lo-cards/; try_files $uri $uri/ /hi-lo-cards/index.html; }

    location /api/circle-game/ { proxy_pass http://72.61.254.71:8120/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    location /api/stop-bar/ { proxy_pass http://72.61.254.71:8121/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    location /api/spin-dial/ { proxy_pass http://72.61.254.71:8122/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    location /api/mines-path/ { proxy_pass http://72.61.254.71:8123/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    location /api/dice-over-under/ { proxy_pass http://72.61.254.71:8124/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    location /api/color-match/ { proxy_pass http://72.61.254.71:8125/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    location /api/wheel-pockets/ { proxy_pass http://72.61.254.71:8126/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    location /api/wave-surf/ { proxy_pass http://72.61.254.71:8127/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    location /api/keno-pick/ { proxy_pass http://72.61.254.71:8128/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    location /api/hi-lo-cards/ { proxy_pass http://72.61.254.71:8129/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    # === END LINE GAMES ===
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
for u in /casino/ /circle-game/ /wave-surf/ /api/circle-game/config/ /api/wave-surf/config/; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "https://gunduata.tech$u" || echo err)
  echo "  $code $u"
done
echo "Done."
