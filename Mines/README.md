# Games

```
.
├── mines/    # Mines
├── steps/    # Steps
├── boxes/    # Boxes
├── snake/    # Snake — dice track like Ludo
├── slide/    # Slide — boxes scroll past a fixed pin
└── cases/    # Cases — chests open to show multiplier
```

| Game  | Frontend | API   |
|-------|----------|-------|
| Mines | :5173    | :8000 |
| Steps | :5174    | :8001 |
| Boxes | :5175    | :8002 |
| Snake | :5176    | :8003 |
| Slide | :5177    | :8004 |
| Cases | :5178    | :8005 |

```bash
# Cases example
cd cases/backend && source .venv/bin/activate && python manage.py runserver 8005
cd cases/frontend && npm run dev
```
