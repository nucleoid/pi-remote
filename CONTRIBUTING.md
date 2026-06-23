# Contributing

## Development

- Android: `./gradlew test assembleDebug`
- Pi extension: `cd pi-extension/remote-control && npm test && npm run typecheck && npm pack --dry-run`

## Security and screenshot hygiene

Do not commit tokens, QR codes, deep links, real usernames, private paths, private IPs, private project names, or session history. Use demo values such as `100.64.0.10`, `/home/demo/projects/example-app`, and `C:\Users\demo\source\example-app`.

## Release signing

Release keystores and passwords must stay outside git. Use `local.properties` for local builds or protected GitHub Actions secrets for release builds.
