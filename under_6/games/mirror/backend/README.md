# RUSH BET — Backend

```bash
source .venv/bin/activate
python manage.py migrate
python manage.py runserver 8020
```

API: `POST /api/session/`, `POST /api/deal/` with `{session_id, side: "low"|"high", chip}`
