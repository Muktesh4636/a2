# TEEN PATTI — vs Dealer

Ante → see your three cards → **Play** (match ante) or **Fold**.

Dealer must qualify with **Queen high or better**. Full 52-card deck.

| Port | URL |
|------|-----|
| 8080 | http://127.0.0.1:8080/ |

```bash
cd backend
createdb teenpatti   # once
.venv/bin/python manage.py migrate
.venv/bin/python manage.py runserver 8080
```
