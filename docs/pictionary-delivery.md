# Pictionary delivery and recovery

The September 22 update keeps guesses authoritative on the server and gives HTTP
canvas snapshots and Realtime drawing operations a shared revision. Refresh all
open game tabs when upgrading from the September 21 client.

## Invariants

- A guess includes room ID, round ID, and a client-generated UUID. Retries use the
  same UUID. The service transaction locks the room, checks membership and round,
  and returns the stored receipt for a previously processed request, including
  after that round has ended. Reusing an ID with different text is rejected.
- Score totals and score revision come from one database snapshot. Clients assign
  totals; they never add a broadcast award to a polled total. An older score
  revision cannot replace a newer one.
- The round ID scopes canvas revisions. Deltas include their base revision; gaps
  request a complete snapshot. Clear and undo advance the revision. HTTP responses
  and completed snapshot assemblies cannot replace a newer local revision.
- Canvas saves lock the room and validate the current drawer and current round.
  Repeated revisions are idempotent; older revisions cannot overwrite storage.
- Only a matching locally-issued ping confirms the peer path. A response from
  another guesser does not establish that the drawer's canvas path is healthy.
  Healthy clients still check the saved canvas version every five seconds.
- All game API calls have an eight-second deadline, including session retrieval.
  Uncertain guesses retain a retry button. Room generations fence HTTP callbacks;
  connection generations fence removed channel callbacks. Page-cache restoration
  restarts countdown, state, canvas, and health timers.

## Release order

1. Apply `pictionary_consistent_delivery` to the existing project.
2. Deploy the checked-in `pictionary-game` function with JWT verification enabled.
3. Publish the versioned frontend assets and refresh open tabs.

The repository also includes the four previously deployed September 21 migrations
that were missing from source control. These are historical records, not migrations
to reapply to the existing production database. This repository still assumes the
pre-existing toolbox members/auth and initial Pictionary tables.

## Validation

Run `node --test scripts/pictionary-sync.test.cjs` and `bash scripts/security-check.sh`.
Type-check the Edge Function with Deno. The SQL fixture in
`scripts/pictionary-db-regression.sql` must be run inside a transaction and rolled
back; it uses two existing member IDs only as foreign keys for temporary game rows.
It verifies idempotent guesses, stale-round rejection, score totals, versioned
canvas writes, and drawer authorization as `service_role`. No fixture data should
be committed.

Network delivery times still depend on the players' connections. These checks
verify ordering and recovery, not a production latency percentile or an iOS
background-execution guarantee.

## Login and reconnect follow-up — 2026-09-23

- Shared authentication bounds network requests/body reads to 10 seconds and
  cross-tab refresh lock waits to 12 seconds. Transient failures preserve refresh
  credentials; only explicit revocation/invalid-refresh responses clear them.
  A still-valid access token can continue while proactive refresh backs off.
- Password submissions and refresh/probe requests coalesce. Local logout is
  immediate, and delayed responses cannot resurrect a signed-out session.
- Pictionary uses one authenticated `bootstrap` request for member information and
  invitation entry. A recovery screen retries without submitting the password
  again. `me` and `join_room` remain compatible with older clients.
- The pinned 2.57.4 browser SDK is served locally and loaded asynchronously.
  Its SRI hash matches the former CDN dependency.
- Server heartbeat health is separate from peer/drawer availability. Silent
  players trigger canvas repair, not socket rebuilds. SDK recovery gets an
  8-second grace period; full rebuilds use exponential jitter. Backoff resets
  only after 20 seconds of stable subscription. Connection setup has a 12-second
  watchdog and late callbacks remain epoch-fenced.
- Offline polling is suppressed; online/page restore resumes synchronization.
  Auth probe intervals also restart after page-cache restoration.

Validation: `node --test scripts/toolbox-auth.test.cjs scripts/pictionary-sync.test.cjs`,
Deno typecheck, repository security/build checks, and served asset comparison.
Tests simulate network failures and lifecycle transitions; they do not replace
multi-device mobile network testing or measure production login percentiles.


## Low-latency round pipeline — 2026-10-07

- Drawing deltas are batched at roughly one 60 Hz frame (14 ms instead of 28 ms).
- Guess text is broadcast optimistically to room members and expires after 2.5 seconds unless the existing authoritative guess receipt confirms it. Correctness, scoring, and deduplication remain server-authoritative.
- Normal state transitions now receive a server-emitted `state_sync` Broadcast. Authenticated clients are not granted permission to send that event; the Edge service emits it through a service-role-only wrapper.
- End-of-round and next-round mutation requests are leader-gated in the client to avoid every device racing the same HTTP transition. Existing idempotent server checks and polling remain as recovery.
- Summary display is reduced from six seconds to 3.2 seconds.
- While a round is being played, the Edge Function warms the next round in a background task using `EdgeRuntime.waitUntil`. The next-round mutation reuses the prepared row and only falls back to synchronous preparation if needed.
- Full `state` polling remains as a three-second reconciliation path and is still used for reconnects, drawer-only word options, and recovery.

- The follow-up Realtime policy validates optimistic guess payloads against the authenticated member and current round, so a room member cannot label a temporary guess as another player.


## Regional invocation alignment — 2026-10-08

- All `pictionary-game` browser requests use Supabase's documented `forceFunctionRegion=ap-southeast-1` parameter, keeping the database-heavy Edge Function execution in Singapore alongside the project's Postgres region.
- Early round completion from `pictionary_submit_guess_v2` now uses the same 3.2 second summary window as timer-driven round completion.
- Explicit regional routing trades automatic region failover for predictable database proximity; the existing client timeout/retry and state reconciliation remain in place.


## Client reliability hardening — 2026-10-09

- Canvas buffers are resized only when the physical dimensions actually change. Ordinary state updates never wipe the backing buffer or redraw all strokes.
- Realtime drawing accepts out-of-order deltas within a 140 ms window (max 32 buffered entries); only unresolved gaps trigger a snapshot/fallback. A complete snapshot clears stale queued deltas.
- Full-canvas snapshots are sent only in response to recovery requests. Concurrent viewers' requests are coalesced into one room-wide snapshot with an 850 ms cooldown, instead of initiating a new snapshot for each viewer or every long stroke / undo.
- Transport health and canvas sync status are separate. Missing drawer Pong alone does not mark a connected transport unhealthy, and database canvas fallback is rate-limited.
- Confirmed channel failure retries quickly (subsecond initial delay with exponential backoff); retries still fence old socket callbacks by connection epoch.
- Unverified guesses are optimistic only on the sender's screen. Other players receive `guess_result` only after server scoring, never potentially correct plaintext guesses. Migration `20261009143619_pictionary_no_unverified_guesses` removes permission to publish `guess_pending` while retaining the existing server-authoritative result and private-room controls.
- This is a reliability update, not a claim that client-to-client p95 latency has been measured. Continue dual-device network profiling after release.


## Phase 2 — service-authoritative low-latency pipeline

- `pictionary_identity_v3` combines revoked-session verification with display-member lookup under JWT-based identity; no client-selected member IDs.
- `pictionary_state_snapshot_v3` runs as service-role-only SECURITY INVOKER, verifies active room membership and returns one complete, permission-trimmed JSON snapshot. Normal `state` requests do not perform the old cross-table PostgREST fan-out; recovery of expired rounds is conditional.
- A monotonic `state_revision` on every room update fences delayed HTTP snapshots and authoritative Realtime state messages. It does **not** use wall-clock timestamps or client-controlled sequence numbers.
- The database emits `room_transition` transactionally when a round enters summary; only after validated scoring can the correct answer appear. Edge broadcasts compact server-built `state_sync` events on selections and next-round transitions; clients receive without querying the entire room unless the drawing player needs secret word options.
- Normal fully-connected browsers reconcile snapshots every 18 seconds; degraded sockets poll at 1.8 seconds. The 30-second hint fetch, reconnect recovery, and stale-round checks remain.
- The Supabase function stays pinned to ap-southeast-1 by the frontend query parameter. Scores and event authorization remain server-side.
