#!/usr/bin/env bash
set -euo pipefail

OUT="dist-public"
rm -rf "$OUT"
mkdir -p "$OUT"/{birthday,coin,cs2-sensitivity,games,mokugyo,snake,shared}

# GitHub Pages is deliberately limited to pages that never load a Supabase
# session. Authenticated pages and all backend/source material stay out of the
# deployment artifact even though the repository itself is public.
cp index.html "$OUT/index.html"
cp birthday/index.html birthday/lunar.js birthday/LICENSE-lunar-javascript.txt "$OUT/birthday/"
cp coin/index.html "$OUT/coin/"
cp cs2-sensitivity/index.html "$OUT/cs2-sensitivity/"
cp games/index.html "$OUT/games/"
cp -R mokugyo/audio "$OUT/mokugyo/audio"
cp mokugyo/index.html "$OUT/mokugyo/"
cp snake/index.html "$OUT/snake/"
cp shared/toolbox-ui.css shared/toolbox-motion.css shared/toolbox-ui.js "$OUT/shared/"
touch "$OUT/.nojekyll"

printf 'Public GitHub Pages artifact built at %s\n' "$OUT"
find "$OUT" -maxdepth 3 -type f -print | sort
