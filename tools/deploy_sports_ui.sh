#!/usr/bin/env bash
# Deploy sports/cricket web UI to the LB static paths (nginx serves /var/www/gunduata/).
# Also updates Django templates on app servers via deploy_backend.sh.
set -euo pipefail
PASSWORD="${SERVER_PASSWORD:-Gunduata@123}"
LB="${SPORTS_UI_LB:-72.62.226.41}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH="sshpass -p $PASSWORD ssh -o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no -o ConnectTimeout=25"
SCP="sshpass -p $PASSWORD scp -o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no -o ConnectTimeout=25"
REMOTE="/var/www/gunduata"
T="$ROOT/backend/game/templates"

echo "=== 1) Django templates (app servers) ==="
bash "$ROOT/tools/deploy_backend.sh" \
  backend/game/templates/sports \
  backend/game/templates/cricket \
  backend/game/sports_views.py \
  backend/game/cricket_views.py \
  backend/game/soccer_tennis_views.py \
  backend/game/radhexchange_stream.py \
  backend/game/sports_live_tv_views.py

echo "=== 2) LB static copies (what nginx actually serves) ==="
$SSH root@$LB "mkdir -p $REMOTE/sports/match $REMOTE/cricket"
$SCP "$T/sports/index.html" "root@$LB:$REMOTE/sports/index.html"
$SCP "$T/sports/live-tv.js" "root@$LB:$REMOTE/sports/live-tv.js"
$SCP "$T/sports/betslip.js" "root@$LB:$REMOTE/sports/betslip.js"
$SCP "$T/sports/_auth_wallet.js" "root@$LB:$REMOTE/sports/auth-wallet.js"
$SCP "$T/sports/_auth_wallet.js" "root@$LB:$REMOTE/sports/_auth_wallet.js"
$SCP "$T/sports/match/index.html" "root@$LB:$REMOTE/sports/match/index.html"
$SCP "$T/cricket/index.html" "root@$LB:$REMOTE/cricket/index.html"
$SSH root@$LB "chown -R www-data:www-data $REMOTE/sports $REMOTE/cricket"

echo "=== 3) Smoke ==="
for u in /sports/ /sports/live-tv.js /sports-live/index.json /cricket/; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "https://gunduata.tech$u" || echo err)
  echo "  $code https://gunduata.tech$u"
done
if curl -sS "https://gunduata.tech/sports/live-tv.js" | grep -q scoreEventStream; then
  echo "  live-tv.js: scoreEventStream OK"
else
  echo "  WARN: live-tv.js missing scoreEventStream"
fi
if curl -sS "https://gunduata.tech/sports/" | grep -q mountFeaturedLiveTv; then
  echo "  sports index: featured TV OK"
else
  echo "  WARN: sports index missing featured TV"
fi
echo "Done."
