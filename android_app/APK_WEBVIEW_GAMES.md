# APK WebView games (same as roulette / trading / chicken / vortex)

## Behaviour

Tapping **Gundu Ata** in the app opens `GameWebViewActivity` with the casino lobby:

```
https://gunduata.tech/casino/?token=<JWT>&refresh=<JWT>
```

From the lobby, every tile opens its web game with `?token=` (Gundu Ata WebGL, trading, roulette, chicken road, vortex, …).

## AndroidBridge

Injected as `window.AndroidBridge`:

| Method | Purpose |
|--------|---------|
| `goBack()` | WebView history / casino / app home |
| `openGame(id, url)` | Load game URL (token appended if missing) |
| `openDeposit(url?)` | Open deposit page |

## Key files

- `app/.../ui/GameWebViewActivity.kt`
- `app/.../navigation/AppNavigation.kt` → `executeGameLaunch()`
- `app/.../utils/Constants.kt` → `WEB_ORIGIN`, `CASINO_PATH`, `GUNDU_ATA_PATH`

Native Unity (`UnityPlayerGameActivity`) remains in the APK but is no longer launched from home.
