# Authentication & XSS hardening deployment — 2026-10-08

## Delivered and verified at the code/database level
- Protected-origin CSP already restricts execution to same-origin external scripts and SHA-256 hashes of reviewed inline scripts. Added browser cross-origin resource policy and XSS source inventory gate; the build fails on any unreviewed external script source, inline event handler, executable injection API, or changed HTML sink count. Existing user-input HTML insertions must still be reviewed when code changes.
- Fixed the security shell script's earlier escaped-newline typo so both `privacy-scan.mjs` and `xss-audit.mjs` are **actually invoked** by the CI job.
- Shared auth proactively **rotates the browser-held token after approximately 10 minutes** on foreground/API activity; it continues normal refresh on near-expiry and preserves in-flight cross-tab locks. **This is not a change to the JWT's cryptographic `exp` claim.** Supabase Auth's managed JWT expiry must be configured using Auth settings; do not claim a 10-minute server-issued JWT lifetime.
- Supabase TOTP enrollment and GoTrue challenge verification is available before editing department rosters. Admin edits use the newly verified AAL2 JWT; never persist MFA secret or OTP to browser storage/logs.
- The server also enforces an AAL2 session and a recent verified MFA challenge (5 minute window) for previously enrolled administrators on the three roster data tables and the atomic daily-schedule replacement RPC.
- For **pre-enrollment compatibility**, administrators without a verified factor are still allowed under their original admin role. This is a **temporary unenrolled-user bypass**, not universally enforced MFA. It protects availability until real users bind factors through the authenticated Cloudflare deployment. Once that deployment and account enrollment are verified, replace the bypass via a new migration and require MFA even for unenrolled admins.
- Supabase cron every 15 minutes detects previously unseen network address or browser identifier **relative to other sessions in the prior 30 days**. Only `user_id`, `session_id`, coarse event category and timestamp are recorded; the private ledger expires after 90 days. Network changes, browser upgrades and VPNs may cause false positives. The authenticated roster screen shows the current user's own last 7 days of event categories; no raw device/IP identifiers are exposed.
- RLS and private/anon grants preserved. No user records, night-shift, dinner or game data were deleted.

## Operator actions and limitations
1. Ensure Cloudflare Pages' **secure origin** deploys the latest GitHub `main` and includes `shared/toolbox-mfa.js` and the current `_headers`. A GitHub Pages success is **not proof** of Cloudflare deployment.
2. Visit the authenticated department roster page, log in as an authorized administrator, press “保存当天全部排班” and follow the first-time TOTP enrollment modal. Scan the generated QR code with a trusted authenticator, or enter the secret manually. Complete the OTP verification before the roster is saved. An aborted setup does not modify the roster. Have a secure backup MFA factor before making MFA mandatory, because Supabase Auth provides no recovery codes.
3. Confirm read-only viewers and guests cannot call a write RPC; enrolled admins with only `aal1` cannot change roster; properly verified `aal2` admins can. Online end-to-end TOTP enrollment requires an administrator to use their own authenticator; no production account was enrolled by automation.
4. Reduce real **JWT expiry** using **Supabase Dashboard → Authentication → Settings / JWT expiry**, ideally after a staged 15–30 minute compatibility test. The current connector offers no Auth-config mutation action, so no actual JWT `exp` setting was changed.
5. Add operational MFA-enforced admin enrollment status and review anomaly ledgers only using secure admin queries. No raw IP is recorded in the new ledger, and no external email/SMS alert provider was configured.
6. Do not put scripts, Supabase service keys, TOTP secrets, auth passwords or user rows into GitHub source or issue comments.

## Rollback
- Revert GitHub frontend source and redeploy both GitHub Pages and the Cloudflare secure project separately.
- Database changes need a **new forward migration**, not deletion of applied history. A carefully reviewed forward migration can restore prior admin-write policy predicates and the original `replace_day_schedule` function. Audit/monitor logs are isolated; do not drop production audit data without a retention review.
