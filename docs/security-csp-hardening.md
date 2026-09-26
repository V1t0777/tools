# Secure-site CSP script hardening

This change applies only to the Cloudflare secure mirror. It does not change
GitHub Pages, database permissions, session storage, or game authentication.

## Build contract

`cloudflare-secure/build.sh` copies the approved assets, then runs
`node scripts/secure-csp.mjs dist-secure`. Node is required in the build image.
Do not deploy the source `_headers` file directly: it intentionally denies
inline scripts until the build adds the hashes of the actual published HTML.

The current nine HTML pages contain four inline scripts (Flappy, Stack,
night-shift and admin-night-shift). Their SHA-256 hashes replace the broad
`script-src 'unsafe-inline'` permission. External same-origin scripts remain
allowed. `script-src-attr 'none'` explicitly blocks inline event attributes;
JavaScript-assigned listeners such as `button.onclick = handler` remain valid.
HTML, execution order and script bodies are not rewritten. HTML newline
normalization is applied when hashing so Windows/Linux checkouts agree.

The extractor supports the repository's current restricted script markup, not
arbitrary HTML. New inline script attributes or unsupported markup fail the
build pending review. Hashes are computed only from trusted build inputs;
this is not a sanitizer and cannot protect a compromised repository/build.
All four hashes are shared across secure routes (including fallback HTML).
Any future user-uploaded executable content must remain on a separate origin.

The build fails if the generated header line exceeds Cloudflare's 2,000-character
limit. No unsafe-inline/unsafe-eval script fallback is added on failure.
`style-src 'unsafe-inline'` remains for existing styles; this is not a claim of
a fully strict nonce/hash-only CSP. The policy still trusts same-origin JS.

## Verification and rollout

- Run `node --test tests/*.test.mjs scripts/*.test.cjs`.
- CI runs the complete secure/public builds and secret scans.
- Before/after production rollout, verify the actual HTTP CSP contains four
  SHA-256 hashes, no script unsafe-inline, and script-src-attr none.
- Browser acceptance remains required: login, session restore, logout,
  both scheduling pages, Flappy/Stack start and submission, Pictionary room
  updates, and beads local/online functions. Unit tests do not prove these.
- Do not enable HTML/script rewriting after hashes are calculated; recheck
  deployed HTML against the response header if an edge transform is enabled.
- On a confirmed CSP regression, revert this PR and rebuild/redeploy the last
  known-good commit. Do not add broad script permissions as an ad hoc fix.

Cloudflare `_headers` applies to static assets, not Pages Functions responses.
See https://developers.cloudflare.com/pages/configuration/headers/ .
