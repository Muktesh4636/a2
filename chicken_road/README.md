# Chicken Road

Monorepo with a React frontend and Django backend.

```
chicken_road/
  frontend/   # React + Vite + Pixi game UI
  backend/    # Django REST API
```

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs on Vite (usually `http://localhost:5173`).

## Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 8000
```

API: `http://127.0.0.1:8000/api/`

See [frontend/README.md](frontend/README.md) and [backend/README.md](backend/README.md) for details.
