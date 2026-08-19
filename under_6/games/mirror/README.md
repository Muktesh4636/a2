# MIRROR

Same color or clash.

```
mirror/
  frontend/
  backend/
```

## Rules

- Two cards (A–6)
- **Mirror** — both red or both black · **2×**
- **Clash** — one red, one black · **2×**

## Run

```bash
cd backend
source .venv/bin/activate
python manage.py migrate
python manage.py runserver 8050
```

Open [http://127.0.0.1:8050/](http://127.0.0.1:8050/)
