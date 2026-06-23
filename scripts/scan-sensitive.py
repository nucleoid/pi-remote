#!/usr/bin/env python3
"""Small repo hygiene scan for public-release footguns.

This intentionally complements, not replaces, GitHub secret scanning. It checks for
release signing material accidentally tracked and obvious sensitive demo-screenshot
strings that have previously appeared during release prep.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

FORBIDDEN_SUFFIXES = {
    ".jks",
    ".keystore",
    ".p12",
    ".pfx",
    ".pem",
}

FORBIDDEN_NAMES = {
    "local.properties",
    "remote-control.json",
    "release-signing.env",
}

SCREENSHOT_NEEDLES = [
    b"mstat",
    b"com.mstat",
    b"100.76.124.34",
    b"engram-csharp",
    b"C:\\Users",
    b"token=",
    b"demo-release-token",
    b"super-secret",
]

TEXT_DEEP_LINK_NEEDLES = [
    "pi-remote://",
    "token=",
]

ALLOW_DEEP_LINK_TEXT = {
    "README.md",
    "SECURITY.md",
    "SUPPORT.md",
    "docs/INSTALL.md",
    "docs/SECURITY-MODEL.md",
    "docs/DEVELOPMENT.md",
    "pi-extension/remote-control/README.md",
    ".github/ISSUE_TEMPLATE/bug_report.md",
    ".github/ISSUE_TEMPLATE/feature_request.md",
    ".github/ISSUE_TEMPLATE/question.md",
    ".github/pull_request_template.md",
}


def git_files() -> list[Path]:
    output = subprocess.check_output(["git", "ls-files"], cwd=ROOT, text=True)
    return [ROOT / line for line in output.splitlines() if line]


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def main() -> int:
    failures: list[str] = []
    files = git_files()

    for path in files:
        relative = rel(path)
        lower_name = path.name.lower()
        if path.suffix.lower() in FORBIDDEN_SUFFIXES:
            failures.append(f"tracked signing/secret-like file: {relative}")
        if lower_name in FORBIDDEN_NAMES:
            failures.append(f"tracked local secret/config file: {relative}")
        if lower_name.endswith(".token"):
            failures.append(f"tracked token file: {relative}")

    for path in sorted((ROOT / "docs" / "screenshots").glob("*.png")):
        data = path.read_bytes()
        for needle in SCREENSHOT_NEEDLES:
            if needle in data:
                failures.append(f"screenshot {rel(path)} contains {needle.decode('latin1')!r}")

    for path in files:
        relative = rel(path)
        if path.suffix.lower() not in {".md", ".txt", ".yml", ".yaml", ".json"}:
            continue
        if relative in ALLOW_DEEP_LINK_TEXT:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        if all(needle in text for needle in TEXT_DEEP_LINK_NEEDLES):
            failures.append(f"possible token-bearing deep link in {relative}")

    if failures:
        print("Sensitive-content scan failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1

    print("Sensitive-content scan passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
