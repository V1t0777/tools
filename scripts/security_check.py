#!/usr/bin/env python3
"""Dependency-free checks that never print a matched secret value."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

TEXT = {".css", ".html", ".js", ".json", ".md", ".sh", ".txt", ".yaml", ".yml"}
IGNORE = {".git", "dist-secure", "node_modules"}
SECRETS = {
    "private-key": r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----",
    "github-token": r"\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{30,})\b",
    "aws-access-key": r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b",
    "supabase-secret-key": r"\bsb_secret_[A-Za-z0-9_-]{20,}\b",
    "supabase-service-role": r"(?i)\bservice[_-]?role\b\s*[:=]\s*['\"][A-Za-z0-9._-]{20,}",
    "generic-secret": r"(?i)\b(?:client[_-]?secret|api[_-]?secret|private[_-]?token)\b\s*[:=]\s*['\"][^'\"\s]{16,}",
}
USES = re.compile(r"^\s*-?\s*uses:\s*([^\s#]+)", re.MULTILINE)


def files(root: Path):
    for path in root.rglob("*"):
        if path.is_file() and path.suffix.lower() in TEXT:
            if not any(part in IGNORE for part in path.relative_to(root).parts):
                yield path


def rel(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def scan(root: Path, failures: list[str]) -> None:
    for path in files(root):
        text = path.read_text(encoding="utf-8", errors="replace")
        for name, pattern in SECRETS.items():
            if re.search(pattern, text):
                failures.append(f"{rel(path, root)}: matched {name}")
        if path.suffix.lower() == ".html" and re.search(
            r"(?i)<(?:script\b[^>]*\bsrc|link\b[^>]*\bhref)\s*=\s*['\"]http://", text
        ):
            failures.append(f"{rel(path, root)}: contains an HTTP active resource")


def workflows(root: Path, failures: list[str]) -> None:
    directory = root / ".github" / "workflows"
    if not directory.exists():
        failures.append(".github/workflows: no repository checks configured")
        return
    for path in sorted(directory.glob("*.y*ml")):
        text = path.read_text(encoding="utf-8", errors="replace")
        name = rel(path, root)
        if not re.search(r"(?m)^permissions:\s*\n\s+contents:\s*read\s*$", text):
            failures.append(f"{name}: token permissions are not contents: read")
        if re.search(r"(?m)^\s*permissions:\s*write-all\s*$", text):
            failures.append(f"{name}: write-all permissions are forbidden")
        for action in USES.findall(text):
            if action.startswith(("./", "docker://")):
                continue
            ref = action.rsplit("@", 1)[-1] if "@" in action else ""
            if not re.fullmatch(r"[0-9a-f]{40}", ref):
                failures.append(f"{name}: external Action is not pinned to a full SHA")


def headers(root: Path, failures: list[str]) -> None:
    path = root / "cloudflare-secure" / "_headers"
    text = path.read_text(encoding="utf-8", errors="replace").lower() if path.exists() else ""
    for directive in (
        "content-security-policy:", "frame-ancestors 'none'", "object-src 'none'",
        "x-content-type-options: nosniff", "referrer-policy:", "permissions-policy:",
    ):
        if directive not in text:
            failures.append(f"cloudflare-secure/_headers: missing {directive}")


def distribution(root: Path, dist: Path, failures: list[str]) -> None:
    expected = {
        "_headers", "index.html", "robots.txt", "admin-night-shift/index.html",
        "dinner/app.js", "dinner/index.html", "dinner/style.css", "holidays/2026.json",
        "night-shift/index.html", "shared/toolbox-auth.js",
    }
    actual = {p.relative_to(dist).as_posix() for p in dist.rglob("*") if p.is_file()} if dist.exists() else set()
    if expected - actual:
        failures.append("Cloudflare build is missing expected files")
    if actual - expected:
        failures.append("Cloudflare build contains unexpected files")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", nargs="?", default=".")
    parser.add_argument("--dist")
    args = parser.parse_args()
    root = Path(args.root).resolve()
    failures: list[str] = []
    scan(root, failures)
    workflows(root, failures)
    headers(root, failures)
    if args.dist:
        distribution(root, (root / args.dist).resolve(), failures)
    if failures:
        print("Security checks failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print("Security checks passed; no secret values were printed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
