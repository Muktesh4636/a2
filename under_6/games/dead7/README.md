# DEAD 7

Hit exactly seven.

```
dead7/
  frontend/
  backend/
```

## Rules

- Two cards (A–6)
- **Under** — sum 2–6 · **2×**
- **Dead 7** — sum = 7 · **5×**
- **Over** — sum 8–12 · **2×**

## Run

```bash
cd backend && source .venv/bin/activate
python manage.py migrate
python manage.py runserver 8070
```

Open [http://127.0.0.1:8070/](http://127.0.0.1:8070/)
