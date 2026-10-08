# Realtime room-membership revocation

Supabase Realtime authorizes Broadcast/Presence on channel join and caches permissions. Removing RLS privileges does **not** synchronously close an already-connected malicious WebSocket. This release uses **room-topic rotation** instead of incorrectly claiming per-message gateway checks.

## Security boundary

- A cryptographically random UUID in each `pictionary_rooms` / `blackjack_rooms` row is part of that room's *private* Realtime topic. Only authorized room state APIs return the current value. No publishable key or guest-only API reveals it.
- RLS helpers permit subscriptions only to the current topic token **and** an active member with an active auth session. Prior topics cannot be newly joined after a rotation.
- When a player loses active membership, an account member is removed, or a Supabase auth session row is deleted, database triggers rotate the token in the same transaction. A server-only `channel_rotated` broadcast carries **no replacement token** on the old topic.
- Current browser clients immediately stop using the old channel on the rotation notice, get fresh room state over the authenticated Edge function, and reconnect to the new topic; missed notices are repaired by existing authoritative state polling (Pictionary normally 3 seconds, Blackjack adaptive).
- Server-origin Pictionary `state_sync` messages are sent only to the current topic. No additional database query is made for drawing strokes; normal game networking is unchanged.
- Former players never receive the new nonce from room state because the API validates active membership.

## Limits and fallback

- This is a server-enforced **cutoff of new subscriptions and future official server broadcasts**, not a claim that Supabase disconnects an adversarial old socket at the precise instant of revocation. A hostile client can keep an already authorized old subscription alive until the platform refreshes its RLS cache. During that interval a lagging old frontend might briefly publish client-originated traffic to the old channel. Client updates / forced refresh and authoritative reads mitigate this window.
- Auth-session revocation relies on deletion of `auth.sessions`; revoke patterns that leave an existing session row intact are not covered by that trigger. A manual administration operation should explicitly remove the member or delete/revoke the corresponding session.
- Some previously loaded browser tabs run the old hard-coded room topics and must be refreshed to use random topic IDs. Deploy the updated Edge function and Cloudflare frontend before applying the migration. Existing game tabs should be refreshed afterward.
- Database-side revocation events catch and log Realtime broadcast delivery failures so revocation and nonce rotation are not rolled back by a transport failure.
- A heartbeat or polling interval is **not** a strict upper bound on network delivery, especially if a device is asleep, offline or the platform is unavailable.

## Rollout and verification

1. Merge the frontend/Edge deployment to `main`; verify the secure Cloudflare build is current. The frontend falls back to legacy topics only until `realtime_token` exists.
2. Deploy the new `pictionary-game` source explicitly, retaining `verify_jwt=true`.
3. Apply `20261008013653_realtime_membership_channel_rotation.sql` and confirm both games' policies deny old topics. Do not run the migration before updated clients and Edge are ready.
4. Exercise user leaves, session sign-out, joining after revocation, another member's reconnect, Pictionary canvas and guess text, Blackjack state and emoji messaging, and disconnection/reconnection.
5. Check Supabase Security Advisor and CI. Realtime's actual multi-browser timing remains a live test to perform with two consenting accounts.

## Rollback

Database rollback is intentionally **not** automated: the random topic rotation hardens authorization. If errors occur, first roll back the frontend, Edge function and SQL as a planned set. Rolling back only one layer can make channels fail to subscribe. Keep user sessions, secret keys, and RLS intact during troubleshooting.
