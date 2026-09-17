#!/usr/bin/env bash
set -euo pipefail

OUT="dist-secure"
rm -rf "$OUT"
mkdir -p "$OUT"/{dinner,night-shift,admin-night-shift,shared,holidays}

# Only publish pages that require a Supabase login plus their direct dependencies.
# Public/no-auth tools intentionally stay on GitHub Pages and are not copied here.
cp dinner/index.html dinner/app.js dinner/style.css "$OUT/dinner/"
cp night-shift/index.html "$OUT/night-shift/"
cp admin-night-shift/index.html "$OUT/admin-night-shift/"
cp shared/toolbox-auth.js "$OUT/shared/"
cp holidays/*.json "$OUT/holidays/"

cp cloudflare-secure/index.html "$OUT/index.html"
cp cloudflare-secure/_headers "$OUT/_headers"
cp cloudflare-secure/robots.txt "$OUT/robots.txt"

printf 'Secure mirror built at %s\n' "$OUT"
find "$OUT" -maxdepth 2 -type f -print | sort
