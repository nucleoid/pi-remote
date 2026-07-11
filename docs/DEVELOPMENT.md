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

## Node workspace checks

The root package remains an installable Pi package and owns the single npm lockfile. Install and run all protocol and extension gates from the repository root:

```bash
npm ci --legacy-peer-deps
npm test
npm run typecheck
npm run build
npm run pack:inspect
```

`@nucleoid/pi-remote-protocol` is publishable independently from the existing `@pragmaticcoder/pi-remote-control` extension. Its npm semver is independent from negotiated wire protocol versions. The root pack inspection must retain `pi.extensions: ["./pi-extension/remote-control/index.ts"]` and include that file.

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
