# Sports (Cricket / Football / Tennis) — APK WebView Integration

Give this document to the Android app developer.  
Integrate **the same way as Roulette and Stock Market (Trading)**: open a **WebView** to our hosted sports UI, inject the logged-in user’s JWT, and the page will show **their real wallet balance**.

---

## 1. What to open in the WebView (same pattern as roulette / trading)

| Game | WebView URL |
|------|-------------|
| **Sports hub (main)** | `https://gunduata.tech/sports/` |
| Cricket list + match UI | `https://gunduata.tech/cricket/` |
| Football / Tennis match detail | `https://gunduata.tech/sports/match/?sport=soccer&event_id=<ID>` |
| Tennis match detail | `https://gunduata.tech/sports/match/?sport=tennis&event_id=<ID>` |
| Roulette (existing) | `https://gunduata.tech/roulette/` |
| Trading / stock (existing) | `https://gunduata.tech/trading/` |

**Recommended entry point for the Sports icon in the app:**

```text
https://gunduata.tech/sports/
```

Optional query params (same as Virtual / Roulette):

```text
https://gunduata.tech/sports/?accessToken=<JWT>&refreshToken=<REFRESH>
```

Or JSON auth blob (same as Kokoroko Virtual WebView):

```text
https://gunduata.tech/sports/?auth={"accessToken":"<JWT>","refreshToken":"<REFRESH>"}
```

Deep links:

```text
https://gunduata.tech/sports/?sport=cricket
https://gunduata.tech/sports/?sport=soccer
https://gunduata.tech/sports/?sport=tennis
https://gunduata.tech/sports/?sport=soccer&mode=upcoming
https://gunduata.tech/cricket/?view=match&event_id=43742985&pre=0
```

---

## 2. Auth + balance (must do this — same as roulette)

### App side (Kotlin WebView)

Reuse the existing `GunduataAuthWebViewClient` pattern already used for Virtual / web games:

1. Enable `javaScriptEnabled = true` and `domStorageEnabled = true`
2. On page load, inject into `localStorage`:
   - `accessToken` / `access_token` / `gundu_access_token`
   - `refreshToken` / `refresh_token`
   - `auth` = `{"accessToken":"...","refreshToken":"..."}`
3. Optionally also pass tokens in the URL query (see above)
4. Optionally set request header: `Authorization: Bearer <accessToken>`

Example load URL builder (mirror Virtual):

```kotlin
val url = Uri.parse("https://gunduata.tech/sports/").buildUpon()
    .appendQueryParameter("accessToken", accessToken)
    .appendQueryParameter("refreshToken", refreshToken)
    .appendQueryParameter(
        "auth",
        JSONObject()
            .put("accessToken", accessToken)
            .put("refreshToken", refreshToken)
            .toString()
    )
    .build()
    .toString()
```

### Web side (already implemented)

Sports pages read the token from query / `localStorage`, then call:

```http
GET https://gunduata.tech/api/auth/wallet/
Authorization: Bearer <accessToken>
Accept: application/json
```

and show the user’s **₹ balance** in the top-right wallet pill.

Same wallet API the Kokoroko app already uses (`AUTH_WALLET_URL`).

---

## 3. Public data APIs (no auth required for browsing odds)

Base: `https://gunduata.tech`

### Sports hub lists

| Sport | Live list | Upcoming list |
|-------|-----------|---------------|
| Cricket | `GET /api/cricket/live-events/` | `GET /api/cricket/pre-events/` |
| Football | `GET /api/soccer/live-matches/` | `GET /api/soccer/upcoming/` |
| Tennis | `GET /api/tennis/live-matches/` | `GET /api/tennis/upcoming/` |

### Match detail

| Sport | Detail |
|-------|--------|
| Cricket live | `GET /api/cricket/live-odds/?event_id=<ID>` |
| Cricket pre-match | `GET /api/cricket/preevent-odds/?event_id=<ID>` |
| Football | `GET /api/soccer/matches/<ID>/` |
| Tennis | `GET /api/tennis/matches/<ID>/` |

### Team / player logos

```http
GET /api/sports/team-logo/?name=<TeamOrPlayer>&sport=soccer|tennis|cricket&fallback=1
```

- Redirects to crest/photo when found  
- Otherwise returns an SVG avatar  

### Cricket betting (auth required — already on backend)

```http
POST /api/cricket/bet/
Authorization: Bearer <token>
Content-Type: application/json

{
  "event_id": 43742985,
  "market_id": 123,
  "outcome_id": 456,
  "stake": 100
}
```

```http
GET /api/cricket/bets/
Authorization: Bearer <token>
```

> Football / Tennis **betting settle** is not fully productized yet — data + UI for browsing markets are live. Cricket place-bet API exists.

---

## 4. UX already built in the web UI (no app work needed)

On `https://gunduata.tech/sports/`:

- Sticky tabs: **Cricket / Football / Tennis**
- Live / Upcoming toggle
- Infinite scroll (first 6, then +10)
- Phone cache (`localStorage`) so reopening a sport is fast
- Prefetch of other sports in background
- Match detail pages hide bottom nav
- Wallet balance from JWT

App only needs: **WebView + token injection + open URL**.

---

## 5. Suggested app navigation

Add a **Sports** tile/icon next to Roulette / Trading / Casino:

| Tap | Action |
|-----|--------|
| Sports | Open WebView → `https://gunduata.tech/sports/` with JWT |
| Back | `WebView.goBack()` or close overlay (same as Virtual/Roulette) |
| Wallet `+` inside web | Optional: JS bridge to open native deposit, **or** leave as web-only for now |

---

## 6. Checklist for the APK developer

- [ ] Add Sports entry in home / bottom nav / game grid  
- [ ] Open in-app WebView (not external Chrome)  
- [ ] Inject access + refresh tokens (same as Roulette / Trading / Virtual)  
- [ ] Load `https://gunduata.tech/sports/`  
- [ ] Confirm wallet pill shows logged-in user’s ₹ balance  
- [ ] Confirm Cricket / Football / Tennis tabs work  
- [ ] Confirm opening a match shows markets  
- [ ] Handle Android back: WebView history first, then close Sports  

---

## 7. Quick test (without APK)

1. Login in app → copy access JWT  
2. Open in phone browser:

```text
https://gunduata.tech/sports/?accessToken=YOUR_JWT_HERE
```

3. Top-right wallet should show that user’s balance.

---

## 8. Contacts / ownership

- Hosted UI: nginx on `gunduata.tech` → `/sports/`, `/cricket/`, `/sports/match/`  
- APIs: Django `dice_game` backend (`/api/cricket/*`, `/api/soccer/*`, `/api/tennis/*`, `/api/sports/team-logo/`, `/api/auth/wallet/`)  
- Local source templates:  
  - `backend/game/templates/sports/index.html`  
  - `backend/game/templates/sports/match/index.html`  
  - `backend/game/templates/cricket/index.html`  

---

**Bottom line for the developer:** treat Sports like Roulette — WebView to `https://gunduata.tech/sports/` + inject JWT → balance and live sports UI work.
