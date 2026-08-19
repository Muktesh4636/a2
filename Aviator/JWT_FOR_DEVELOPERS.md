# Aviator games — JWT for APK / WebView

Same pattern as under-6 / chicken-road / line games.

## Demo JWT (user: `aviator_demo` / `AviatorDemo@123`)

Access:

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIiwiZXhwIjoxNzg3MDQ5NzI0LCJpYXQiOjE3ODY5NjMzMjQsImp0aSI6IjlkNDgxYTQzODhjZDRiZGU4Yjg0OGEzZGFkMThiZTE3IiwidXNlcl9pZCI6MTA4fQ.i2CR6XVPORY5g4rqCrkFSvd5frkpJUDMwi4wM2gnv_0
```

Refresh:

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbl90eXBlIjoicmVmcmVzaCIsImV4cCI6MTc4OTU1NTMyNCwiaWF0IjoxNzg2OTYzMzI0LCJqdGkiOiI0OGYyODlkMTg4Yjk0ODkyOTNhMmQ2YzdhMzEyMWY5MCIsInVzZXJfaWQiOjEwOH0.fmbGF0xS80WwFRdDanRUduAICslmRS3Mkl6iD3vyoEo
```

## Casino lobby

```
https://gunduata.tech/casino/?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIiwiZXhwIjoxNzg3MDQ5NzI0LCJpYXQiOjE3ODY5NjMzMjQsImp0aSI6IjlkNDgxYTQzODhjZDRiZGU4Yjg0OGEzZGFkMThiZTE3IiwidXNlcl9pZCI6MTA4fQ.i2CR6XVPORY5g4rqCrkFSvd5frkpJUDMwi4wM2gnv_0
```

Tiles use each game’s `public/casino-cover.png` from the Aviator folder.

| Game | Path | Cover |
|------|------|-------|
| Aviator | `/aviator/` | `Aviator/aviator/public/casino-cover.png` |
| Jet | `/jet/` | `Aviator/jet/public/casino-cover.png` |
| Maestro | `/maestro/` | `Aviator/maestro/public/casino-cover.png` |
| Deep Dive | `/deep-dive/` | `Aviator/deep-dive/public/casino-cover.png` |
| Sky Lift | `/sky-lift/` | `Aviator/sky-lift/public/casino-cover.png` |
| Paper Plane | `/paper-plane/` | `Aviator/paper-plane/public/casino-cover.png` |
| UFO Lift | `/ufo-lift/` | `Aviator/ufo-lift/public/casino-cover.png` |
| Shark Bite | `/shark-bite/` | `Aviator/wave-surf/public/casino-cover.png` |

Shark Bite = Aviator `wave-surf` (path `/shark-bite/` so it does not clash with Line `/wave-surf/`).
