begin;
-- v3.1: drawing is a separate per-round private Realtime channel.
-- Channel authorization is cached at JOIN: drawers subscribe only once
-- the authoritative room is in playing state, and must rejoin each round.
create or replace function private.is_pictionary_draw_topic_member(p_topic text)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.has_active_session() and exists(
    select 1
    from public.pictionary_rooms r
    join public.pictionary_players p on p.room_id=r.id
    join public.pictionary_rounds rd
      on rd.room_id=r.id and rd.round_no=r.current_round_no
    where p.user_id=(select auth.uid()) and p.active
      and r.status='playing' and rd.status='drawing'
      and p_topic='pictionary-draw:'||r.id::text||':'||rd.id::text||':'||r.realtime_token::text
  );
$$;
create or replace function private.is_pictionary_draw_topic_drawer(p_topic text)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.has_active_session() and exists(
    select 1
    from public.pictionary_rooms r
    join public.pictionary_players p on p.room_id=r.id
    join public.pictionary_rounds rd
      on rd.room_id=r.id and rd.round_no=r.current_round_no
    where p.user_id=(select auth.uid()) and p.active
      and r.status='playing' and rd.status='drawing'
      and r.current_drawer_user_id=(select auth.uid())
      and rd.drawer_user_id=(select auth.uid())
      and p_topic='pictionary-draw:'||r.id::text||':'||rd.id::text||':'||r.realtime_token::text
  );
$$;
revoke all on function private.is_pictionary_draw_topic_member(text) from public,anon,authenticated;
revoke all on function private.is_pictionary_draw_topic_drawer(text) from public,anon,authenticated;
grant execute on function private.is_pictionary_draw_topic_member(text) to authenticated;
grant execute on function private.is_pictionary_draw_topic_drawer(text) to authenticated;

drop policy if exists "pictionary draw receive realtime" on realtime.messages;
create policy "pictionary draw receive realtime"
on realtime.messages for select to authenticated
using(extension='broadcast'
  and private.is_pictionary_draw_topic_member((select realtime.topic())));

drop policy if exists "pictionary draw send realtime" on realtime.messages;
create policy "pictionary draw send realtime"
on realtime.messages for insert to authenticated
with check(extension='broadcast'
  and private.is_pictionary_draw_topic_drawer((select realtime.topic())));

-- Room channel cannot publish drawings; only per-round draw channel can.
drop policy if exists "pictionary members send realtime" on realtime.messages;
create policy "pictionary members send realtime"
on realtime.messages for insert to authenticated
with check(
  private.is_pictionary_topic_member((select realtime.topic()))
  and (
    extension='presence'
    or (extension='broadcast' and event=any(array[
      'state_changed'::text,'sync_request'::text,'ping'::text,'pong'::text
    ]))
  )
);
commit;
