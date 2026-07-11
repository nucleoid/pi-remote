# π Remote

[![CI](https://github.com/nucleoid/pi-remote/actions/workflows/ci.yml/badge.svg)](https://github.com/nucleoid/pi-remote/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@pragmaticcoder/pi-remote-control.svg)](https://www.npmjs.com/package/@pragmaticcoder/pi-remote-control)
[![GitHub Release](https://img.shields.io/github/v/release/nucleoid/pi-remote)](https://github.com/nucleoid/pi-remote/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**π Remote** is an Android companion app plus Pi extension for controlling an existing, visible [Pi](https://github.com/earendil-works/pi-coding-agent) TUI session from your phone.

It is a developer tool, **not a hardened public service**. Do not expose the WebSocket port to the public internet.

## First public release

π Remote is now available as an early public release for developers who want to monitor and steer an existing Pi TUI session from Android. The Pi extension is published as `@pragmaticcoder/pi-remote-control`, and the Android app is distributed as a signed APK on GitHub Releases.

This release is intended for trusted personal networks, VPNs, and local tunnels. Please read the security model before pairing a phone with a Pi session.

## Quick start

1. Install the Pi extension:

   ```bash
   pi install npm:@pragmaticcoder/pi-remote-control
   ```

2. Start Pi in TUI mode on your computer.
3. Run `/remote-control-qr` in Pi and scan the QR code from Android.
4. Install the signed APK from the latest GitHub Release.

See [docs/INSTALL.md](docs/INSTALL.md) for detailed install and verification steps.

## Install

### Pi extension

Primary npm / Pi package catalog path:

```bash
pi install npm:@pragmaticcoder/pi-remote-control
```

Git/local install paths:

```bash
pi install git:github.com/nucleoid/pi-remote
pi install ./pi-extension/remote-control
```

### Android app

Install the signed release APK from the latest GitHub Release. Verify `app-release.apk` against the release SHA-256 or `SHA256SUMS.txt` asset when available:

```bash
sha256sum app-release.apk
```

Google Play Protect may warn that it has not seen this developer before. That is expected for a new GitHub-distributed APK that is not distributed through Google Play. Only install APKs from the official GitHub Releases page.

If no release APK is available for your platform yet, build from source:

```bash
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Play Store and F-Droid distribution are not available yet.

## Security model

Read [SECURITY.md](SECURITY.md) and [docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md) before using π Remote.

- Use LAN, Tailscale, WireGuard, localhost, or an SSH tunnel.
- Do **not** router-port-forward or publicly expose the WebSocket port.
- The protocol uses cleartext `ws://` intentionally for LAN/VPN/tunnel use; protect the transport with your network.
- Treat tokens, QR codes, and `pi-remote://` deep links as secrets.
- Run `/remote-control-rotate-token` if pairing material leaks.
- Android stores connection settings in encrypted preferences and disables Android backups.

## Pairing and commands

In Pi TUI mode:

```text
/remote-control
```

This safe status output redacts token-bearing URLs by default. Use explicit pairing commands only when you are ready to show secret material:

```text
/remote-control-qr
/remote-control-android
```

Management commands:

```text
/remote-control-rotate-token
/remote-control-disable
/remote-control-enable
```

## Configuration

`~/.pi/agent/remote-control.json`:

```json
{
  "enabled": true,
  "host": "0.0.0.0",
  "port": 37891,
  "allowNoAuthFromLoopback": false,
  "maxClients": 3,
  "failedAuthLimit": 8,
  "failedAuthWindowMs": 60000,
  "token": "generated-secret"
}
```

`allowNoAuthFromLoopback` defaults to `false`, is warned when enabled, and never applies to LAN/Tailscale/public addresses.

## Durable local daemon

`@nucleoid/pi-remote-daemon` provides the profile-scoped durable control plane for the v3 protocol while retaining Android's protocol-v2 root socket. It is inert until explicitly started; the current extension remains the default until daemon integration lands.

```bash
npx pi-remote-daemon ensure
npx pi-remote-daemon status
npx pi-remote-daemon stop
```

Daemon state is under `~/.pi/agent/pi-remote/`. Fresh profiles bind only to `127.0.0.1`; existing deliberate host, port, token, and v2 loopback settings are imported narrowly. Do not run the old extension listener and daemon on the same configured port.

## Pi package catalog

The Pi extension is published to npm as `@pragmaticcoder/pi-remote-control` with the `pi-package` keyword and Pi package manifest metadata. After the repository is public, it should be discoverable through [pi.dev/packages](https://pi.dev/packages).

## More docs

- [Install guide](docs/INSTALL.md)
- [Security model](docs/SECURITY-MODEL.md)
- [Networking recipes](docs/NETWORKING.md)
- [Development guide](docs/DEVELOPMENT.md)
- [Support](SUPPORT.md)
- [Changelog](CHANGELOG.md)

## Compatibility

| Component | Requirement |
| --- | --- |
| Pi | Current Pi coding agent with extension support |
| Android | min SDK 26 / Android 8.0+ |
| Node/npm | Node 22 recommended for extension development |

## Known limitations

- GitHub Releases are the Android distribution path for now; Play Store and F-Droid distribution are not available yet.
- The protocol intentionally uses cleartext `ws://` for trusted LAN/VPN/tunnel use rather than internet-facing TLS.
- π Remote controls an existing visible Pi TUI session; it is not a hosted/headless Pi service.

## Troubleshooting

- Cannot connect: confirm Pi is in TUI mode, the extension is enabled, and host/port match.
- LAN vs Tailscale confusion: use the laptop's LAN IP on LAN, or its Tailscale IP/name over Tailscale.
- Token mismatch: re-pair or rotate with `/remote-control-rotate-token`.
- Firewall: allow the configured port on trusted LAN/VPN only.
- Multiple legacy sessions: each Pi TUI may use a different port if the default is busy. The durable daemon intentionally uses one profile port and never falls back to another port.

## Uninstall

```bash
pi uninstall @pragmaticcoder/pi-remote-control
adb uninstall com.pragmaticcoder.piremote
```

## Screenshot gallery

All screenshots use demo-safe data only.

| Composer with image | Header menu | Settings |
| --- | --- | --- |
| <img src="docs/screenshots/composer-attachment.png" alt="Composer with attached image" width="220" /> | <img src="docs/screenshots/menu.png" alt="Header menu" width="220" /> | <img src="docs/screenshots/settings.png" alt="Settings screen" width="220" /> |

| Session scan | Session picker | Waiting state |
| --- | --- | --- |
| <img src="docs/screenshots/sessions-loading.png" alt="Scanning sessions" width="220" /> | <img src="docs/screenshots/sessions.png" alt="Session picker" width="220" /> | <img src="docs/screenshots/main.png" alt="Waiting state" width="220" /> |

## Development

```bash
./gradlew test assembleDebug
cd pi-extension/remote-control && npm test && npm run typecheck && npm pack --dry-run
```

Release APKs are signed with keystore/passwords supplied outside git through `local.properties` or protected GitHub Actions secrets.
