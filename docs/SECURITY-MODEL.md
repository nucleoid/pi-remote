# π Remote security model

π Remote is a developer convenience tool for trusted networks. It is not an internet-facing service.

## What the Android app can see

An authenticated Android client can receive session state, working/idle status, current directory, model/session metadata, chat output, tool events, and errors. It can send prompts, steering messages, follow-ups, attachments, and abort requests.

## Authentication

The daemon issues scoped Android v2 tokens and keeps its separate same-user internal credential in `~/.pi/agent/pi-remote/credentials.json`. Treat Android tokens, QR codes, and `pi-remote://` deep links as secrets. Internal credentials are never pairing material.

Rotate a token after any suspected leak:

```text
/remote-control-rotate-token
```

## Transport and protocol versions

The unchanged Android integration remains protocol v2 at `/?token=...`. Pi bridges use authenticated `/control` protocol v3, negotiate `hello`/`welcome`, register stable process/session identity, and resume from the daemon-authoritative process sequence. No command, registration, subscription, or event is accepted before negotiation.

The WebSocket transport is cleartext `ws://` by design for LAN, VPN, localhost, and SSH tunnel use. Each v3 message is exactly one JSON object in one text frame; binary frames and malformed framing are protocol errors. The future JSONL codec is not attached to Pi RPC stdin/stdout. Use a trusted network path:

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

## Authorization, replay, and logging

Negotiated connection capabilities do not grant authority. A command also requires the authenticated principal's scope and the target process capability. Gate and pause control additionally require a daemon-issued dashboard lease owned by the authenticated control socket and bound to one live process/session. The daemon validates and routes those frames in memory; release or dashboard disconnect invalidates the lease and notifies the bridge. Durable event delivery is at-least-once across reconnects; consumers deduplicate by event ID/global cursor. Gate policies, argument disclosure, decisions, and replacement arguments are ephemeral and are never persisted.

Protocol errors contain only a bounded code, path, and safe message. Use the SDK's content-free log projections and `redactForLog()` rather than logging wire payloads.

## Durable local control plane

The daemon authenticates health, protocol discovery, v3 control, and admin operations even on loopback. Android's query token and explicit no-auth loopback compatibility apply only to the root v2 socket. Private internal credentials and keyed token verifiers live in `~/.pi/agent/pi-remote/credentials.json`; do not copy this file. SQLite history is sensitive and excludes attachment bytes, authorization values, raw environment, credentials, token-bearing URLs, and ephemeral gate argument replacements.

The daemon binds loopback for fresh profiles, never chooses a fallback port, and fails closed when lock ownership cannot be verified. Stop it through its authenticated control endpoint rather than killing a PID read from a lock file.

Remote controls advertise only public Pi extension capabilities. Queue/retry mode changes and forced process termination are rejected. Tool argument disclosure is ephemeral and opt-in; complete replacement arguments are recursively checked for dangerous keys and validated against the exact tool schema before prototype-safe in-place mutation.

## Screenshot/log hygiene

Before sharing screenshots or logs, remove:

- tokens and QR codes
- `pi-remote://` deep links
- private usernames and paths
- private project names
- private session history
- customer or proprietary data
