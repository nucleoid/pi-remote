# π Remote

**π Remote** is an Android companion app plus Pi extension for controlling an existing, visible [Pi](https://github.com/earendil-works/pi-coding-agent) TUI session from your phone.

It is a developer tool, **not a hardened public service**. Do not expose the WebSocket port to the public internet.

## Install

### Pi extension

Primary catalog path:

```bash
pi install npm:@nucleoid/pi-remote-control
```

Git/local install paths:

```bash
pi install git:github.com/nucleoid/pi-remote
pi install ./pi-extension/remote-control
```

### Android app

Install the signed release APK from the latest GitHub Release. If no release APK is available for your platform yet, build from source:

```bash
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Play Store and F-Droid distribution are not available yet.

## Security model

Read [SECURITY.md](SECURITY.md) before using π Remote.

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

## Compatibility

| Component | Requirement |
| --- | --- |
| Pi | Current Pi coding agent with extension support |
| Android | min SDK 26 / Android 8.0+ |
| Node/npm | Node 22 recommended for extension development |

## Troubleshooting

- Cannot connect: confirm Pi is in TUI mode, the extension is enabled, and host/port match.
- LAN vs Tailscale confusion: use the laptop's LAN IP on LAN, or its Tailscale IP/name over Tailscale.
- Token mismatch: re-pair or rotate with `/remote-control-rotate-token`.
- Firewall: allow the configured port on trusted LAN/VPN only.
- Multiple sessions: each Pi TUI may use a different port if the default is busy.

## Uninstall

```bash
pi uninstall @nucleoid/pi-remote-control
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
