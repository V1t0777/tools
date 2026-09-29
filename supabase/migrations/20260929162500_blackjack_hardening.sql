-- Blackjack V1: low-latency indexing and explicit fail-closed browser policies.

-- room_code already has a unique index from its UNIQUE constraint.
drop index if exists public.blackjack_rooms_code_idx;

create index if not exists blackjack_rooms_host_user_idx
  on public.blackjack_rooms(host_user_id);
create index if not exists blackjack_players_user_idx
  on public.blackjack_players(user_id);
create index if not exists blackjack_actions_user_idx
  on private.blackjack_actions(user_id);

drop policy if exists "blackjack deny direct room access" on public.blackjack_rooms;
create policy "blackjack deny direct room access"
on public.blackjack_rooms
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists "blackjack deny direct player access" on public.blackjack_players;
create policy "blackjack deny direct player access"
on public.blackjack_players
for all
to anon, authenticated
using (false)
with check (false);
