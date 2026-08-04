# Automatic Deposit — PhonePe transactions

## How it works (production)

1. Admin sets **Deposit profile → Automatic** in Game Admin Profile
2. Copy the **Sync token** shown there into the PhonePe Sync companion app
3. Companion **Server URL** = game host (e.g. `https://gunduata.tech`) — posts to `/api/sync/`
4. Player deposits: app shows a **unique exact amount**; after PhonePe payment, companion syncs Last N txns
5. Django matches amount + UTR and **credits the wallet** automatically

## Local Flask viewer (optional)

```bash
cd automatic_deposit
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open `http://127.0.0.1:5055` on your PC for a local UTR viewer.  
For live auto-credit, point the companion at the **game backend**, not this Flask server.

## Build & install the Android companion

1. Open `android_companion/` in **Android Studio**
2. Build → Build APK(s)
3. Install on the phone (allow unknown sources if needed)
4. In the app:
   - Server URL = `https://gunduata.tech` (or your API host)
   - Paste **Sync token** from Game Admin → Profile
   - Enable **Accessibility → PhonePe Sync**
5. Unlock PhonePe, then tap **Last 3 / Last 5 / Last 10** after a player pays

## Backend APIs

```bash
# Companion sync (same as Flask /api/sync)
curl -X POST -H "X-Sync-Token: YOUR_TOKEN" -H "Content-Type: application/json" \
  -d '{"device_id":"phone1","transactions":[{"amount":"+ ₹499.98","utr":"123456789012","type":"Received from","party":"Player"}]}' \
  "https://gunduata.tech/api/sync/"

# Player (auth): start auto deposit
curl -H "Authorization: Bearer ACCESS" -H "Content-Type: application/json" \
  -d '{"amount":500}' "https://gunduata.tech/api/auth/deposits/auto/initiate/"
```

## Optional: old ADB mode (Flask only)

```bash
ENABLE_ADB=1 python app.py
```
