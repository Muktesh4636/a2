# Snake

Bet, roll **two dice**, and move the blue marker clockwise from Play — like Ludo. Land on a multiplier for that payout, or hit a **snake** and lose the bet.

**Payout** = bet × landed multiplier (₹)

## Layout

```
snake/
├── frontend/   # React + Vite → :5176
├── backend/    # Django API → :8003
└── images/
```

## Run

```bash
cd backend
source .venv/bin/activate
python manage.py migrate
python manage.py runserver 8003

cd frontend
npm install
npm run dev
```

Open http://localhost:5176
