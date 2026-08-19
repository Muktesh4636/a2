# KNOCK 6

Survive the sixes — or chase a clean pair.

```
knock6/
  frontend/
  backend/
```

## Rules

- Two cards (A–6)
- Any **6** → knocked (lose)
- **Clear** — no sixes · pays **2×**
- **Pair Clear** — no sixes + matching ranks · pays **4×**

## Run

```bash
cd backend
source .venv/bin/activate
python manage.py migrate
python manage.py runserver 8030
```

Open [http://127.0.0.1:8030/](http://127.0.0.1:8030/)
