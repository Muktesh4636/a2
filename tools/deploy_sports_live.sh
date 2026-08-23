#!/usr/bin/env bash
# Deploy multi-sport Radhe Exchange live HLS relay on gunduata.tech
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
PASSWORD="${SERVER_PASSWORD:-Gunduata@123}"
LB="72.62.226.41"
APP="72.61.254.71"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH="sshpass -p $PASSWORD ssh -o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no -o ConnectTimeout=25"
SCP="sshpass -p $PASSWORD scp -o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no -o ConnectTimeout=25"

echo "=== 1) Multi-sport live relay → app server ==="
cd "$ROOT/tools/sports-live"
tar czf /tmp/sports_live.tgz docker-compose.yml relay.sh relay_manager.js nginx.conf Dockerfile.relay resolve_stream.js patch_nginx_lb.py
$SCP /tmp/sports_live.tgz "root@$APP:/tmp/sports_live.tgz"
$SSH root@$APP "mkdir -p /root/sports-live && tar xzf /tmp/sports_live.tgz -C /root/sports-live && chmod +x /root/sports-live/relay.sh /root/sports-live/relay_manager.js && cd /root/sports-live && docker compose up -d --build"

echo "=== 2) nginx proxy on LB ==="
$SCP "$ROOT/tools/sports-live/patch_nginx_lb.py" "root@$LB:/tmp/patch_sports_live_nginx.py"
$SSH root@$LB "python3 /tmp/patch_sports_live_nginx.py && nginx -t && systemctl reload nginx"

echo "=== 3) Smoke (wait for first poll) ==="
sleep 35
$SSH root@$APP "docker logs --tail 20 gundu_sports_live_relay 2>&1 || true"
code=$(curl -sS -o /dev/null -w "%{http_code}" "https://gunduata.tech/sports-live/index.json" || echo err)
echo "  $code /sports-live/index.json"
$SSH root@$APP "docker ps --format '{{.Names}} {{.Status}}' | grep sports_live || true"
echo "Done. Streams: https://gunduata.tech/sports-live/<radhe_event_id>/stream.m3u8"
