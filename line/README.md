# Line — betting games (INR) · Casino + JWT

All 10 games are wired into the casino lobby (`/casino/`) the same way as
Chicken Road / Roulette / Stock Market: open with `?token=<JWT>`.

## JWT for app developers

**Casino lobby (recommended):**

```
https://gunduata.tech/casino/?token=<JWT_ACCESS_TOKEN>&refresh=<JWT_REFRESH>
```

**Direct game URLs:**

| Game | URL |
|------|-----|
| Circle Bet | `https://gunduata.tech/circle-game/?token=<JWT>` |
| Stop Bar | `https://gunduata.tech/stop-bar/?token=<JWT>` |
| Spin Dial | `https://gunduata.tech/spin-dial/?token=<JWT>` |
| Mines Path | `https://gunduata.tech/mines-path/?token=<JWT>` |
| Dice Over Under | `https://gunduata.tech/dice-over-under/?token=<JWT>` |
| Color Match | `https://gunduata.tech/color-match/?token=<JWT>` |
| Wheel Pockets | `https://gunduata.tech/wheel-pockets/?token=<JWT>` |
| Wave Surf | `https://gunduata.tech/wave-surf/?token=<JWT>` |
| Keno Pick | `https://gunduata.tech/keno-pick/?token=<JWT>` |
| Hi-Lo Cards | `https://gunduata.tech/hi-lo-cards/?token=<JWT>` |

APK `GameWebViewActivity` maps each game `id` → path and appends JWT automatically
via `AndroidBridge.openGame(id, url)`.

## Layout

```
line/
├── circle-game/        wheel            UI :5176  API :8000   prod :8120
├── stop-bar/           sliding bar      UI :5175  API :8002   prod :8121
├── spin-dial/          dial             UI :5177  API :8003   prod :8122
├── mines-path/         mines            UI :5178  API :8004   prod :8123
├── dice-over-under/    over/under       UI :5179  API :8005   prod :8124
├── color-match/        3-reel match     UI :5180  API :8006   prod :8125
├── wheel-pockets/      full wheel       UI :5181  API :8007   prod :8126
├── wave-surf/          crash wave       UI :5182  API :8008   prod :8127
├── keno-pick/          keno             UI :5183  API :8009   prod :8128
└── hi-lo-cards/        hi-lo            UI :5184  API :8010   prod :8129
```

## Local run

```bash
# Example: Wave Surf
cd line/wave-surf/backend && python manage.py runserver 8008
cd line/wave-surf && npm run dev   # http://127.0.0.1:5182/wave-surf/?token=...
```

## Deploy

```bash
chmod +x tools/deploy_line_games.sh
./tools/deploy_line_games.sh
```

Uses `docker-compose.line-games.yml` on the app server and static files + nginx
locations on the LB (same pattern as Mines / Plinko).
