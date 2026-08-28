#!/usr/bin/env bash
# Deploy Gundu Ata Unity WebGL + casino cache-bust links to production LB.
# Usage: bash tools/deploy_gundu_ata_webgl.sh [CACHE_VERSION]
# Example: bash tools/deploy_gundu_ata_webgl.sh 44

set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

CACHE_VER="${1:-44}"
PASSWORD="${SERVER_PASSWORD:-Gunduata@123}"
LB="72.62.226.41"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/anshv1.2/Builds/WebGL"
REMOTE="/var/www/gunduata.tech/game"
DEPLOY="$ROOT/anshv1.2/Builds/deploy_game_v${CACHE_VER}"
SSH_OPTS=(-o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no -o ConnectTimeout=30)

if [ ! -f "$SRC/Build/WebGL.loader.js" ]; then
  echo "Missing WebGL build. Run Unity WebGLBatchBuild first."
  exit 1
fi

echo "=== Prepare deploy package v${CACHE_VER} ==="
rm -rf "$DEPLOY"
mkdir -p "$DEPLOY/Build"
cp "$SRC/Build/"* "$DEPLOY/Build/"
cp -R "$SRC/TemplateData" "$DEPLOY/"
cp "$ROOT/.tmp/local_game_server/game/index.html" "$DEPLOY/index.html"

python3 - <<PY
from pathlib import Path
import re
p = Path("$DEPLOY/index.html")
t = p.read_text()
t = re.sub(r'var cacheBust = "\\?v=\\d+";', 'var cacheBust = "?v=${CACHE_VER}";', t)
t = re.sub(r'productVersion: "[^"]*"', 'productVersion: "1.2.18"', t)
p.write_text(t)
print("index.html -> ?v=${CACHE_VER}")
PY

echo "=== Backup + upload game -> $LB:$REMOTE ==="
sshpass -p "$PASSWORD" ssh "${SSH_OPTS[@]}" root@$LB "
set -e
TS=\$(date +%Y%m%d_%H%M%S)
cp -a $REMOTE ${REMOTE}.bak_\$TS 2>/dev/null || true
mkdir -p $REMOTE/Build $REMOTE/TemplateData
"

sshpass -p "$PASSWORD" scp "${SSH_OPTS[@]}" "$DEPLOY/index.html" "root@$LB:$REMOTE/index.html"
sshpass -p "$PASSWORD" scp "${SSH_OPTS[@]}" "$DEPLOY/Build/"* "root@$LB:$REMOTE/Build/"
sshpass -p "$PASSWORD" scp -r "${SSH_OPTS[@]}" "$DEPLOY/TemplateData/"* "root@$LB:$REMOTE/TemplateData/"
sshpass -p "$PASSWORD" ssh "${SSH_OPTS[@]}" root@$LB "chown -R www-data:www-data $REMOTE"

echo "=== Casino links (v${CACHE_VER}) ==="
python3 - <<PY
from pathlib import Path
import re
for rel in ("casino/app.js", "casino/games.js"):
    p = Path("$ROOT") / rel
    t = p.read_text()
    t = re.sub(r'/game/\\?v=\\d+', '/game/?v=${CACHE_VER}', t)
    p.write_text(t)
PY

sshpass -p "$PASSWORD" ssh "${SSH_OPTS[@]}" root@$LB "mkdir -p /var/www/gunduata/casino"
sshpass -p "$PASSWORD" scp "${SSH_OPTS[@]}" \
  "$ROOT/casino/app.js" "$ROOT/casino/games.js" \
  "root@$LB:/var/www/gunduata/casino/"
sshpass -p "$PASSWORD" ssh "${SSH_OPTS[@]}" root@$LB "chown -R www-data:www-data /var/www/gunduata/casino"

echo "=== Backend (recent results API) ==="
bash "$ROOT/tools/deploy_backend.sh" backend/game/views.py

echo ""
echo "Live: https://gunduata.tech/game/?v=${CACHE_VER}"
echo "Casino opens: /game/?v=${CACHE_VER}"
