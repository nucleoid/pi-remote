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

`@nucleoid/pi-remote-daemon` uses `better-sqlite3` 12.x, whose declared engine/prebuild matrix includes Node 22 on Linux and Windows. Its lifecycle tests run on both operating systems. The `./client` export must remain free of eager native SQLite imports.

`@nucleoid/pi-remote-protocol`, `@nucleoid/pi-remote-daemon`, and `@pragmaticcoder/pi-remote-control` are independently publishable. Package semver is independent from negotiated wire protocol versions. Pack tests must include every extension runtime module, retain root `pi.extensions: ["./pi-extension/remote-control/index.ts"]`, and resolve protocol/daemon from production dependencies rather than unpublished `workspace:*` specs.

## End-to-end local testing

Use trusted local networking only. For USB-connected devices, ADB reverse is useful:

```bash
adb reverse tcp:37891 tcp:37891
```

Then pair with `127.0.0.1:37891` from Android. Bridge integration tests cover two isolated processes, scoped v2 pairing, daemon restart/resume, and idle `agent_settled` projection. Do not modify `app/src/main/**` for bridge-only changes.

## Release signing

Release keystores and passwords must stay outside git. Local release builds can use `local.properties`; CI release builds use protected GitHub Actions secrets.

Never commit:

- `.jks`, `.keystore`, `.p12`, `.pfx`
- passwords
- `local.properties`
- token-bearing deep links or QR images

## Screenshots

Screenshots in `docs/screenshots/` must be captured from the real Android app and use demo-safe data only. Do not hand-draw UI mockups that drift from the app layout.
