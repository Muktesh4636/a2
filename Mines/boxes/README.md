# Boxes

Pick **4 boxes**, place a bet, then reveal ratios across the board. Your payout is:

**bet × (sum of the 4 selected ratios)**

Amounts are in **₹ (INR)**.

## Layout

```
boxes/
├── frontend/     # React + Vite (port 5175)
├── backend/      # Django API (port 8002)
└── images/       # Reference screenshots
```

## Run

```bash
# Backend
cd backend
source .venv/bin/activate
python manage.py migrate
python manage.py runserver 8002

# Frontend
cd frontend
npm install
npm run dev
```

Open http://localhost:5175
