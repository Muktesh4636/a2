#!/bin/bash
# Deploy Evolution auto-roulette live HLS relay (same pattern as sports-live).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${RELAY_SERVER:-72.61.254.71}"
LB="${LB_SERVER:-72.62.226.41}"
PASS="${SERVER_PASSWORD:-Gunduata@123}"
SSH="sshpass -p $PASS ssh -o StrictHostKeyChecking=no"
SCP="sshpass -p $PASS scp -o StrictHostKeyChecking=no"

TOKEN="${FOURABET_ACCESS_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  TOKEN=$(python3 -c "
import re
from pathlib import Path
for p in (Path.home()/'Library/Application Support/Google/Chrome/Profile 1/Local Storage/leveldb').glob('*.ldb'):
    d=p.read_bytes().decode('latin1','ignore')
    m=re.search(r'\"access_token\":\"(eyJ[^\"]+)\"', d)
    if m: print(m.group(1)); break
" 2>/dev/null || true)
fi
if [ -z "$TOKEN" ]; then
  echo "Set FOURABET_ACCESS_TOKEN or log in to 4rabet in Chrome Profile 1"
  exit 1
fi

echo "=== Pack relay ==="
cd "$ROOT/tools/evolution-roulette"
tar czf /tmp/evolution_roulette_live.tgz docker-compose.yml relay.js package.json nginx.conf Dockerfile.relay patch_nginx_lb.py

echo "=== Deploy relay to $APP ==="
$SCP /tmp/evolution_roulette_live.tgz "root@$APP:/tmp/"
$SSH "root@$APP" "mkdir -p /root/evolution-roulette && tar xzf /tmp/evolution_roulette_live.tgz -C /root/evolution-roulette && cd /root/evolution-roulette && FOURABET_ACCESS_TOKEN='$TOKEN' docker compose up -d --build"

echo "=== Patch nginx on LB $LB ==="
$SCP "$ROOT/tools/evolution-roulette/patch_nginx_lb.py" "root@$LB:/tmp/patch_roulette_live_nginx.py"
$SSH "root@$LB" "python3 /tmp/patch_roulette_live_nginx.py && nginx -t && systemctl reload nginx"

echo "=== Deploy backend + player page ==="
bash "$ROOT/tools/deploy_backend.sh" \
  backend/game/roulette_live_views.py \
  backend/dice_game/urls.py \
  backend/game/templates/roulette

echo "=== Health ==="
sleep 8
code=$(curl -sS -o /dev/null -w "%{http_code}" "http://$APP:8159/health" || echo err)
echo "  relay health: $code"
code2=$(curl -sS -o /dev/null -w "%{http_code}" "https://gunduata.tech/roulette-live/auto-roulette/stream.m3u8" || echo err)
echo "  public m3u8: $code2 (404/502 until stream starts ~1-2 min)"
echo "  player: https://gunduata.tech/roulette/live/"
echo "  api: https://gunduata.tech/api/roulette/live-stream/"
echo "Done."
