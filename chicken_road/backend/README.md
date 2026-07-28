# Chicken Road — Django API

Authoritative game backend for the Chicken Road frontend.

## Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 8000
```

API base: `http://127.0.0.1:8000/api/`

## Auth

Guest players. Send header on every request after create:

```
X-Player-Id: <uuid from POST /api/player/>
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/player/` | Create guest player (or return existing if header set) |
| `GET` | `/api/player/me/` | Current balance |
| `GET` | `/api/config/` | Min/max bet, difficulties, multiplier ladders |
| `POST` | `/api/game/start/` | Body: `{ "bet": 20, "difficulty": "easy" }` — debits bet, starts round, reveals first step |
| `POST` | `/api/game/{id}/go/` | Advance one step |
| `POST` | `/api/game/{id}/cashout/` | Cash out at current multiplier |
| `GET` | `/api/game/{id}/` | Public round state (revealed tiles only) |
| `GET` | `/api/live/` | Fake live-wins feed |

Unrevealed tile `safe` flags are never sent to the client.

## Example

```bash
# Create player
curl -s -X POST http://127.0.0.1:8000/api/player/ | tee /tmp/player.json
PLAYER=$(python3 -c "import json; print(json.load(open('/tmp/player.json'))['id'])")

# Start game
curl -s -X POST http://127.0.0.1:8000/api/game/start/ \
  -H "Content-Type: application/json" \
  -H "X-Player-Id: $PLAYER" \
  -d '{"bet":20,"difficulty":"easy"}'

# Go / cashout use the round_id from the start response
```
