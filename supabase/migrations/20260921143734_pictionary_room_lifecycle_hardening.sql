
create or replace function private.is_pictionary_topic_member(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_active_session() and exists(
    select 1
    from public.pictionary_players pp
    join public.members m on m.user_id = pp.user_id
    join public.pictionary_rooms pr on pr.id = pp.room_id
    where pp.user_id = (select auth.uid())
      and pp.active
      and pr.status not in ('closed','abandoned')
      and p_topic = 'pictionary:' || pp.room_id::text
  );
$$;

create or replace function private.pictionary_room_maintenance()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_ids uuid[];
begin
  update public.pictionary_rounds rd
  set status = 'ended',
      ended_at = coalesce(rd.ended_at, now())
  from public.pictionary_rooms r
  where r.status = 'playing'
    and r.ends_at is not null
    and r.ends_at <= now()
    and rd.room_id = r.id
    and rd.round_no = r.current_round_no
    and rd.status <> 'ended';

  update public.pictionary_rooms
  set status = 'summary',
      ends_at = null,
      summary_until = now() + interval '6 seconds',
      updated_at = now()
  where status = 'playing'
    and ends_at is not null
    and ends_at <= now();

  with changed as (
    update public.pictionary_rooms
    set status = 'abandoned',
        closed_reason = case
          when status = 'lobby' then 'lobby_timeout'
          when status = 'choosing' then 'choosing_timeout'
          else 'inactive_game'
        end,
        current_drawer_user_id = null,
        ends_at = null,
        summary_until = null,
        finished_at = coalesce(finished_at, now()),
        updated_at = now()
    where
      (status = 'lobby' and last_activity_at < now() - interval '30 minutes')
      or
      (status = 'choosing' and last_activity_at < now() - interval '10 minutes')
      or
      (status = 'summary' and summary_until is not null and summary_until <= now()
       and last_activity_at < now() - interval '10 minutes')
    returning id
  )
  select array_agg(id) into changed_ids from changed;

  if changed_ids is not null then
    update public.pictionary_players
    set active = false,
        updated_at = now()
    where room_id = any(changed_ids);
  end if;

  delete from public.pictionary_rooms
  where status in ('closed','abandoned')
    and coalesce(finished_at, updated_at) < now() - interval '24 hours';

  delete from public.pictionary_rooms
  where status = 'finished'
    and coalesce(finished_at, updated_at) < now() - interval '7 days';
end;
$$;

revoke all on function private.pictionary_room_maintenance() from public, anon, authenticated;

