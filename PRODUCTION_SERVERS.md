# Production server details (reference – do not change servers from automation)

## Load balancer (Nginx / public entry)

- **IP:** 72.62.226.41  
- **Domain:** gunduata.tech (also www.gunduata.tech)  
- **Ports:** 80 / 443  
- **Backends:** app servers **72.61.254.74** (primary) and **72.61.254.71** (backup) on port **8001**
- **Config:** `nginx/load_balancer.conf` → deploy to `/etc/nginx/sites-available/gunduata.tech`
- **Legacy LB (removed):** 187.77.186.84 — offline, do not use

## App servers (Docker)

- **Stack:** dice_game_web, dice_game_timer, dice_game_bet_worker, dice_game_redis (local), daily_reset  
- **Port mapping:** host **8001** → container **8080**  
- **UFW:** port 8001 must allow inbound from **72.62.226.41** (load balancer)

| Server   | IP             | Notes |
|----------|----------------|--------|
| Server 1 | 72.61.254.71   | App :8001; backup backend for LB |
| Server 2 | 72.61.254.74   | App :8001; **primary backend** + **shared Redis** (6379) |
| Server 3 | 72.62.226.41   | **Load balancer** (nginx) + optional local app stack |

## Database (Postgres / PgBouncer)

- **Host:** 72.61.255.231  
- **Port:** 6432 (PgBouncer), 5432 (Postgres direct)  
- **DB name:** dice_game  
- **DB user:** muktesh  

## Redis (game state / betting / cache)

- **Host:** 72.61.254.74  
- **Port:** 6379  
- **Password:** Gunduata@123  

## Quick port map

- **Public:** gunduata.tech → **72.62.226.41**:80/443 → **74/71**:8001  
- **App container:** host :8001 → container :8080  
- **Redis:** 72.61.254.74:6379  
- **DB:** 72.61.255.231:6432  

## Deploy load balancer

```bash
bash tools/deploy_websocket.sh   # copies nginx/load_balancer.conf to 72.62.226.41
```
