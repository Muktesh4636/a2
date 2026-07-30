# Vortex — APK / WebView integration

Same pattern as Roulette, Trading, Chicken Road 2.

## Game URL (give to developers)

```
https://gunduata.tech/vortex/?token=<JWT_ACCESS_TOKEN>
```

Open this in the app WebView after login. Pass the same JWT used for other games.

## Auth

- Query: `?token=` (also accepts `access_token` / `accessToken` / `access`)
- Token is stored in `localStorage` as `gundu_access_token`
- All API calls send `Authorization: Bearer <token>`

## Wallet APIs

Base: `https://gunduata.tech/api/vortex/`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/state/` | Balance, bet, ring fills, payouts |
| POST | `/bet/` | `{ "bet": 10 }` — stake ₹10–₹500 |
| POST | `/spin/` | Deduct bet, roll symbol, update rings |
| POST | `/cashout/` | Cash out full ring progress |
| POST | `/part/` | Part payout (rings with ≥2 sectors) |

Currency is **integer INR** (Gundu Wallet). Min bet **₹10**, max **₹500**, step **₹10**.

## Example

```
https://gunduata.tech/vortex/?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```
