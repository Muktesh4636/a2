# Frontend

Speed Auto Roulette web client (Three.js wheel + betting board).

## Run

```bash
cd frontend
python3 -m http.server 8765 --bind 127.0.0.1
```

Open http://127.0.0.1:8765/ — the Django API should be on http://127.0.0.1:8000 (see `../backend/README.md`).

## Sync into Android WebView assets

```bash
rsync -a --delete \
  --exclude README.md \
  ./ \
  ../android-native/app-web/src/main/assets/web/
```

Keep `vendor/` in the Android assets tree if the offline APK uses local Three.js instead of the CDN import map.
