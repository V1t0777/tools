#!/usr/bin/env bash
set -euo pipefail

fail=0

echo "== Secret-like content scan =="
patterns=(
  'postgres(ql)?://[^[:space:]]+:[^@[:space:]]+@'
  '-----BEGIN ([A-Z0-9 ]+ )?PRIVATE KEY-----'
  'github_pat_[A-Za-z0-9_]{20,}'
  'gh[pousr]_[A-Za-z0-9_]{20,}'
  'sk-[A-Za-z0-9_-]{20,}'
  'xox[baprs]-[A-Za-z0-9-]{10,}'
  'sb_secret_[A-Za-z0-9_-]{20,}'
  'eyJ[A-Za-z0-9_-]{20,}\\.eyJ[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}'
)

scan_pathspec=(
  .
  ':(exclude)scripts/security-check.sh'
  ':(exclude)SECURITY.md'
  ':(exclude)docs/disaster-recovery.md'
)

for pattern in "${patterns[@]}"; do
  if matches="$(git grep -lEI "$pattern" -- "${scan_pathspec[@]}" 2>/dev/null)"; then
    if [[ -n "$matches" ]]; then
      echo "::error::Potential secret-like content detected in tracked file(s):"
      printf '%s\n' "$matches"
      fail=1
    fi
  fi
done

echo "== Sensitive file-name scan =="
while IFS= read -r path; do
  case "$path" in
    .env.example) ;;
    *)
      echo "::error::Sensitive-looking file is tracked: $path"
      fail=1
      ;;
  esac
done < <(git ls-files | grep -E '(^|/)\.env($|\.)|\.(pem|key|p12|pfx|jks|keystore|dump|backup|sql\.gz)$' || true)

echo "== Cloudflare security header checks =="
headers="cloudflare-secure/_headers"
required_headers=(
  'X-Content-Type-Options: nosniff'
  'X-Frame-Options: DENY'
  'Referrer-Policy: no-referrer'
  'Content-Security-Policy:'
  "frame-ancestors 'none'"
  "frame-src 'none'"
  "object-src 'none'"
  'wss://tmxpueakxibsaakdyusn.supabase.co'
)
for header in "${required_headers[@]}"; do
  if ! grep -Fq "$header" "$headers"; then
    echo "::error::Missing expected security header/directive: $header"
    fail=1
  fi
done

echo "== Cloudflare mirror build isolation =="
bash cloudflare-secure/build.sh

required_paths=(
  dist-secure/index.html
  dist-secure/dinner/index.html
  dist-secure/night-shift/index.html
  dist-secure/admin-night-shift/index.html
  dist-secure/flappy/index.html
  dist-secure/stack/index.html
  dist-secure/pictionary/index.html
  dist-secure/pictionary/app.js
  dist-secure/shared/toolbox-auth.js
  dist-secure/shared/vendor/supabase-2.57.4.min.js
  dist-secure/_headers
  dist-secure/robots.txt
)
for path in "${required_paths[@]}"; do
  if [[ ! -f "$path" ]]; then
    echo "::error::Expected secure-mirror artifact missing: $path"
    fail=1
  fi
done

for path in dist-secure/mokugyo dist-secure/birthday dist-secure/coin; do
  if [[ -e "$path" ]]; then
    echo "::error::Public-only tool unexpectedly copied into secure mirror: $path"
    fail=1
  fi
done

if grep -RIlF 'static.cloudflareinsights.com' dist-secure >/dev/null; then
  echo "::error::Authenticated Cloudflare artifact contains a third-party analytics script."
  fail=1
fi

echo "== GitHub Pages public build isolation =="
bash scripts/build-public.sh

public_required_paths=(
  dist-public/index.html
  dist-public/birthday/index.html
  dist-public/coin/index.html
  dist-public/cs2-sensitivity/index.html
  dist-public/games/index.html
  dist-public/mokugyo/index.html
  dist-public/snake/index.html
  dist-public/shared/toolbox-ui.css
  dist-public/.nojekyll
)
for path in "${public_required_paths[@]}"; do
  if [[ ! -f "$path" ]]; then
    echo "::error::Expected public Pages artifact missing: $path"
    fail=1
  fi
done

public_forbidden_paths=(
  dist-public/.github
  dist-public/admin-night-shift
  dist-public/beads
  dist-public/cloudflare-secure
  dist-public/dinner
  dist-public/docs
  dist-public/flappy
  dist-public/night-shift
  dist-public/pictionary
  dist-public/stack
  dist-public/scripts
  dist-public/supabase
  dist-public/tests
  dist-public/shared/toolbox-auth.js
  dist-public/shared/vendor
)
for path in "${public_forbidden_paths[@]}"; do
  if [[ -e "$path" ]]; then
    echo "::error::Private or source-only path unexpectedly copied into public Pages artifact: $path"
    fail=1
  fi
done

if grep -RIlE 'toolbox-auth|tmxpueakxibsaakdyusn\.supabase\.co|sb_publishable_' dist-public >/dev/null; then
  echo "::error::Public Pages artifact contains Supabase authentication code or project configuration."
  fail=1
fi

echo "== GitHub Actions immutable reference checks =="
if grep -REn '^[[:space:]]*uses:[[:space:]]*[^#[:space:]]+@(main|master|v[0-9]+([.][0-9]+){0,2})([[:space:]]|$)' .github/workflows; then
  echo "::error::GitHub Actions must be pinned to immutable full commit SHAs."
  fail=1
fi

if [[ "$fail" -ne 0 ]]; then
  echo "Security checks failed."
  exit 1
fi

echo "Security checks passed."
