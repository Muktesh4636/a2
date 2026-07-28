# Chicken Road 2 — Django backend

REST API for balance, rounds, steps, and cash-out. Lives in this folder separately from the frontend.

## Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 8000
```

API base: **http://127.0.0.1:8000/api/**

## Auth

Guest players — send header:

```
X-Player-Token: <token>
```

`GET /api/player/me/` creates a guest if the header is missing and returns a new `token`. Store it in the client and send it on later requests.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health/` | Liveness |
| GET | `/api/config/` | Multipliers, difficulties, bet limits |
| GET | `/api/player/me/` | Balance + active round |
| POST | `/api/player/reset/` | Reset demo balance to 1,000,000 |
| POST | `/api/rounds/start/` | Body: `{ "bet", "difficulty", "client_seed?" }` |
| POST | `/api/rounds/<id>/step/` | Advance one lane (survive / crash) |
| POST | `/api/rounds/<id>/cashout/` | Bank current multiplier |
| GET | `/api/rounds/<id>/` | Round status |

Crash point is rolled server-side at start (HMAC / SHA-256, provably fair). Seeds are revealed only after the round ends.

## Admin

```bash
python manage.py createsuperuser
# http://127.0.0.1:8000/admin/
```

## Example flow

```bash
# Create / fetch player
curl -s http://127.0.0.1:8000/api/player/me/ | jq

# Start round (use returned token)
curl -s -X POST http://127.0.0.1:8000/api/rounds/start/ \
  -H "Content-Type: application/json" \
  -H "X-Player-Token: YOUR_TOKEN" \
  -d '{"bet": 50, "difficulty": "easy"}' | jq

# Step / cash out
curl -s -X POST http://127.0.0.1:8000/api/rounds/ROUND_ID/step/ \
  -H "X-Player-Token: YOUR_TOKEN" | jq

curl -s -X POST http://127.0.0.1:8000/api/rounds/ROUND_ID/cashout/ \
  -H "X-Player-Token: YOUR_TOKEN" | jq
```
