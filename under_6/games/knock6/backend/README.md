# KNOCK 6 — Backend

```bash
source .venv/bin/activate
python manage.py migrate
python manage.py runserver 8030
```

API: `POST /api/session/`, `POST /api/deal/` with `{session_id, side: "clear"|"pair", chip}`
