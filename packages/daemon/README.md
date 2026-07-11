# @nucleoid/pi-remote-daemon

Durable, profile-scoped local control plane for π Remote. Requires Node 22 and stores its lock, private credentials, SQLite WAL database, and configuration under `~/.pi/agent/pi-remote/`.

```bash
pi-remote-daemon ensure
pi-remote-daemon status
pi-remote-daemon stop
```

Fresh profiles listen on `127.0.0.1:37891`. Existing explicit host, port, Android token, and v2 loopback-bypass settings are imported without broadening network exposure. `/control` and all HTTP/admin routes require an Authorization bearer. Only the Android-compatible root v2 socket accepts `?token=`.

The daemon uses one fixed profile port and fails closed on an occupied port or ambiguous lock. It never scans for a fallback. History is retained for 30 days or one million events by default; pins and active replay leases protect required rows.

The `@nucleoid/pi-remote-daemon/client` export contains only lifecycle HTTP helpers and does not load SQLite.
