# π Remote security model

π Remote is a developer convenience tool for trusted networks. It is not an internet-facing service.

## What the Android app can see

An authenticated Android client can receive session state, working/idle status, current directory, model/session metadata, chat output, tool events, and errors. It can send prompts, steering messages, follow-ups, attachments, and abort requests.

## Authentication

The Pi extension generates a bearer token and stores it in `~/.pi/agent/remote-control.json`. Treat the token, QR code, and `pi-remote://` deep links as secrets.

Rotate a token after any suspected leak:

```text
/remote-control-rotate-token
```

## Transport

The WebSocket transport is cleartext `ws://` by design for LAN, VPN, localhost, and SSH tunnel use. Use a trusted network path:

- LAN you control
- Tailscale
- WireGuard
- localhost / ADB reverse
- SSH tunnel

Do not port-forward the WebSocket port or expose it directly to the public internet.

## Android storage

The Android app stores connection settings in encrypted preferences and disables Android backup so pairing material is not copied to cloud/device backups.

## Loopback no-auth mode

`allowNoAuthFromLoopback` defaults to `false`. If enabled, it applies only to loopback addresses and is called out in status output. Keep it disabled except for local testing.

## Screenshot/log hygiene

Before sharing screenshots or logs, remove:

- tokens and QR codes
- `pi-remote://` deep links
- private usernames and paths
- private project names
- private session history
- customer or proprietary data
