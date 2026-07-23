# Roultee Native (Kotlin + Compose + Filament)

Native Android port of the web Speed Auto Roulette experience.

## Modules

- `:app` — launcher activity
- `:core:game` — pure Kotlin wheel physics, betting rules, camera zoom (ported from `frontend/app.js`)
- `:rendering:filament` — Google Filament procedural wheel + frame loop
- `:feature:roulette` — Jetpack Compose betting UI / ViewModel

## Build

```bash
cd android-native
./gradlew :core:game:test
./gradlew :app:assembleDebug
```

Requires Android SDK (`local.properties` → `sdk.dir`) and JDK 17.

## Parity notes

- European `WHEEL_ORDER` and ball phases match the web simulator.
- Betting board, chip tiers, undo/double, result banner, and win rings mirror the web UI.
- Filament wheel uses procedural geometry with the same radii as Three.js; a glTF asset can replace it later.
