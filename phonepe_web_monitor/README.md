# PhonePe Web Monitor

Standalone Android software (Kotlin). Separate from `automatic_deposit/`.

## What it does

1. Outer UI is a **WebView** — every screen loads from the web (`/phonepe-monitor/`).
2. Background service checks **PhonePe History every 1 minute**.
3. When it finds **new** credit transactions, it posts them to the game server (`/api/sync/`).
4. Matched amounts credit auto-deposits; all synced UTRs show on the web UI.

## Requirements on the phone

- PhonePe installed and unlocked at least once
- **Accessibility → PhonePe Web Monitor** enabled (so the app can open History)
- Internet + sync token from Game Admin → Profile

## Build

```bash
cd phonepe_web_monitor/android
./gradlew :app:assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```

Open the project in Android Studio if you prefer.

## Setup

1. Install the APK on the payment phone
2. Open the app → web UI loads from `https://gunduata.tech/api/phonepe-monitor/`
3. Paste **Sync token** from Admin Profile → Save
4. Tap **Enable Accessibility** → turn on **PhonePe Web Monitor**
5. Tap **Start 1‑min monitor**

The notification stays while monitoring. New PhonePe credits are pushed to the server automatically.

## Server

- Web UI: `https://gunduata.tech/api/phonepe-monitor/`
- Sync API: `POST /api/sync/` with header `X-Sync-Token`
- UTR log: `GET /api/auto-deposit/utr-log/`
