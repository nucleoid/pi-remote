# Development

## Prerequisites

- JDK 17
- Android SDK / `adb`
- Node.js 22+
- npm

If Gradle cannot find Android SDK locally, set `ANDROID_HOME` or create `local.properties` with `sdk.dir=...`.

## Android checks

```bash
./gradlew test assembleDebug
```

Install a debug build:

```bash
./gradlew installDebug
```

## Pi extension checks

```bash
cd pi-extension/remote-control
npm ci --legacy-peer-deps
npm test
npm run typecheck
npm pack --dry-run
```

## End-to-end local testing

Use trusted local networking only. For USB-connected devices, ADB reverse is useful:

```bash
adb reverse tcp:37891 tcp:37891
```

Then pair with `127.0.0.1:37891` from Android.

## Release signing

Release keystores and passwords must stay outside git. Local release builds can use `local.properties`; CI release builds use protected GitHub Actions secrets.

Never commit:

- `.jks`, `.keystore`, `.p12`, `.pfx`
- passwords
- `local.properties`
- token-bearing deep links or QR images

## Screenshots

Screenshots in `docs/screenshots/` must be captured from the real Android app and use demo-safe data only. Do not hand-draw UI mockups that drift from the app layout.
