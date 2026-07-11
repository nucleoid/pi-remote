# Security Policy

π Remote is a developer convenience tool for controlling an already-visible Pi TUI session. It is not designed to be an internet-facing service.

## Threat model

The Pi extension streams session state, cwd, model/session metadata, messages, tool events, and accepted prompts to authenticated Android clients. Treat the auth token, QR code, and `pi-remote://` deep links as secrets.

## Safe deployment

- Do **not** port-forward or expose the WebSocket port directly to the public internet.
- Prefer Tailscale, WireGuard, localhost, or an SSH tunnel.
- The transport is cleartext `ws://` for LAN/VPN compatibility; protect it with a trusted network or tunnel.
- Rotate the token with `/remote-control-rotate-token` if a QR code, deep link, screenshot, log, or token may have leaked.
- Keep `allowNoAuthFromLoopback` disabled unless you are doing local-only testing. It never applies to non-loopback addresses.

## Durable daemon data

The daemon database contains sensitive prompt and message history. Keep `~/.pi/agent/pi-remote/` private and do not share `control.db`, its WAL/SHM files, `credentials.json`, or token-bearing URLs. Daemon health and logs intentionally omit content and identity metadata. All daemon HTTP and v3/admin WebSocket endpoints require bearer authentication, including loopback health; only root protocol v2 retains the narrowly configured Android query token or explicit loopback bypass.

## Reporting vulnerabilities

Prefer GitHub private vulnerability reporting/security advisories. Do not post tokens, QR codes, private screenshots, real paths, private project names, session history, or logs containing session data in public issues.
