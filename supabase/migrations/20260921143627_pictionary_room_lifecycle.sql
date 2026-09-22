
alter table public.pictionary_rooms
  add column if not exists last_activity_at timestamptz not null default now(),
  add column if not exists closed_reason text;

update public.pictionary_rooms
set last_activity_at = coalesce(updated_at, created_at, now())
where last_activity_at is null
   or last_activity_at > now() + interval '1 minute';

alter table public.pictionary_rooms
  drop constraint if exists pictionary_rooms_status_check;

alter table public.pictionary_rooms
  add constraint pictionary_rooms_status_check
  check (status = any (array[
    'lobby'::text,
    'choosing'::text,
    'playing'::text,
    'summary'::text,
    'finished'::text,
    'closed'::text,
    'abandoned'::text
  ]));

create index if not exists pictionary_rooms_lifecycle_idx
  on public.pictionary_rooms(status, last_activity_at);

create extension if not exists pg_cron with schema pg_catalog;

create or replace function private.pictionary_room_maintenance()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Expired active rounds are moved to summary even if every browser disappeared.
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

  -- Empty/stalled rooms become abandoned rather than living forever.
  update public.pictionary_rooms
  set status = 'abandoned',
      closed_reason = 'lobby_timeout',
      current_drawer_user_id = null,
      ends_at = null,
      summary_until = null,
      finished_at = coalesce(finished_at, now()),
      updated_at = now()
  where status = 'lobby'
    and last_activity_at < now() - interval '30 minutes';

  update public.pictionary_rooms
  set status = 'abandoned',
      closed_reason = 'choosing_timeout',
      current_drawer_user_id = null,
      ends_at = null,
      summary_until = null,
      finished_at = coalesce(finished_at, now()),
      updated_at = now()
  where status = 'choosing'
    and last_activity_at < now() - interval '10 minutes';

  update public.pictionary_rooms
  set status = 'abandoned',
      closed_reason = 'inactive_game',
      current_drawer_user_id = null,
      ends_at = null,
      summary_until = null,
      finished_at = coalesce(finished_at, now()),
      updated_at = now()
  where status = 'summary'
    and summary_until is not null
    and summary_until <= now()
    and last_activity_at < now() - interval '10 minutes';

  -- Retention: unfinished/closed rooms 24 h, normally finished rooms 7 d.
  delete from public.pictionary_rooms
  where status in ('closed','abandoned')
    and coalesce(finished_at, updated_at) < now() - interval '24 hours';

  delete from public.pictionary_rooms
  where status = 'finished'
    and coalesce(finished_at, updated_at) < now() - interval '7 days';
end;
$$;

revoke all on function private.pictionary_room_maintenance() from public, anon, authenticated;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'pictionary-room-maintenance'
  limit 1;

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  perform cron.schedule(
    'pictionary-room-maintenance',
    '*/5 * * * *',
    'select private.pictionary_room_maintenance();'
  );
end $$;

