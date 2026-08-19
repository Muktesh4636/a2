# VIP Vortex

Luxury VIP table — darker gold design, higher ratios than Vortex 1 & 2.

## Special VIP extras

- Dark gold VIP lounge look (not the light ash UI)
- Gold bronze rings + VIP chip / perks strip
- Start balance **$5000**, default bet **$5**, max bet **$500**
- Higher multipliers — Fire bonus up to **999X**

## Ratios

| Ring | Breaks | Bonus up to |
|------|--------|-------------|
| Water | 2 → 6 → 12 | 25X |
| Earth | 3 → 10 → 22 → 40 → 70 | 100X |
| Fire | 5 → 20 → 45 → 80 → 140 → 250 → 400 | 999X |

## Run

```bash
cd vip-vortex/backend
python3 manage.py migrate
python3 manage.py runserver 8002
```

Open **http://127.0.0.1:8002/**
