# APK WebView games (same as roulette / trading / chicken / vortex)

## Behaviour

Tapping **Gundu Ata** in the app opens `GameWebViewActivity` with the casino lobby:

```
https://gunduata.tech/casino/?token=<JWT>&refresh=<JWT>
```

From the lobby, every tile opens its web game with `?token=` (Gundu Ata WebGL, trading, roulette, chicken road, vortex, Line games, …).

## Line games (JWT deep links)

Same JWT as roulette / trading / chicken:

```
https://gunduata.tech/circle-game/?token=<JWT>
https://gunduata.tech/stop-bar/?token=<JWT>
https://gunduata.tech/spin-dial/?token=<JWT>
https://gunduata.tech/mines-path/?token=<JWT>
https://gunduata.tech/dice-over-under/?token=<JWT>
https://gunduata.tech/color-match/?token=<JWT>
https://gunduata.tech/wheel-pockets/?token=<JWT>
https://gunduata.tech/wave-surf/?token=<JWT>
https://gunduata.tech/keno-pick/?token=<JWT>
https://gunduata.tech/hi-lo-cards/?token=<JWT>
```

## AndroidBridge

Injected as `window.AndroidBridge`:

| Method | Purpose |
|--------|---------|
| `goBack()` | WebView history / casino / app home |
| `openGame(id, url)` | Load game URL (token appended if missing). **Prefer passing a full URL from the website** — then no APK change is needed for new games. `id` alone falls back to the Kotlin `pathForGameId` map. |
| `openDeposit(url?)` | Open deposit page |

### Adding a new game without an APK update

1. Add the tile in `casino/games.js` (`id`, `title`, `image`, `path`)
2. Deploy the game at that path on the site
3. Lobby already calls `AndroidBridge.openGame(id, fullUrlWithToken)`

Example:

```js
{ id: "new-game", title: "New Game", image: "images/new-game.png", path: "/new-game/" }
// → openGame("new-game", "https://gunduata.tech/new-game/?token=…")
```

## Key files

- `app/.../ui/GameWebViewActivity.kt`
- `app/.../navigation/AppNavigation.kt` → `executeGameLaunch()`
- `app/.../utils/Constants.kt` → `WEB_ORIGIN`, `CASINO_PATH`, `GUNDU_ATA_PATH`
- Website: `casino/games.js`, `casino/app.js`

Native Unity (`UnityPlayerGameActivity`) remains in the APK but is no longer launched from home.
