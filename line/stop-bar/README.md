# Stop Bar — horizontal marker bet (INR)

Sample-3 style: marker races along a colored bar; land on a color to win.

## Run

```bash
# API :8002
cd stop-bar/backend
source .venv/bin/activate
python manage.py runserver 8002

# UI :5175
cd stop-bar
npm run dev
```

- UI: http://127.0.0.1:5175  
- API: http://127.0.0.1:8002  

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/config/` | Zones + bet limits |
| POST | `/api/session/` | New player ₹1000 |
| GET | `/api/session/<id>/` | Balance |
| POST | `/api/play/` | Bet → colored zone only |
