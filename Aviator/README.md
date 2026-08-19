# Aviator demos

Each game is self-contained: frontend + Django backend in the same folder.

```
Aviator/
  aviator/      # Plane — UI :5173 · API :8001
  maestro/      # Parrot — UI :5174 · API :8003
  jet/          # Jet — UI :5175 · API :8002
  deep-dive/    # Submarine — UI :5176 · API :8004
  sky-lift/     # Balloon — UI :5177 · API :8005
  paper-plane/  # Paper plane — UI :5178 · API :8006
  ufo-lift/     # UFO — UI :5179 · API :8007
  wave-surf/    # Shark Bite — UI :5180 · API :8008
```

Same crash UI layout for every game (history, stage, dual bets, cashout). Only theme art / colors change.

## Ports

| Game        | Frontend              | Backend API           |
|-------------|-----------------------|-----------------------|
| Aviator     | http://127.0.0.1:5173 | http://127.0.0.1:8001 |
| Jet         | http://127.0.0.1:5175 | http://127.0.0.1:8002 |
| Maestro     | http://127.0.0.1:5174 | http://127.0.0.1:8003 |
| Deep Dive   | http://127.0.0.1:5176 | http://127.0.0.1:8004 |
| Sky Lift    | http://127.0.0.1:5177 | http://127.0.0.1:8005 |
| Paper Plane | http://127.0.0.1:5178 | http://127.0.0.1:8006 |
| UFO Lift    | http://127.0.0.1:5179 | http://127.0.0.1:8007 |
| Shark Bite  | http://127.0.0.1:5180 | http://127.0.0.1:8008 |

## Run any game

```bash
# backend (example: Paper Plane)
cd paper-plane/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 8006

# frontend
cd paper-plane
npm install   # or: ln -s ../jet/node_modules node_modules
npm run dev
```

## API (same on every backend)

- `GET  /api/bootstrap/`
- `POST /api/bet/`
- `POST /api/round/start/`
- `POST /api/cashout/`
- `POST /api/round/crash/`
- `POST /api/round/new/`

Auth: `X-Player-Token` (localStorage per game). Offline → local demo mode.

## Notes

- Demo play money only — not connected to any casino.
