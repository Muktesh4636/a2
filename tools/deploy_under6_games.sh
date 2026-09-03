#!/usr/bin/env bash
# Deploy under_6 card games + casino tiles (same pattern as under-6 / line / aviator).
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
PASSWORD="${SERVER_PASSWORD:-Gunduata@123}"
LB="72.62.226.41"
APP="72.61.254.71"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH="sshpass -p $PASSWORD ssh -o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no -o ConnectTimeout=20"
SCP="sshpass -p $PASSWORD scp -o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no -o ConnectTimeout=20"

GAMES="rushbet knock6 tripleedge mirror goldlane dead7 teenpatti"

echo "=== 1) Casino lobby + tiles ==="
$SSH root@$LB "mkdir -p /var/www/gunduata/casino/images"
$SCP "$ROOT/casino/index.html" root@$LB:/var/www/gunduata/casino/index.html
$SCP "$ROOT/casino/games.js" root@$LB:/var/www/gunduata/casino/games.js
$SCP "$ROOT/casino/app.js" root@$LB:/var/www/gunduata/casino/app.js
$SCP "$ROOT/casino/images/under-6.jpeg" root@$LB:/var/www/gunduata/casino/images/under-6.jpeg || true
for g in $GAMES; do
  $SCP "$ROOT/casino/images/$g.jpeg" "root@$LB:/var/www/gunduata/casino/images/$g.jpeg"
done
# also refresh line + aviator tiles if present
$SCP "$ROOT/casino/images/"*.jpeg root@$LB:/var/www/gunduata/casino/images/ || true
$SCP "$ROOT/casino/images/"*.png root@$LB:/var/www/gunduata/casino/images/ || true
$SSH root@$LB "chown -R www-data:www-data /var/www/gunduata/casino"

echo "=== 2) Static frontends → LB ==="
for g in $GAMES; do
  SRC="$ROOT/under_6/games/$g/frontend"
  echo "  /$g/ from $SRC"
  $SSH root@$LB "mkdir -p /var/www/gunduata/$g/sounds"
  $SCP "$SRC/index.html" "$SRC/styles.css" "$SRC/game.js" "$SRC/table3d.js" "$SRC/sounds.js" "root@$LB:/var/www/gunduata/$g/"
  $SCP -r "$SRC/sounds/." "root@$LB:/var/www/gunduata/$g/sounds/"
  $SSH root@$LB "chown -R www-data:www-data /var/www/gunduata/$g"
done

# under-6 frontend from 6/games/under6
if [[ -d "$ROOT/6/games/under6/frontend" ]]; then
  echo "  /under-6/"
  $SSH root@$LB "mkdir -p /var/www/gunduata/under-6"
  $SCP "$ROOT/6/games/under6/frontend/"* "root@$LB:/var/www/gunduata/under-6/" || true
  $SSH root@$LB "chown -R www-data:www-data /var/www/gunduata/under-6"
fi

echo "=== 3) Backends + compose → app server ==="
cd "$ROOT"
tar czf /tmp/under6_games_backends.tgz \
  under_6/games/rushbet/backend under_6/games/knock6/backend \
  under_6/games/tripleedge/backend under_6/games/mirror/backend \
  under_6/games/goldlane/backend under_6/games/dead7/backend \
  under_6/games/teenpatti/backend \
  docker-compose.under6-games.yml
$SCP /tmp/under6_games_backends.tgz root@$APP:/tmp/under6_games_backends.tgz
$SSH root@$APP "cd /root/apk_of_ata && tar xzf /tmp/under6_games_backends.tgz && docker compose -f docker-compose.under6-games.yml up -d --build"

echo "=== 4) Patch nginx on LB ==="
$SSH root@$LB 'python3 - <<'"'"'PY'"'"'
from pathlib import Path
import re
conf = Path("/etc/nginx/sites-enabled/gunduata.tech")
text = conf.read_text()
marker = "# === UNDER6 CARD GAMES (auto) ==="
if marker in text:
    text = re.sub(r"\n    # === UNDER6 CARD GAMES \(auto\) ===.*?# === END UNDER6 CARD GAMES ===\n", "\n", text, flags=re.S)
    print("removed old under6-card block")
block = """
    # === UNDER6 CARD GAMES (auto) ===
    location = /rushbet { return 301 /rushbet/$is_args$args; }
    location /rushbet/ { alias /var/www/gunduata/rushbet/; try_files $uri $uri/ /rushbet/index.html; }
    location = /knock6 { return 301 /knock6/$is_args$args; }
    location /knock6/ { alias /var/www/gunduata/knock6/; try_files $uri $uri/ /knock6/index.html; }
    location = /tripleedge { return 301 /tripleedge/$is_args$args; }
    location /tripleedge/ { alias /var/www/gunduata/tripleedge/; try_files $uri $uri/ /tripleedge/index.html; }
    location = /mirror { return 301 /mirror/$is_args$args; }
    location /mirror/ { alias /var/www/gunduata/mirror/; try_files $uri $uri/ /mirror/index.html; }
    location = /goldlane { return 301 /goldlane/$is_args$args; }
    location /goldlane/ { alias /var/www/gunduata/goldlane/; try_files $uri $uri/ /goldlane/index.html; }
    location = /dead7 { return 301 /dead7/$is_args$args; }
    location /dead7/ { alias /var/www/gunduata/dead7/; try_files $uri $uri/ /dead7/index.html; }
    location = /teenpatti { return 301 /teenpatti/$is_args$args; }
    location /teenpatti/ { alias /var/www/gunduata/teenpatti/; try_files $uri $uri/ /teenpatti/index.html; }

    location /api/rushbet/ { proxy_pass http://72.61.254.71:8140/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    location /api/knock6/ { proxy_pass http://72.61.254.71:8141/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    location /api/tripleedge/ { proxy_pass http://72.61.254.71:8142/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    location /api/mirror/ { proxy_pass http://72.61.254.71:8143/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    location /api/goldlane/ { proxy_pass http://72.61.254.71:8144/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    location /api/dead7/ { proxy_pass http://72.61.254.71:8145/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    location /api/teenpatti/ { proxy_pass http://72.61.254.71:8146/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    # === END UNDER6 CARD GAMES ===
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
for u in /casino/ /rushbet/ /dead7/ /teenpatti/ /under-6/ /api/rushbet/session/ /api/dead7/session/ /api/under-6/; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" -X GET "https://gunduata.tech$u" || echo err)
  echo "  $code $u"
done
# session create is POST
for api in rushbet knock6 tripleedge mirror goldlane dead7 teenpatti; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "https://gunduata.tech/api/$api/session/" -H 'Content-Type: application/json' -d '{}' || echo err)
  echo "  $code POST /api/$api/session/"
done
echo "Done."
