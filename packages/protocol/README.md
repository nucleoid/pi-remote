# @nucleoid/pi-remote-protocol

Schema-first TypeScript contracts and bounded codecs for Pi Remote control protocol v3.

The npm package version and wire `protocolVersion` evolve independently: compatible schema additions may be released without changing wire version 3; incompatible wire changes require a new negotiated wire version.

## Transport

Daemon messages use one JSON object per WebSocket text frame. The transport maximum is 32 MiB for Android-v2 attachment compatibility, while ordinary v3 messages are limited to 256 KiB. `JsonlDecoder` is provided for a future supervisor transport; it is not connected to Pi RPC stdin/stdout.

Unknown properties and discriminants are forward-compatible. Known discriminants are validated strictly. Consumers receive durable events at least once and checkpoint global cursors; use `eventId` and `cursor` to deduplicate replay.

Dashboard control uses an authenticated, connection-owned ephemeral lease bound to one live process/session. Typed `tool_gate.policy`, `tool_gate.request`, `tool_gate.decision`, `pause.arm`, and `pause.resume` frames route only through that lease. Bridge-applied state is confirmed with `dashboard.lease.state`; release or socket loss emits `dashboard.disconnected`. Policy frames, disclosed arguments, and replacement arguments are never written to durable replay or command storage.

See the exported TypeBox schemas, validation helpers, negotiation state, cursor/producer reference stores, v2 fixture adapter, and content-free logging projections.
