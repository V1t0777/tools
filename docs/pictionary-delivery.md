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
