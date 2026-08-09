# SVS Pay

Separate Android app that shows **all PhonePe transactions** synced to the game server (`AutoDepositTransaction`).

Not the PhonePe monitor — this is only the **ledger / viewer**.

## Folder

```
svs_pay/
  README.md
  android/     ← open in Android Studio
```

## Web UI (loaded in WebView)

https://gunduata.tech/api/svs-pay/

## API

```
GET /api/svs-pay/transactions/?day=today|YYYY-MM-DD|all
Header: X-Sync-Token: <token from Admin Profile>
```

## Build

```bash
cd svs_pay/android
./gradlew :app:assembleDebug
```

Install APK on any phone to view synced credits (Today / All recent).
