# Mines

A 5×5 Mines game: pick tiles for diamonds to grow your profit, or hit a bomb and lose the bet. Cash out anytime to lock in winnings. Amounts are in **₹ (INR)**.

## Layout

```
mines/
├── frontend/     # React + Vite UI
├── backend/      # Django API
└── images/       # Reference / asset images
```

## Run

**1. Backend**

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

**2. Frontend**

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The UI talks to `http://127.0.0.1:8000/api/`.

## How it works

1. Set **bet amount** and number of **mines**.
2. Press **Bet** — stake is deducted on the server.
3. Click tiles. Each **diamond** raises the multiplier and profit.
4. **Cash Out** to collect winnings, or hit a **bomb** and lose the bet.
5. Mine positions stay on the backend until the round ends.
