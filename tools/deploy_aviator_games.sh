#!/usr/bin/env bash
# Deploy Aviator crash games (same pattern as under-6 / line games).
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
PASSWORD="${SERVER_PASSWORD:-Gunduata@123}"
LB="72.62.226.41"
APP="72.61.254.71"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH="sshpass -p $PASSWORD ssh -o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no -o ConnectTimeout=20"
SCP="sshpass -p $PASSWORD scp -o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no -o ConnectTimeout=20"

# folder:casino_id
MAP=(
  "aviator:aviator"
  "jet:jet"
  "maestro:maestro"
  "deep-dive:deep-dive"
  "sky-lift:sky-lift"
  "paper-plane:paper-plane"
  "ufo-lift:ufo-lift"
  "wave-surf:shark-bite"
)

echo "=== 0) Build frontends ==="
if [[ "${SKIP_BUILD:-0}" == "1" ]]; then
  echo "  SKIP_BUILD=1 — using existing dist/"
else
  for item in "${MAP[@]}"; do
    folder="${item%%:*}"
    echo "  build $folder"
    (cd "$ROOT/Aviator/$folder" && npm install --silent && npm run build)
  done
fi

echo "=== 1) Casino lobby + tiles ==="
$SSH root@$LB "mkdir -p /var/www/gunduata/casino/images"
$SCP "$ROOT/casino/games.js" root@$LB:/var/www/gunduata/casino/games.js
$SCP "$ROOT/casino/app.js" root@$LB:/var/www/gunduata/casino/app.js
for item in "${MAP[@]}"; do
  id="${item##*:}"
  $SCP "$ROOT/casino/images/$id.png" "root@$LB:/var/www/gunduata/casino/images/$id.png"
done
$SSH root@$LB "chown -R www-data:www-data /var/www/gunduata/casino"

echo "=== 2) Static frontends → LB ==="
for item in "${MAP[@]}"; do
  folder="${item%%:*}"
  id="${item##*:}"
  SRC="$ROOT/Aviator/$folder/dist"
  echo "  /$id/ from $SRC"
  $SSH root@$LB "mkdir -p /var/www/gunduata/$id"
  $SCP -r "$SRC/"* "root@$LB:/var/www/gunduata/$id/"
  $SSH root@$LB "chown -R www-data:www-data /var/www/gunduata/$id"
done

echo "=== 3) Backends + compose → app server ==="
cd "$ROOT"
tar czf /tmp/aviator_games_backends.tgz \
  Aviator/aviator/backend Aviator/jet/backend Aviator/maestro/backend \
  Aviator/deep-dive/backend Aviator/sky-lift/backend Aviator/paper-plane/backend \
  Aviator/ufo-lift/backend Aviator/wave-surf/backend \
  docker-compose.aviator-games.yml
$SCP /tmp/aviator_games_backends.tgz root@$APP:/tmp/aviator_games_backends.tgz
$SSH root@$APP "cd /root/apk_of_ata && tar xzf /tmp/aviator_games_backends.tgz && docker compose -f docker-compose.aviator-games.yml up -d --build"

echo "=== 4) Patch nginx on LB ==="
$SSH root@$LB 'python3 - <<'"'"'PY'"'"'
from pathlib import Path
import re
conf = Path("/etc/nginx/sites-enabled/gunduata.tech")
text = conf.read_text()
marker = "# === AVIATOR GAMES (auto) ==="
if marker in text:
    text = re.sub(r"\n    # === AVIATOR GAMES \(auto\) ===.*?# === END AVIATOR GAMES ===\n", "\n", text, flags=re.S)
    print("removed old aviator block")
block = """
    # === AVIATOR GAMES (auto) ===
    location = /aviator { return 301 /aviator/$is_args$args; }
    location /aviator/ { alias /var/www/gunduata/aviator/; try_files $uri $uri/ /aviator/index.html; }
    location = /jet { return 301 /jet/$is_args$args; }
    location /jet/ { alias /var/www/gunduata/jet/; try_files $uri $uri/ /jet/index.html; }
    location = /maestro { return 301 /maestro/$is_args$args; }
    location /maestro/ { alias /var/www/gunduata/maestro/; try_files $uri $uri/ /maestro/index.html; }
    location = /deep-dive { return 301 /deep-dive/$is_args$args; }
    location /deep-dive/ { alias /var/www/gunduata/deep-dive/; try_files $uri $uri/ /deep-dive/index.html; }
    location = /sky-lift { return 301 /sky-lift/$is_args$args; }
    location /sky-lift/ { alias /var/www/gunduata/sky-lift/; try_files $uri $uri/ /sky-lift/index.html; }
    location = /paper-plane { return 301 /paper-plane/$is_args$args; }
    location /paper-plane/ { alias /var/www/gunduata/paper-plane/; try_files $uri $uri/ /paper-plane/index.html; }
    location = /ufo-lift { return 301 /ufo-lift/$is_args$args; }
    location /ufo-lift/ { alias /var/www/gunduata/ufo-lift/; try_files $uri $uri/ /ufo-lift/index.html; }
    location = /shark-bite { return 301 /shark-bite/$is_args$args; }
    location /shark-bite/ { alias /var/www/gunduata/shark-bite/; try_files $uri $uri/ /shark-bite/index.html; }

    location /api/aviator/ { proxy_pass http://72.61.254.71:8130/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    location /api/jet/ { proxy_pass http://72.61.254.71:8131/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    location /api/maestro/ { proxy_pass http://72.61.254.71:8132/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    location /api/deep-dive/ { proxy_pass http://72.61.254.71:8133/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    location /api/sky-lift/ { proxy_pass http://72.61.254.71:8134/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    location /api/paper-plane/ { proxy_pass http://72.61.254.71:8135/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    location /api/ufo-lift/ { proxy_pass http://72.61.254.71:8136/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    location /api/shark-bite/ { proxy_pass http://72.61.254.71:8137/api/; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
    # === END AVIATOR GAMES ===
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
for u in /casino/ /aviator/ /jet/ /maestro/ /shark-bite/ /api/aviator/bootstrap/ /api/shark-bite/bootstrap/; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "https://gunduata.tech$u" || echo err)
  echo "  $code $u"
done
echo "Done."
