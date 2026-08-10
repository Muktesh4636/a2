#!/usr/bin/env bash
# Deploy Mines / Plinko / Air Balloon frontends + backends + casino tiles.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
PASSWORD="${SERVER_PASSWORD:-Gunduata@123}"
LB="72.62.226.41"
APP="72.61.254.71"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH="sshpass -p $PASSWORD ssh -o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no -o ConnectTimeout=20"
SCP="sshpass -p $PASSWORD scp -o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no -o ConnectTimeout=20"

GAMES="mines steps boxes snake slide cases drop plinko"

echo "=== 1) Casino lobby ==="
$SSH root@$LB "mkdir -p /var/www/gunduata/casino/images"
$SCP "$ROOT/casino/games.js" root@$LB:/var/www/gunduata/casino/games.js
$SCP "$ROOT/casino/images/"*.jpeg root@$LB:/var/www/gunduata/casino/images/ || true
$SSH root@$LB "chown -R www-data:www-data /var/www/gunduata/casino"

echo "=== 2) Static frontends → LB ==="
for g in $GAMES; do
  SRC="$ROOT/Mines/$g/frontend/dist"
  [ "$g" = "plinko" ] && SRC="$ROOT/plinko/frontend/dist"
  echo "  /$g/ from $SRC"
  $SSH root@$LB "mkdir -p /var/www/gunduata/$g"
  $SCP -r "$SRC/"* "root@$LB:/var/www/gunduata/$g/"
  $SSH root@$LB "chown -R www-data:www-data /var/www/gunduata/$g"
done

echo "  /air-balloon/"
$SSH root@$LB "mkdir -p /var/www/gunduata/air-balloon/images"
$SCP "$ROOT/Air_ballon_pump/frontend/index.html" \
     "$ROOT/Air_ballon_pump/frontend/styles.css" \
     "$ROOT/Air_ballon_pump/frontend/game.js" \
     root@$LB:/var/www/gunduata/air-balloon/
$SCP "$ROOT/Air_ballon_pump/frontend/images/"* root@$LB:/var/www/gunduata/air-balloon/images/ || true
$SSH root@$LB "chown -R www-data:www-data /var/www/gunduata/air-balloon"

echo "=== 3) Copy backends + compose to app server ==="
$SSH root@$APP "mkdir -p /root/apk_of_ata/Mines /root/apk_of_ata/plinko /root/apk_of_ata/Air_ballon_pump"
# rsync via tar for speed
cd "$ROOT"
tar czf /tmp/mini_games_backends.tgz \
  Mines/mines/backend Mines/steps/backend Mines/boxes/backend \
  Mines/snake/backend Mines/slide/backend Mines/cases/backend \
  Mines/drop/backend plinko/backend Air_ballon_pump/backend \
  docker-compose.mini-games.yml
$SCP /tmp/mini_games_backends.tgz root@$APP:/tmp/mini_games_backends.tgz
$SSH root@$APP "cd /root/apk_of_ata && tar xzf /tmp/mini_games_backends.tgz && docker compose -f docker-compose.mini-games.yml up -d --build"

echo "=== 4) Patch nginx on LB (specific API locations before /api/) ==="
$SSH root@$APP "sleep 2; docker ps --format '{{.Names}} {{.Status}}' | grep gundu_ || true"

# Write nginx snippet and inject if missing
$SSH root@$LB 'python3 - <<'"'"'PY'"'"'
from pathlib import Path
import re
conf = Path("/etc/nginx/sites-enabled/gunduata.tech")
text = conf.read_text()
marker = "# === MINI GAMES (auto) ==="
if marker in text:
    print("nginx mini-games block already present")
else:
    block = """
    # === MINI GAMES (auto) ===
    location = /mines { return 301 /mines/$is_args$args; }
    location /mines/ { alias /var/www/gunduata/mines/; try_files $uri $uri/ /mines/index.html; }
    location = /steps { return 301 /steps/$is_args$args; }
    location /steps/ { alias /var/www/gunduata/steps/; try_files $uri $uri/ /steps/index.html; }
    location = /boxes { return 301 /boxes/$is_args$args; }
    location /boxes/ { alias /var/www/gunduata/boxes/; try_files $uri $uri/ /boxes/index.html; }
    location = /snake { return 301 /snake/$is_args$args; }
    location /snake/ { alias /var/www/gunduata/snake/; try_files $uri $uri/ /snake/index.html; }
    location = /slide { return 301 /slide/$is_args$args; }
    location /slide/ { alias /var/www/gunduata/slide/; try_files $uri $uri/ /slide/index.html; }
    location = /cases { return 301 /cases/$is_args$args; }
    location /cases/ { alias /var/www/gunduata/cases/; try_files $uri $uri/ /cases/index.html; }
    location = /drop { return 301 /drop/$is_args$args; }
    location /drop/ { alias /var/www/gunduata/drop/; try_files $uri $uri/ /drop/index.html; }
    location = /plinko { return 301 /plinko/$is_args$args; }
    location /plinko/ { alias /var/www/gunduata/plinko/; try_files $uri $uri/ /plinko/index.html; }
    location = /air-balloon { return 301 /air-balloon/$is_args$args; }
    location /air-balloon/ { alias /var/www/gunduata/air-balloon/; try_files $uri $uri/ /air-balloon/index.html; }

    location /api/mines/ { proxy_pass http://72.61.254.71:8101/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    location /api/steps/ { proxy_pass http://72.61.254.71:8102/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    location /api/boxes/ { proxy_pass http://72.61.254.71:8103/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    location /api/snake/ { proxy_pass http://72.61.254.71:8104/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    location /api/slide/ { proxy_pass http://72.61.254.71:8105/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    location /api/cases/ { proxy_pass http://72.61.254.71:8106/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    location /api/drop/ { proxy_pass http://72.61.254.71:8107/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    location /api/plinko/ { proxy_pass http://72.61.254.71:8108/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    location /api/air-balloon/ { proxy_pass http://72.61.254.71:8109/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    # === END MINI GAMES ===
"""
    # Insert before general /api/ block
    text2, n = re.subn(r"(\n\s*location /api/ \{)", block + r"\1", text, count=1)
    if n != 1:
        raise SystemExit("Could not find location /api/ to insert before")
    conf.write_text(text2)
    print("nginx block inserted")
PY
nginx -t && systemctl reload nginx && echo nginx_reloaded
'

echo "=== 5) Smoke ==="
for u in /casino/ /mines/ /plinko/ /air-balloon/ /api/mines/player/ /api/air-balloon/bootstrap/; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "https://gunduata.tech$u" || echo err)
  echo "  $code $u"
done
echo "Done."
