# Flappy friend leaderboard

Project: `tmxpueakxibsaakdyusn`. Edge Function: `flappy-game`.
Game version: `2026.09.23-leaderboard-v1`.

## Rules and retention

- Guests play normally; local `zhaoFlappyBest.v1` remains independent.
- Existing Toolbox Auth sessions and `members` identify players. The Edge handler
  checks the live user and `toolbox_session_status`; no user-editable metadata is trusted.
- `test@test.com` (case-insensitive) cannot start/submit ranked runs and is excluded
  from public leaderboard results. Database triggers also reject its run writes.
- One all-time maximum and one current-week maximum per member. Equal scores retain
  the earliest record; ties between players sort by achievement time then member ID.
- Weeks start Monday 00:00 Asia/Shanghai. Scores belong to the submission week.
- Cron `flappy-minimal-history-cleanup` runs daily at 03:10 Asia/Shanghai. It removes
  older weekly summaries and nonbest verified runs, keeping only records referenced
  by all-time/current-week bests. Expired pending tokens and invalid submissions
  older than two hours are removed too. Thus at most two verified historical runs
  per player survive cleanup; transient runs can exist until the next daily job.
- Warm/slate skin is bound to the server-issued token and retained in each best.

## Security boundary

`verify_jwt=false` is intentional: leaderboard reads are public. Both mutating
actions implement custom authentication with Supabase `getUser` plus the existing
active-session/member RPC before any writes. Browser `anon` and `authenticated`
roles have **no table privileges**, all three tables have RLS with no browser
policies, and private trigger/cleanup functions are not browser-callable.
The server role can select/insert/update runs and only select aggregates; a private
trigger atomically maintains both bests, and owner-run Cron performs deletion.

Start creates a cryptographically random 256-bit token; only SHA-256 is stored.
Tokens expire after 15 minutes. A conditional update claims each token once, even
for invalid submissions. Rate limiting is serialized per member in PostgreSQL.
Validation checks integer score 0–200, active simulation duration 250–1,200,000 ms,
wall-clock upper bound (20-second start-request grace), conservative score/time
bounds, exact game version and skin. Pauses are excluded from active duration.
This is basic anti-cheat, **not authoritative game replay**: a determined modified
client can fabricate a plausible score within these limits.

Network work never blocks the local game. Up to five in-memory failed submissions
can retry once on a browser `online` event while the same account remains signed
in. Closing/reloading the page does not persist pending tokens. Old-game responses
cannot overwrite a new game's status, and account changes invalidate pending work.

## Verification and deployment

Run with Node 24:

```sh
node --test tests/flappy-edge.test.mjs tests/flappy-frontend.test.mjs
```

These execute the actual Edge handler with a mocked Supabase adapter, and the
actual frontend script with a DOM/network harness. They cover successful/duplicate
claims, rejected attempts, expiry, ownership, version/skin/score bounds, account
exclusion, offline fallback, input isolation, stale responses and bounded retries.
They are not a substitute for testing real signed-in HTTP requests.

`tests/flappy-database.sql` executes actual aggregate/cleanup/guard/role checks
inside an explicit rollback transaction; requires the migration owner and an
existing test member. No fixture scores remain afterwards. A separate live
service-role rollback check confirmed private aggregate triggers execute correctly.

Deployment order: apply the committed migrations, deploy `flappy-game` with
`index.ts` and explicit `deno.json` import-map path, then publish frontend to main.
Check public leaderboard HTTP 200, unsigned start HTTP 401, RLS/privileges and Cron.
Do not mint sessions or reset member passwords for smoke tests. A real member
login/play/submit smoke test requires the member's own credentials/session.

