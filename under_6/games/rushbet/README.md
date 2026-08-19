# RUSH BET

Fast two-card Low / High call.

```
rushbet/
  frontend/
  backend/
```

## Rules

- Two cards (A–6), sum decides
- **Low** — sum 2–6 · pays **2×**
- **High** — sum 7–12 · pays **2×**
- Fast deal / flip pace

## Run

```bash
cd backend
source .venv/bin/activate
python manage.py migrate
python manage.py runserver 8020
```

Open [http://127.0.0.1:8020/](http://127.0.0.1:8020/)
