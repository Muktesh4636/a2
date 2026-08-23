#!/usr/bin/env bash
# Deploy Teen Patti frontend only (no external 4rabet/TvBet live relay).
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
PASSWORD="${SERVER_PASSWORD:-Gunduata@123}"
LB="72.62.226.41"
APP="72.61.254.71"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH="sshpass -p $PASSWORD ssh -o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no -o ConnectTimeout=25"
SCP="sshpass -p $PASSWORD scp -o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no -o ConnectTimeout=25"

echo "=== 1) Stop external live relay (if running) ==="
$SSH root@$APP 'cd /root/teenpatti-live 2>/dev/null && docker compose down || true'

echo "=== 2) Teen Patti frontend → LB ==="
$SSH root@$LB "mkdir -p /var/www/gunduata/teenpatti"
for f in index.html styles.css game.js table3d.js; do
  $SCP "$ROOT/under_6/games/teenpatti/frontend/$f" "root@$LB:/var/www/gunduata/teenpatti/$f"
done
$SSH root@$LB "chown -R www-data:www-data /var/www/gunduata/teenpatti"

echo "=== 3) Smoke ==="
code=$(curl -sS -o /dev/null -w "%{http_code}" "https://gunduata.tech/teenpatti/" || echo err)
echo "  $code /teenpatti/"
echo "Done."
