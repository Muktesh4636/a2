#!/bin/bash
# Run Evolution roulette relay locally (Mac) and push HLS segments to production server.
# Evolution blocks datacenter IPs — local Chrome session is required.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="${RELAY_SERVER:-72.61.254.71}"
PASS="${SERVER_PASSWORD:-Gunduata@123}"
OUT_DIR="${OUT_DIR:-/tmp/hls-auto-roulette-local}"
SSH="sshpass -p $PASS ssh -o StrictHostKeyChecking=no"

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
[ -n "$TOKEN" ] || { echo "Log in to 4rabet in Chrome Profile 1 first"; exit 1; }

COOKIES_JSON=$(/Library/Frameworks/Python.framework/Versions/3.12/bin/python3 -c "
import json
try:
    import browser_cookie3
    from pathlib import Path
    prof = Path.home()/'Library/Application Support/Google/Chrome/Profile 1/Cookies'
    out = []
    for c in browser_cookie3.chrome(cookie_file=str(prof)):
        if '4rabet' in c.domain:
            out.append({
                'name': c.name, 'value': c.value, 'domain': c.domain,
                'path': c.path or '/', 'secure': bool(c.secure),
            })
    print(json.dumps(out))
except Exception as e:
    print('[]')
" 2>/dev/null || echo '[]')

cd "$ROOT"
npm install --omit=dev >/dev/null
npx playwright install chromium 2>/dev/null || true

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

echo "Starting local relay → $OUT_DIR"
FOURABET_ACCESS_TOKEN="$TOKEN" FOURABET_COOKIES_JSON="$COOKIES_JSON" OUT_DIR="$OUT_DIR" node relay.js &
RELAY_PID=$!
trap 'kill $RELAY_PID 2>/dev/null; exit' INT TERM

echo "Pushing HLS to $APP (Ctrl+C to stop)…"
while kill -0 "$RELAY_PID" 2>/dev/null; do
  if [ -f "$OUT_DIR/stream.m3u8" ]; then
    tar czf /tmp/roulette_hls_push.tgz -C "$OUT_DIR" . 2>/dev/null || true
    if [ -s /tmp/roulette_hls_push.tgz ]; then
      sshpass -p "$PASS" scp -o StrictHostKeyChecking=no /tmp/roulette_hls_push.tgz "root@$APP:/tmp/" 2>/dev/null || true
      $SSH "root@$APP" "mkdir -p /root/evolution-roulette/hls-push/auto-roulette && tar xzf /tmp/roulette_hls_push.tgz -C /root/evolution-roulette/hls-push/auto-roulette" 2>/dev/null || true
    fi
  fi
  sleep 2
done

wait "$RELAY_PID" || true
