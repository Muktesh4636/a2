# GALLOP — 3D Horse Race

Vite + Three.js frontend with a Django REST API backend, all in one folder.

```
horse_racing/
  src/           # Three.js race client
  public/        # models & textures
  backend/       # Django API
  index.html
  package.json
```

## Frontend

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py seed_horses
python manage.py runserver
```

API base: `http://127.0.0.1:8000/api/`

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health/` | Health check |
| GET | `/api/horses/` | Active field |
| GET | `/api/races/` | Recent races |
| POST | `/api/races/` | Start a race session |
| POST | `/api/races/:id/finish/` | Save placings & time |
| GET | `/api/leaderboard/` | Fastest finishes |
| — | `/admin/` | Django admin |

Optional: set `VITE_API_URL` (default `http://127.0.0.1:8000/api`).

The client creates a race when you press **Start Race** and posts results when a horse finishes. If the API is down, the race still runs locally.

## Controls

- Horses walk to the start line, then idle
- **Bet** — pick any horse, enter an amount, Place Bet (before the race)
- **Start Race** — begins a 3-lap gallop (bets lock)
- **Race Again** — walk-up, clear bets, race again

Bankroll starts at ₹1,000 and is saved in the browser. Winning pays stake × odds.
