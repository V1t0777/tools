# Phase 2 follow-up: deployment parity and session cleanup

## Repository and deployment parity

Flappy source is synchronized with production version 3, and previously missing
Stack source is recorded from production version 1 (retrieved 2026-09-25).
Only trailing whitespace/line endings are normalized; neither function's behavior
is changed or redeployed by this PR. Secrets remain environment lookups, not values.

supabase/config.toml records the verified production gateway settings:
Flappy/Stack disable gateway JWT checking to support public leaderboard reads.
Their start/submit handlers independently validate the Auth user and active
toolbox session. Pictionary retains gateway JWT checking.

This is not a complete disaster-recovery snapshot. The production limiter RPCs,
Stack database schema/triggers and some membership hardening are not yet fully
represented in migrations. Do not deploy to a blank database from this source
alone. Function-local deno.json and the exact SDK version are preserved; transitive
dependency lockfiles remain a separate follow-up.

## Pictionary client cleanup

The client now handles shared authentication sign-out events, including events
from other tabs, and account switches. It clears room state and canvas data,
stops room timers, leaves Realtime and invalidates pending callbacks/startup work.

This is client-side cleanup, not a security boundary against a modified client.
Server-side revocation of an already-authorized Realtime channel remains open.
See [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization).

## Continuous verification

The GitHub security workflow now also runs the actual Node regression suite using
Node 24.19.0 and an immutable setup-node commit. Flappy test fixtures now model the
deployed exclusion flag and rate-limit RPC. Stack receives authentication,
revoked-session, ownership-filter and rate-denial tests. Pictionary receives a
cross-tab logout/late-callback regression.

These tests use in-memory adapters; they do not establish live database RLS,
real-browser multi-account behavior, anti-cheat integrity or load capacity.
IP-header trust for public limits, per-account limits for Flappy/Stack, request
body bounds, score replay validation and backend Realtime revocation remain open.
