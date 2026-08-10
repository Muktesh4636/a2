# Steps

Climb a 3×9 tower one row at a time. Each row has **2 eggs** (safe) and **1 danger**. Profit rises with every safe step. Cash out anytime — or hit danger and lose the bet. Full routes are revealed after cash-out or bust.

Amounts are in **₹ (INR)**.

## Layout

```
steps/
├── frontend/     # React + Vite UI
├── backend/      # Django API (port 8001)
└── images/       # Reference screenshots
```

## Run

**1. Backend**

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 8001
```

**2. Frontend**

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5174`. API: `http://127.0.0.1:8001/api/`.

## How it works

1. Place a bet.
2. The bottom row lights up green — pick one of three steps.
3. Egg → climb up, multiplier increases. Danger → bust, bet lost.
4. Cash out mid-climb to lock profit; all egg/danger routes are shown.
