# Steps Backend (Django)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 8001
```

API base: `http://127.0.0.1:8001/api/`

| Method | Path | Body |
|--------|------|------|
| GET | `/api/player/` | — |
| POST | `/api/games/start/` | `{ "bet_amount": "100" }` |
| POST | `/api/games/<id>/choose/` | `{ "column": 0\|1\|2 }` |
| POST | `/api/games/<id>/cashout/` | — |

Send `X-Player-Id` after the first response. Danger columns stay on the server until the round ends.
