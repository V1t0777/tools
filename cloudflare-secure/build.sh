#!/usr/bin/env bash
set -euo pipefail

OUT="dist-secure"
rm -rf "$OUT"
mkdir -p "$OUT"/{dinner,night-shift,admin-night-shift,beads,flappy,games,stack,pictionary,shared/vendor,holidays}

# Publish tools that use the shared Supabase login plus their direct dependencies.
# Beads also supports a local-only mode, but its online inventory/project features live on this origin
# so the existing unified toolbox login can be reused safely.
cp dinner/index.html dinner/app.js dinner/style.css "$OUT/dinner/"
cp night-shift/index.html "$OUT/night-shift/"
cp admin-night-shift/index.html "$OUT/admin-night-shift/"
cp beads/index.html beads/app.js beads/style.css beads/mard-palette.js "$OUT/beads/"
cp flappy/index.html "$OUT/flappy/"
cp games/index.html "$OUT/games/"
cp stack/index.html "$OUT/stack/"
cp pictionary/index.html pictionary/app.js pictionary/style.css "$OUT/pictionary/"
cp shared/toolbox-auth.js shared/toolbox-ui.css shared/toolbox-motion.css shared/toolbox-ui.js "$OUT/shared/"
cp shared/vendor/supabase-2.57.4.min.js shared/vendor/supabase-LICENSE "$OUT/shared/vendor/"
cp holidays/*.json "$OUT/holidays/"

cp cloudflare-secure/index.html "$OUT/index.html"
cp cloudflare-secure/_headers "$OUT/_headers"
cp cloudflare-secure/robots.txt "$OUT/robots.txt"

# Hash the exact published HTML, not a separately maintained source copy.
node scripts/secure-csp.mjs "$OUT"

printf 'Secure mirror built at %s\n' "$OUT"
find "$OUT" -maxdepth 2 -type f -print | sort
