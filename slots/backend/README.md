# Shared Slots Backend (Django)

One Django API powers all 20 slot frontends under `slots/`.

## Run locally

```bash
cd slots/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 0.0.0.0:8130
```

## API

Base: `http://127.0.0.1:8130/api/slots/`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health/` | Health check |
| GET | `/games/` | List all games |
| GET | `/config/<game_id>/` | Symbols, bets, lines, mode |
| POST | `/session/` | Create player (demo balance) |
| GET | `/session/<player_id>/?game_id=` | Balance + free spins / pearls |
| POST | `/spin/` | Server-authoritative spin |

### Create session

```bash
curl -X POST http://127.0.0.1:8130/api/slots/session/
```

### Spin

```bash
curl -X POST http://127.0.0.1:8130/api/slots/spin/ \
  -H 'Content-Type: application/json' \
  -d '{"player_id":"<uuid>","game_id":"atlantis-depths","bet_amount":"1.00"}'
```

Response includes:
- `grid` — landing symbols `[col][row]`
- `final_grid` — after cluster drops (sugar-rush)
- `payout`, `win_cells`, `line_wins` / `ways_wins` / `cascades`
- `balance`, `free_spins`, `pearls`

## Engine modes

| Mode | Games | Notes |
|------|-------|-------|
| `lines` | Most slots | Paylines L→R, wilds, expand columns, pearl meter |
| `ways` | `jackpot-plunder` | All-ways + scatter bonus pick |
| `cluster` | `sugar-rush-spins` | Clusters ≥5 with cascades |

Configs live in `game/configs/*.json` (extracted from each game’s `game.js`).

## Wallet note

This first version uses a **local demo `Player.balance`** (same pattern as Line games).  
Next step: plug Gundu JWT wallet the same way Mines / Trading do.

## Docker

```bash
docker build -t gundu-slots-api .
docker run -p 8130:8130 gundu-slots-api
```

Suggested prod path: `/api/slots/` → port `8130`.
