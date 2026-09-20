#!/usr/bin/env bash
set -euo pipefail

OUT="dist-secure"
rm -rf "$OUT"
mkdir -p "$OUT"/{dinner,night-shift,admin-night-shift,beads,shared,holidays}

# Publish tools that use the shared Supabase login plus their direct dependencies.
# Beads also supports a local-only mode, but its online inventory/project features live on this origin
# so the existing unified toolbox login can be reused safely.
cp dinner/index.html dinner/app.js dinner/style.css "$OUT/dinner/"
cp night-shift/index.html "$OUT/night-shift/"
cp admin-night-shift/index.html "$OUT/admin-night-shift/"
cp beads/index.html beads/app.js beads/style.css "$OUT/beads/"
cp shared/toolbox-auth.js "$OUT/shared/"
cp holidays/*.json "$OUT/holidays/"

cp cloudflare-secure/index.html "$OUT/index.html"
cp cloudflare-secure/_headers "$OUT/_headers"
cp cloudflare-secure/robots.txt "$OUT/robots.txt"

printf 'Secure mirror built at %s\n' "$OUT"
find "$OUT" -maxdepth 2 -type f -print | sort
