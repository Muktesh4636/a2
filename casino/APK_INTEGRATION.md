# Casino Games lobby — APK / WebView

## URL for developers

```
https://gunduata.tech/casino/?token=<JWT_ACCESS_TOKEN>
```

Same JWT pattern as the other web games.

## Android APK

The Gundu Ata app opens this lobby in `GameWebViewActivity` (not native Unity).

```
https://gunduata.tech/casino/?token=<JWT>&refresh=<JWT>
```

See `android_app/APK_WEBVIEW_GAMES.md`.

## Behaviour

1. 2-column grid of separate game tile images
2. Tap a tile → **Play** overlay on that tile
3. Tap **Play** → opens that **web game** with `?token=` appended
4. Tap outside → clears Play
5. Back → `AndroidBridge.goBack()` if present, else `history.back()`

## Game links (all web)

| Tile | Web URL |
|------|---------|
| Gundu Ata | `https://gunduata.tech/game/?token=` |
| Stock Market | `https://gunduata.tech/trading/?token=` |
| Auto Roulette | `https://gunduata.tech/roulette/?token=` |
| Chicken Road | `https://gunduata.tech/chicken-road/?token=` |
| Chicken Road 2 | `https://gunduata.tech/chicken-road-2/?token=` |
| Vortex | `https://gunduata.tech/vortex/?token=` |
| Vortex 1 | `https://gunduata.tech/vortex-1/?token=` |
| VIP Vortex | `https://gunduata.tech/vip-vortex/?token=` |
| Mines | `https://gunduata.tech/mines/?token=` |
| Steps | `https://gunduata.tech/steps/?token=` |
| Boxes | `https://gunduata.tech/boxes/?token=` |
| Snake | `https://gunduata.tech/snake/?token=` |
| Slide | `https://gunduata.tech/slide/?token=` |
| Vault | `https://gunduata.tech/cases/?token=` |
| Drop | `https://gunduata.tech/drop/?token=` |
| Plinko | `https://gunduata.tech/plinko/?token=` |
| Air Balloon | `https://gunduata.tech/air-balloon/?token=` |
| Chit Pat | `https://gunduata.tech/chit-pat/?token=` *(native Kotlin — open Activity)* |
| Rangu | `https://gunduata.tech/rangu/?token=` *(native Kotlin / colour API)* |
| Circle Bet | `https://gunduata.tech/circle-game/?token=` |
| Stop Bar | `https://gunduata.tech/stop-bar/?token=` |
| Spin Dial | `https://gunduata.tech/spin-dial/?token=` |
| Mines Path | `https://gunduata.tech/mines-path/?token=` |
| Dice Over Under | `https://gunduata.tech/dice-over-under/?token=` |
| Color Match | `https://gunduata.tech/color-match/?token=` |
| Wheel Pockets | `https://gunduata.tech/wheel-pockets/?token=` |
| Wave Surf | `https://gunduata.tech/wave-surf/?token=` |
| Keno Pick | `https://gunduata.tech/keno-pick/?token=` |
| Hi-Lo Cards | `https://gunduata.tech/hi-lo-cards/?token=` |

## Line games — JWT for app developers

Same pattern as Chicken Road / Roulette / Stock Market:

```
https://gunduata.tech/casino/?token=<JWT_ACCESS_TOKEN>&refresh=<JWT_REFRESH>
```

Lobby tiles open each Line game with `?token=` appended. Direct deep links:

```
https://gunduata.tech/circle-game/?token=<JWT_ACCESS_TOKEN>
https://gunduata.tech/wave-surf/?token=<JWT_ACCESS_TOKEN>
# …same for stop-bar, spin-dial, mines-path, dice-over-under,
#    color-match, wheel-pockets, keno-pick, hi-lo-cards
```

The game UI stores the token and sends `Authorization: Bearer <JWT>` on API calls.

## Adding more games

1. Drop PNG into `images/`
2. Append entry in `games.js`
3. Redeploy
