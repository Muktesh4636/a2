# Vortex Django Backend

All server code lives in this folder.

- Frontend UI: `../frontend/`
- Images: `../images/`

## Setup

```bash
cd backend
python3 -m pip install -r requirements.txt
python3 manage.py migrate
python3 manage.py runserver 8000
```

Open **http://127.0.0.1:8000/**

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/state/` | Balance, bet, ring fills, payouts |
| POST | `/api/bet/` | `{ "bet": 1 }` set stake |
| POST | `/api/spin/` | Deduct bet, roll drop, update rings |
| POST | `/api/cashout/` | Cash out full ring progress |
| POST | `/api/part/` | Part payout (−1 sector on rings with ≥2) |
| POST | `/api/reset/` | Reset demo balance & rings |

Session cookie tracks each player. Spins / payouts are authoritative on the server.
