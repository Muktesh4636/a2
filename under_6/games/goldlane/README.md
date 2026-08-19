# GOLD LANE

Middle lane jackpot.

```
goldlane/
  frontend/
  backend/
```

## Rules

- Two cards (A–6)
- **Low** — sum 2–5 · **2×**
- **Gold** — sum 6–8 · **5×**
- **High** — sum 9–12 · **2×**

## Run

```bash
cd backend && source .venv/bin/activate
python manage.py migrate
python manage.py runserver 8060
```

Open [http://127.0.0.1:8060/](http://127.0.0.1:8060/)
