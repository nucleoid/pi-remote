# Install π Remote

## 1. Install the Pi extension

```bash
pi install npm:@pragmaticcoder/pi-remote-control
```

Alternative source installs:

```bash
pi install git:github.com/nucleoid/pi-remote
pi install ./pi-extension/remote-control
```

## 2. Start Pi in TUI or RPC mode

The extension starts no resources at factory load. On the first enabled TUI/RPC `session_start`, it asynchronously ensures the shared profile daemon and registers that Pi process. JSON and print modes do not start observation resources. RPC stdin/stdout remain untouched.

## 3. Pair Android

In Pi, run:

```text
/remote-control-qr
```

Scan the QR code from the Android app, or use:

```text
/remote-control-android
```

when the phone is connected with USB debugging and `adb` is available.

## 4. Install the Android APK

Download `app-release.apk` from the latest GitHub Release and install it on Android.

Verify the APK checksum before installing when possible:

```bash
sha256sum app-release.apk
```

Compare with the SHA-256 shown in the release notes or `SHA256SUMS.txt` release asset.

## Play Protect

Google Play Protect may warn that it has not seen this developer before. That is expected for a new GitHub-distributed APK that is not distributed through Google Play. Only install APKs from the official GitHub Releases page.

## Upgrade from the per-session listener

Reload stops the old listener before the shared daemon owns the configured port, so Android may reconnect briefly. Existing default-port pairings normally retain host, port, and token. Pairings to a legacy fallback port or a previously non-selected session may need `/remote-control-qr` again. Rotation and disable now apply daemon-wide and can affect other Pi processes.

## Uninstall

```bash
pi remove npm:@pragmaticcoder/pi-remote-control
adb uninstall com.pragmaticcoder.piremote
```
