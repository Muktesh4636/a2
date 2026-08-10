# Slide

Bet, watch multiplier boxes **slide** past a fixed pin, and get paid the ratio under the pin when they stop.

**Payout** = bet × landed multiplier (₹)

Includes a rare **20x** box.

| | Port |
|--|--|
| Frontend | :5177 |
| API | :8004 |

```bash
cd slide/backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 8004

cd slide/frontend && npm install && npm run dev
```
