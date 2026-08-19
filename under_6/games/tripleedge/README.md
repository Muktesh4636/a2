# TRIPLE EDGE

Three cards. Bet Under / Edge / Over.

```
tripleedge/
  frontend/
  backend/
```

## Rules

- Three cards (A–6), sum 3–18
- **Under** — sum 3–9 · **2×**
- **Edge** — sum 10–11 · **5×**
- **Over** — sum 12–18 · **2×**

## Run

```bash
cd backend
source .venv/bin/activate
python manage.py migrate
python manage.py runserver 8040
```

Open [http://127.0.0.1:8040/](http://127.0.0.1:8040/)
