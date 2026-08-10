# Plinko

Physics-based Plinko game with a separate frontend, backend, and images folders.

```
plinko/
├── frontend/   # Vite + JS game UI
├── backend/    # Django REST API
└── images/     # Reference / design images
```

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## Backend (Django)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 8000
```

See [backend/README.md](./backend/README.md) for API docs.

## Images

Reference screenshots live in [`images/`](./images).

## How to play

1. Set your **Bet Amount** (₹).
2. Choose **Risk** (Low / Medium / High) and **Rows** (8–16).
3. Click **Bet** — an orange ball drops and bounces through the pegs.
4. The box it hits multiplies your bet.
