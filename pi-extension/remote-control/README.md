# @pragmaticcoder/pi-remote-control

Daemon-backed Pi extension for pairing the π Remote Android app with Pi TUI and RPC sessions.

## Install

```bash
pi install npm:@pragmaticcoder/pi-remote-control
```

The synchronous extension factory opens no sockets. An enabled TUI/RPC session asynchronously ensures the shared `@nucleoid/pi-remote-daemon`, authenticates over loopback `/control`, and registers stable process/session identity. JSON and print modes stay inactive, and RPC stdin/stdout are never read, written, or intercepted.

## Commands

- `/remote-control` — redacted shared-daemon status.
- `/remote-control-qr` — warning plus scoped Android v2 QR/deep link.
- `/remote-control-android` — open the scoped link through adb.
- `/remote-control-rotate-token` — revoke Android v2 credentials and disconnect paired clients.
- `/remote-control-disable` — globally disable remote control for all Pi bridges/clients.
- `/remote-control-enable` — enable the daemon and reconnect this bridge.

The unchanged Android app continues to use `pi-remote://host:port?token=...` and protocol v2. Explicit pairing output contains a secret by design; ordinary status never does.

## State and compatibility

Daemon state is under `~/.pi/agent/pi-remote/` with best-effort private permissions. Existing deliberate legacy host, port, token, and loopback settings are imported narrowly. A normal default-port upgrade briefly reconnects Android and normally retains pairing. A prior fallback-port or non-selected-session pairing may require re-pairing.

Session shutdown closes only that process bridge; it does not stop the daemon. Assigned events are retained until daemon acknowledgement and resume without renumbering. During an unbounded outage, the bounded spool explicitly emits a gap plus latest snapshot rather than blocking Pi or claiming losslessness.

## Security

Use LAN, Tailscale/WireGuard, localhost, or SSH tunnels; never expose the cleartext WebSocket directly to the public internet. Internal bridge credentials are separate from Android tokens and never appear in URLs, process arguments, status, errors, or logs.

Only public Pi extension controls are advertised: prompt/steer/follow-up, abort, model, thinking, and compaction. Queue/retry controls and forced process termination are rejected. Tool gates are optional; raw arguments are ephemeral and disclosed only by an explicitly trusted policy.
