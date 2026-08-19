# Card games

```
games/
  rushbet/
  knock6/
  tripleedge/
  mirror/
  goldlane/
  dead7/
  teenpatti/
  .venv/          # shared Python env (symlinked from each backend)
```

All backends use **PostgreSQL** (not SQLite). Each game has its own database:

`rushbet`, `knock6`, `tripleedge`, `mirror`, `goldlane`, `dead7`, `teenpatti`

Override with env vars if needed: `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST`, `POSTGRES_PORT`.

| Game | Port | URL |
|------|------|-----|
| RUSH BET | 8020 | http://127.0.0.1:8020/ |
| KNOCK 6 | 8030 | http://127.0.0.1:8030/ |
| TRIPLE EDGE | 8040 | http://127.0.0.1:8040/ |
| MIRROR | 8050 | http://127.0.0.1:8050/ |
| GOLD LANE | 8060 | http://127.0.0.1:8060/ |
| DEAD 7 | 8070 | http://127.0.0.1:8070/ |
| TEEN PATTI | 8080 | http://127.0.0.1:8080/ |
