# Roulette Django backend

Guest-session API that owns balance, pending bets, and server-side spin settlement for the Speed Auto Roulette web / WebView client.

## Setup

```bash
cd backend
python3 -m pip install -r requirements.txt
python3 manage.py migrate
python3 manage.py runserver 8000
```

API base: `http://127.0.0.1:8000/api/`

Admin (optional):

```bash
python3 manage.py createsuperuser
# open http://127.0.0.1:8000/admin/
```

## Auth

Every endpoint except `POST /api/session/` requires header:

```
X-Session-Token: <uuid from session>
```

## Endpoints

| Method | Path | Body | Notes |
|--------|------|------|-------|
| POST | `/api/session/` | — | Creates guest; returns `session_token`, `balance` (₹10,000) |
| GET | `/api/me/` | — | Balance + pending bets |
| POST | `/api/bets/` | `{ "key": "straight:17", "amount": 10 }` or `{ "type": "red", "amount": 50 }` | Debits balance |
| POST | `/api/bets/undo/` | — | Undo last chip |
| POST | `/api/bets/double/` | — | Double all pending |
| POST | `/api/bets/clear/` | — | Refund all pending |
| POST | `/api/spin/` | optional `{ "number": 7 }` | Server rolls 0–36 (or forced number for demos), settles |
| GET | `/api/history/?limit=20` | — | Recent rounds |

### Bet keys

Same shape as the web board:

- `straight:0` … `straight:36`
- `red`, `black`, `even`, `odd`, `low`, `high`
- `dozen:1|2|3`, `column:1|2|3`

Payouts (gross, includes stake): straight **36×**, dozen/column **3×**, even-money **2×**.

## Web client

The web UI lives in [`frontend/`](../frontend/). [`frontend/app.js`](../frontend/app.js) talks to this API:

1. On load → `POST /api/session/` (or restore token from `localStorage`)
2. Place / undo / double / clear → matching `/api/bets*` routes
3. Spin → ball settles by physics, then `POST /api/spin/` with the landed number

Serve the frontend:

```bash
cd frontend && python3 -m http.server 8765 --bind 127.0.0.1
```

API base URL (defaults to `http://127.0.0.1:8000/api`):

```
?api=http://192.168.1.10:8000/api
```

or:

```js
localStorage.setItem("roultee_api", "http://192.168.1.10:8000/api")
```

Use your LAN IP when testing the WebView APK on a phone.

## Quick curl smoke test

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:8000/api/session/ | python3 -c "import sys,json; print(json.load(sys.stdin)['session_token'])")

curl -s -X POST http://127.0.0.1:8000/api/bets/ \
  -H "Content-Type: application/json" \
  -H "X-Session-Token: $TOKEN" \
  -d '{"key":"straight:17","amount":10}'

curl -s -X POST http://127.0.0.1:8000/api/spin/ \
  -H "Content-Type: application/json" \
  -H "X-Session-Token: $TOKEN" \
  -d '{"number":17}'
```

## Tests

```bash
cd backend
python3 manage.py test game
```

## Layout

```
backend/
  config/       # Django settings + root URLs
  accounts/     # Player (guest session)
  game/         # bets, rounds, rules, API
  manage.py
  requirements.txt
```

SQLite DB file: `backend/db.sqlite3` (created by migrate).
