# Line — Django API

## Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 8000
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/config/` | Wheel segments, outcomes, bet limits (INR) |
| POST | `/api/session/` | Create player with ₹1000 balance |
| GET | `/api/session/<player_id>/` | Balance + last spin |
| GET | `/api/session/<player_id>/spins/` | Recent spin history |
| POST | `/api/spin/` | Place bet — body `{ "player_id", "bet_amount" }` |

Spins always land on a colored segment (never dark gaps). Currency is INR (₹).

## Frontend

Vite proxies `/api` → `http://127.0.0.1:8000`. Run both:

```bash
# terminal 1
cd backend && source .venv/bin/activate && python manage.py runserver 8000

# terminal 2
cd frontend && npm run dev
```
