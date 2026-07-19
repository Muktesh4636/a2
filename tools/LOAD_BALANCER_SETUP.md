# Load balancer 72.62.226.41 (gunduata.tech)

**DNS:** gunduata.tech → **72.62.226.41**

**Flow:** User → **72.62.226.41** (nginx LB) → app backends (71 primary, 74 backup)

**Legacy (removed):** 187.77.186.84 — do not use

## Deploy / update

```bash
bash tools/deploy_websocket.sh
```

Or manually:

```bash
scp nginx/load_balancer.conf root@72.62.226.41:/etc/nginx/sites-available/gunduata.tech
ssh root@72.62.226.41 "nginx -t && systemctl reload nginx"
```

## App server firewall

Backends must allow the LB:

```bash
ufw allow from 72.62.226.41 to any port 8001 proto tcp
```

## HTTPS

After HTTP works:

```bash
certbot certonly --webroot -w /var/www/html -d gunduata.tech -d www.gunduata.tech
# Then enable the HTTPS server block in nginx/load_balancer.conf (lines 134+)
```
