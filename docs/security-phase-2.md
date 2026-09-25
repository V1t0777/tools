# Security phase 2: Pictionary request boundary

## Changes

- Verify active room membership before room maintenance or round transitions.
- Reject outsiders joining an active game before maintenance; preserve lobby joining.
- Allowlist action names and reject malformed JSON and request bodies above 1 MiB.
- Apply persistent per-account, per-action limits using verified identity, not caller-supplied IP headers.
- Reject requests when the limiter is unavailable (503) or exhausted (429).

## Deployment dependency

The Edge Function uses the existing service-role-only RPC
`public.flappy_rate_limit_check(text,text,integer,integer)` with independent
`pictionary:` action namespaces and a SHA-256 account identifier. Despite its name,
this RPC is a generic atomic rate limiter. Its existing deployment is required;
this change does not include a migration recreating it. A new environment must
provision and review that RPC before deploying this function. Never grant its
execution to anon or authenticated roles.

Windows are 60 seconds. Limits: create_room 6; start_game, close_room and play_again
20; bootstrap, join_room, leave_room and choose_word 30; me, toggle_ready,
finish_round and next_round 60; guess and save_canvas 120; state and canvas 240.

## Verification and rollout

- 52 automated tests passed with `node --test tests/*.test.mjs scripts/*.test.cjs`.
- New handler tests cover unauthorized maintenance, spoofed IP headers, limiter
  denial/failure, revoked sessions, malformed inputs and oversized bodies.
- A rolled-back database transaction verified atomic allowance/denial and that
  anon/authenticated cannot execute the limiter. No test counters persisted.
- Production pictionary-game version 10 is ACTIVE with JWT verification enabled;
  its retrieved source matches this change. Previous production version was 9.
- Full two-account browser gameplay and load testing have not been performed.

To roll back, redeploy the previous reviewed index.ts together with the existing
deno.json and preserve JWT verification. A GitHub revert alone does not roll back
an independently deployed Supabase Edge Function.

## Not resolved by this change

Auth leaked-password protection, long-lived browser session storage, authorization
revocation for already-subscribed Realtime channels, Flappy/Stack anti-cheat,
and existing Flappy/Stack production-to-repository source drift remain separate
work items. Account limits are not a substitute for gateway/global abuse controls.