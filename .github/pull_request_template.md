## Summary

## Tests

- [ ] `./gradlew test assembleDebug`
- [ ] `cd pi-extension/remote-control && npm test && npm run typecheck && npm pack --dry-run`
- [ ] `python scripts/scan-sensitive.py`

## Security checklist

- [ ] No tokens, QR codes, token-bearing deep links, keystores, passwords, private screenshots, real paths, private project names, or session history are included.
- [ ] Release signing material stays outside git.
- [ ] Screenshots are captured from the real Android app, not hand-drawn mockups.
- [ ] Screenshots use only demo-safe values or have sensitive regions blurred/redacted.
- [ ] README/release/package metadata still point to public URLs.
