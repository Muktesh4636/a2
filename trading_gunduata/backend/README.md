# Trading Game — Django Backend

REST API + WebSocket backend for the Grow More trading game.

## Tech stack
| Layer | Library |
|-------|---------|
| Framework | Django 6 |
| REST API | Django REST Framework |
| WebSockets | Django Channels (in-memory layer) |
| ASGI server | Daphne |
| DB | SQLite (dev) |

## Quick start

```bash
cd backend
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser   # optional admin user
daphne -b 0.0.0.0 -p 8000 trading_backend.asgi:application
```

Admin panel → http://localhost:8000/admin/

## REST API

Base URL: `http://localhost:8000/api/`

All endpoints except auth require `Authorization: Token <token>` header.

### Auth
| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| POST | `auth/register/` | `{username, password, email}` | Register + get token |
| POST | `auth/login/` | `{username, password}` | Login + get token |
| POST | `auth/logout/` | — | Invalidate token |
| GET | `auth/me/` | — | Current user + wallet |

### Wallet
| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| GET | `wallet/` | — | Balance |
| POST | `wallet/deposit/` | `{amount}` | Add demo credits |

### Rounds
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `rounds/current/` | Active betting/trading round |
| GET | `rounds/history/` | Last 20 settled rounds |
| POST | `rounds/settle/` | **Staff only** — settle round `{final_pct}` |

### Bets
| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| POST | `bets/place/` | `{side, stake}` | Place UP or DOWN bet |
| POST | `bets/cashout/` | `{live_pct}` | Cash out mid-round (3% fee) |
| GET | `bets/my/` | — | My bet history |

### Other
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `transactions/` | My transaction history |
| GET | `leaderboard/` | Top 20 by balance |

## WebSocket

Connect to `ws://localhost:8000/ws/round/` to receive live round state.

**Messages received:**
```json
// On connect and phase change
{ "type": "round_state", "round": { ...RoundSerializer... }, "ms_left": 4200 }

// Live price ticks (sent by game loop)
{ "type": "round_tick", "live_pct": 12.4, "ms_left": 3100 }
```
