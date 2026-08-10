# Cases

Bet, watch chests **slide** past a fixed pin. When they stop, the case opens and shows the multiplier — that ratio pays your bet.

**Payout** = bet × opened multiplier (₹)

Includes low opens (e.g. **0.02x**) and a rare **20x**.

| | Port |
|--|--|
| Frontend | :5178 |
| API | :8005 |

```bash
cd cases/backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 8005

cd cases/frontend && npm install && npm run dev
```
