# Flappy / Stack request hardening

This change preserves public leaderboard access and existing scoring rules.
Both game write paths validate the user and active session, then consume an
atomic per-account counter before reading or mutating game-run state.

- start_run: 30 requests per 60-second fixed window per verified account.
- submit_run: 60 requests per 60-second fixed window per verified account.
- Keys hash the game namespace and verified user ID, never a body user ID or IP.
- Existing service-only flappy_rate_limit_check / stack_rate_limit_check RPCs
  are reused with account: action namespaces, separate from the IP counters.
- Counter failure returns 503; exhaustion returns 429. Neither permits a write.
- Streamed request bodies are capped at 16 KiB, including without Content-Length.
- Malformed JSON, non-object bodies and unknown actions fail before database RPCs.
- Omitted action still means leaderboard; explicit invalid actions are rejected.

The existing IP-based pre-auth limiter remains supplementary. Its forwarding
header trust has not been established; public leaderboard/global abuse protection
still requires trusted ingress controls. Account limits do not prevent many-account
abuse, unauthenticated Auth request load, or fabricated scores within the existing
timing heuristics. This is not full anti-cheat or a proof of real gameplay.

No database migration, API key rotation, JWT setting change or score deletion is
included. Existing run-token ownership, expiry and atomic one-time submission
checks are unchanged. Deploy both functions explicitly after review; merging this
PR alone does not deploy Supabase Edge Functions. Keep verify_jwt=false for the
mixed public/private endpoints and never remove in-handler authentication.

Tests execute both actual handlers with mocked database adapters. Live load tests
and browser gameplay are not included. A rollback redeploys the pre-change sources
from main at 26da7cb179c5090d7ceb88532078af8d3a7bb96d; existing counters need not
be deleted and new account namespaces do not affect the previous version.
