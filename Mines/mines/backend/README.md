# Mines Backend (Django)

All backend code lives in this folder. It owns bets, mine placement, reveals, cash-out, and INR balances.

## Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

API base: `http://127.0.0.1:8000/api/`

Frontend lives in `mines/frontend` and expects this API while running `npm run dev`.

## Auth

No login. Send `X-Player-Id: <uuid>` on every request. Omit it once to create a new player with ₹10,000.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/player/` | Balance + active game |
| POST | `/api/games/start/` | `{ "bet_amount": "100", "mine_count": 3 }` |
| GET | `/api/games/<id>/` | Current game state |
| POST | `/api/games/<id>/reveal/` | `{ "index": 0 }` |
| POST | `/api/games/<id>/cashout/` | Cash out winnings |

Mine positions stay on the server until the round ends.
