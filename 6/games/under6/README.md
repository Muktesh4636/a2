# UNDER 6

Self-contained card game:

```
under6/
  frontend/   # UI
  backend/    # Django API + server
```

## Run

```bash
cd backend
source .venv/bin/activate   # first time: python3 -m venv .venv && pip install -r requirements.txt && python manage.py migrate
python manage.py runserver 8010
```

Open [http://127.0.0.1:8010/](http://127.0.0.1:8010/)
