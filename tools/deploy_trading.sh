#!/bin/bash
# Deploy ONLY the Stock Market (trading) game: backend clock + frontend.
#
# Deliberately separate from deploy_all.sh, which ships a fixed list of files
# from the working tree and would drag along unrelated in-progress work.
#
# Run from project root: bash tools/deploy_trading.sh

set -u
PASSWORD="${SERVER_PASSWORD:-Gunduata@123}"
APP_SERVERS=("72.61.254.71" "72.61.254.74" "72.62.226.41")
LB_SERVER="72.62.226.41"
WEB_ROOT="/var/www/gunduata/trading"
REMOTE_DIR="/root/apk_of_ata"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SSH="sshpass -p $PASSWORD ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15"
SCP="sshpass -p $PASSWORD scp -o StrictHostKeyChecking=no -o ConnectTimeout=15"

echo "=== Trading deploy: backend clock ==="
for SERVER in "${APP_SERVERS[@]}"; do
  echo ""
  echo "--- $SERVER ---"

  echo "  game/trading_*.py"
  $SCP "$REPO_ROOT/backend/game/trading_engine.py" \
       "$REPO_ROOT/backend/game/trading_views.py" \
       "$REPO_ROOT/backend/game/trading_services.py" \
       root@$SERVER:$REMOTE_DIR/backend/game/ || echo "    (copy failed)"

  echo "  management/commands/trading_game_timer.py"
  $SCP "$REPO_ROOT/backend/game/management/commands/trading_game_timer.py" \
       root@$SERVER:$REMOTE_DIR/backend/game/management/commands/ || echo "    (copy failed)"

  echo "  docker-compose.yml (adds trading_game_timer service where missing)"
  $SCP "$REPO_ROOT/docker-compose.yml" root@$SERVER:$REMOTE_DIR/ || echo "    (copy failed)"

  echo "  start/restart trading timer"
  $SSH root@$SERVER \
    "cd $REMOTE_DIR && docker compose up -d trading_game_timer >/dev/null 2>&1; \
     docker restart dice_game_trading_timer >/dev/null 2>&1; \
     docker ps --format '{{.Names}}|{{.Status}}' | grep trading || echo '    timer NOT running'"
done

echo ""
echo "=== Trading deploy: frontend (LB $LB_SERVER) ==="
$SCP "$REPO_ROOT/trading_gunduata/frontend/game.js" \
     "$REPO_ROOT/trading_gunduata/frontend/styles.css" \
     root@$LB_SERVER:$WEB_ROOT/ || echo "  (copy failed)"
$SSH root@$LB_SERVER "chown www-data:www-data $WEB_ROOT/game.js $WEB_ROOT/styles.css && ls -la $WEB_ROOT/game.js $WEB_ROOT/styles.css"

echo ""
echo "=== Verify: is the shared market clock advancing? ==="
sleep 6
for i in 1 2 3; do
  $SSH root@72.61.254.74 \
    "curl -s --max-time 5 http://127.0.0.1:8001/api/trading/state/" 2>/dev/null \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print('  round=%s phase=%-8s left=%.1fs' % (d['round'],d['phase'],d['seconds_left']))" 2>/dev/null \
    || echo "  (state read failed)"
  sleep 8
done

echo ""
echo "Done. If round increments above, the market clock is live."
