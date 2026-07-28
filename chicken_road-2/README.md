# Chicken Road 2 — your frontend

Local site built from your project code. UI matched to the official Chicken Road 2 look (colors, bet bar, official road sprites).

No redirect — this is your `index.html` / `styles.css` / `game.js`.

## Run frontend

```bash
npm start
```

Open **http://localhost:5173**

## Run backend (Django)

API lives in a separate folder: [`backend/`](./backend/).

```bash
cd backend
source .venv/bin/activate
python manage.py migrate
python manage.py runserver 8000
```

See [`backend/README.md`](./backend/README.md) for endpoints.

## Files

| Path | Role |
|------|------|
| `index.html` | Header + bet panel structure |
| `styles.css` | Official measured tokens |
| `game.js` | Canvas stage + play logic |
| `multipliers.js` | Difficulty tables |
| `static/image/` | Official logo, objects, cars, sidewalk, chicken |
| `backend/` | Django REST API (balance, rounds, cash-out) |
