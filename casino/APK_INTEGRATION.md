# Casino Games lobby — APK / WebView

## URL for developers

```
https://gunduata.tech/casino/?token=<JWT_ACCESS_TOKEN>
```

Same JWT pattern as the other web games.

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
| Chit Pat | `https://gunduata.tech/chit-pat/?token=` |
| Rangu | `https://gunduata.tech/rangu/?token=` |

## Adding more games

1. Drop PNG into `images/`
2. Append entry in `games.js`
3. Redeploy
