# 4RAVORTEX2 VIP – Local Demo Recreation

Played the live demo at `https://4rabet365.com/casino/slot/vortex-2-vip?demo=1` and rebuilt the local game around the **real Vortex 2 rules**.

## Project layout

```
VORTEX/
  frontend/     # All UI (HTML, CSS, JS)
  images/       # All game images / symbols
  backend/      # Django API + game logic
```

## Honest limit

This is still **not** TurboGames’ proprietary client. Their game is a PixiJS app on `4ravortex2.turbogames.io`. We cannot ship their exact binary/assets.

What we matched from demo + official guide:

- Demo balance `$1000`, bet `$1`
- DEMO MODE tab
- 3 rings: Water / Earth / Fire with real multipliers
- Symbol drops: Water, Earth, Fire, Wind, Skull, x2
- Sector fill progress + cash out / part payout
- Bonus unlocks (Water / Earth / Fire)
- Center vertical symbol reel

## Run

```bash
cd /Users/pradyumna/VORTEX/backend
python3 -m pip install -r requirements.txt
python3 manage.py migrate
python3 manage.py runserver 8000
```

Open http://127.0.0.1:8000/

Spins, balance, and cashouts are handled by the Python/Django API in `backend/`. Frontend files are served from `frontend/`; images from `images/`.
