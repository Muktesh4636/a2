# UNDER 6 — Backend

Django API for this game. Frontend is in `../frontend/`.

```bash
source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 8010
```

Open [http://127.0.0.1:8010/](http://127.0.0.1:8010/)

## API

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/session/` | — | Create session (bankroll ₹1000) |
| `GET` | `/api/session/<id>/` | — | Get bankroll |
| `POST` | `/api/session/<id>/reset/` | — | Reset bankroll |
| `GET` | `/api/session/<id>/history/` | — | Recent rounds |
| `POST` | `/api/deal/` | `{session_id, side, chip}` | Deal & resolve |
