# Support

## Usage questions

Use GitHub Discussions if enabled, or open a GitHub issue with the `question` label. Include:

- Android version/device model
- Pi version
- install method (`pi install npm:@pragmaticcoder/pi-remote-control`, git, or local)
- network path: LAN, Tailscale, WireGuard, localhost, or SSH tunnel
- sanitized configuration shape without tokens

## Bug reports

Use the bug report issue template. Please include reproduction steps and relevant logs, but redact private data first.

Do **not** post:

- bearer tokens
- QR codes
- `pi-remote://` deep links
- release signing files or passwords
- private screenshots
- private paths, usernames, project names, session history, or customer data

## Security issues

Prefer GitHub private vulnerability reporting/security advisories after the repository is public. Until then, follow [SECURITY.md](SECURITY.md) and avoid posting sensitive details publicly.

If pairing material leaks, rotate it immediately with:

```text
/remote-control-rotate-token
```
