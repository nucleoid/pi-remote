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

## 2. Start Pi in TUI mode

Run Pi normally in a terminal TUI session. π Remote controls an existing, visible Pi session; it is not a headless hosted agent.

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

## Uninstall

```bash
pi remove npm:@pragmaticcoder/pi-remote-control
adb uninstall com.pragmaticcoder.piremote
```
