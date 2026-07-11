# Changelog

All notable changes to π Remote are documented here.

## [0.2.0] - Unreleased

- Replaced each session's WebSocket server with an authenticated registration bridge to one durable profile daemon.
- Added TUI/RPC process isolation, stable nested-process identity, bounded durable event resume, truthful public-hook projection, supported remote controls, pause/tool-gate safety, and process-scoped Android pairing.
- Preserved Android protocol v2, deep links, attachments, reconnect behavior, and command aliases without Android production changes.
- Made rotate/disable daemon-wide; default-port upgrades normally retain pairing, while legacy fallback-port or non-selected-session pairings may require re-pairing.

## [0.1.2] - 2026-06-23

First public release candidate.

- Changed Android application ID and Kotlin package identity to `com.pragmaticcoder.piremote`.
- Published the Pi extension under the npm scope `@pragmaticcoder/pi-remote-control`.
- Signed the Android release APK with the pragmaticcoder.com release key.
- Refreshed screenshots with real Android captures using demo-safe data.
- Added first-public-release README/release-note copy.

## [0.1.1] - 2026-06-23

- Rebuilt signed release APK after CI/Gradle wrapper hardening.
- Verified APK distribution through GitHub Releases.

## [0.1.0] - 2026-06-23

Initial release candidate.

- Android companion app for live Pi TUI session control.
- Pi extension with WebSocket pairing, QR/deep-link pairing, token rotation, session scanning, and command routing.
- Encrypted Android preferences and disabled Android backups.
- Signed GitHub Release APK distribution path.
