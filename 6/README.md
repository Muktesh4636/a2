# Card games

Each game lives in its own folder under `games/`:

```
games/
  under6/          ← this game (frontend + backend)
    frontend/
    backend/
  # next-game/     ← add more games here the same way
```

## Run UNDER 6

```bash
cd games/under6/backend
source .venv/bin/activate
python manage.py runserver 8010
```

Open [http://127.0.0.1:8010/](http://127.0.0.1:8010/)
