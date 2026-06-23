# @nucleoid/pi-remote-control

Pi extension for pairing the π Remote Android app with an active Pi TUI session.

## Install

```bash
pi install npm:@nucleoid/pi-remote-control
```

From this repository:

```bash
pi install ./pi-extension/remote-control
pi install git:github.com/nucleoid/pi-remote
```

## Commands

- `/remote-control` — safe status only; token-bearing URLs are redacted.
- `/remote-control-qr` — explicit pairing command that shows a warning plus QR/deep link.
- `/remote-control-android` — explicit pairing command that opens a token-bearing deep link through adb.
- `/remote-control-rotate-token` — rotates the bearer token and disconnects existing clients.
- `/remote-control-disable` — disables and stops the server.
- `/remote-control-enable` — re-enables the server for TUI sessions.

## Security

Do not expose the WebSocket port to the public internet. Use LAN, Tailscale/WireGuard, localhost, or SSH tunnels. `ws://` is cleartext by design for LAN/VPN use, so protect the network path. Treat tokens, QR codes, and `pi-remote://` links as secrets and rotate the token after any leak.

Configuration is stored at `~/.pi/agent/remote-control.json` with best-effort restrictive permissions. `allowNoAuthFromLoopback` defaults to `false`; if enabled it is warned in status and applies only to loopback addresses.

## Config

```json
{
  "enabled": true,
  "host": "127.0.0.1",
  "port": 37891,
  "token": "generated-secret",
  "allowNoAuthFromLoopback": false,
  "maxClients": 3,
  "failedAuthLimit": 8,
  "failedAuthWindowMs": 60000
}
```
