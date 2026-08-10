# Plinko Backend (Django)

Python/Django REST API for the Plinko game.

Project layout:

- `frontend/` — game UI
- `backend/` — this API
- `images/` — reference images

## Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 8000
```

API base URL: `http://127.0.0.1:8000/api/`

## Auth (guest players)

No login. The API issues a player token on first request.

- Send header: `X-Player-Token: <token>`
- If missing/unknown, a new player is created with balance `1000.00`
- Store the returned `token` in `localStorage` on the frontend

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health/` | Health check |
| GET | `/api/player/me/` | Get/create player + balance |
| POST | `/api/player/reset/` | Reset balance (`{"balance": 1000}`) |
| GET | `/api/multipliers/?risk=high&rows=16` | Multiplier row for board |
| POST | `/api/bets/` | Place a bet / resolve drop |
| GET | `/api/bets/history/?limit=40` | Recent bets for player |

### Payout rule

**You get back:** `bet × multiplier`  
**Profit / loss:** `payout − bet`

| Bet | Box | You get | Result |
|-----|-----|---------|--------|
| ₹100 | 10× | ₹1000 | +₹900 profit |
| ₹100 | 1.5× | ₹150 | +₹50 profit |
| ₹100 | 0.2× | ₹20 | −₹80 lost |

### Place bet body

```json
{
  "amount": 100,
  "risk": "high",
  "rows": 16,
  "bucket_index": null
}
```

- Omit `bucket_index` (or `null`) → server rolls a fair Galton-style outcome
- Or pass `bucket_index` if the frontend animation already chose a slot (still validated server-side)

### Example

```bash
# Create / fetch player
curl -s http://127.0.0.1:8000/api/player/me/

# Place bet (use token from previous response)
curl -s -X POST http://127.0.0.1:8000/api/bets/ \
  -H "Content-Type: application/json" \
  -H "X-Player-Token: YOUR_TOKEN" \
  -d '{"amount":10,"risk":"high","rows":16}'

# History
curl -s http://127.0.0.1:8000/api/bets/history/ \
  -H "X-Player-Token: YOUR_TOKEN"
```

## Admin

```bash
python manage.py createsuperuser
# open http://127.0.0.1:8000/admin/
```

## Notes

- SQLite DB file: `backend/db.sqlite3`
- CORS is open for local frontend (`localhost:5173`)
- Keep secrets out of git; rotate `SECRET_KEY` before production
