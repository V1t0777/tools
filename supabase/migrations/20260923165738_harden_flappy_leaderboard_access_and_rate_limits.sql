
alter table public.members
  add column if not exists exclude_from_leaderboard boolean not null default false;

update public.members m
set exclude_from_leaderboard = true
from auth.users u
where u.id = m.user_id
  and lower(btrim(coalesce(u.email,''))) = 'test@example.invalid';

create table if not exists private.flappy_rate_limits (
  action text not null,
  client_hash text not null,
  bucket_start timestamptz not null,
  hit_count integer not null default 0 check (hit_count >= 0),
  expires_at timestamptz not null,
  primary key (action, client_hash, bucket_start),
  check (char_length(action) between 1 and 40),
  check (client_hash ~ '^[0-9a-f]{64}$')
);

alter table private.flappy_rate_limits enable row level security;
revoke all on table private.flappy_rate_limits from public, anon, authenticated, service_role;

create or replace function public.flappy_rate_limit_check(
  p_key text,
  p_action text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_bucket_start timestamptz;
  v_count integer;
begin
  if p_key is null or p_key !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid rate limit key';
  end if;
  if p_action is null or char_length(p_action) < 1 or char_length(p_action) > 40 then
    raise exception 'invalid rate limit action';
  end if;
  if p_limit < 1 or p_limit > 1000 or p_window_seconds < 1 or p_window_seconds > 3600 then
    raise exception 'invalid rate limit configuration';
  end if;

  v_bucket_start := to_timestamp(
    floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds
  );

  delete from private.flappy_rate_limits
  where expires_at < v_now;

  insert into private.flappy_rate_limits(action, client_hash, bucket_start, hit_count, expires_at)
  values (
    p_action,
    p_key,
    v_bucket_start,
    1,
    v_bucket_start + make_interval(secs => p_window_seconds * 2)
  )
  on conflict (action, client_hash, bucket_start)
  do update
    set hit_count = private.flappy_rate_limits.hit_count + 1,
        expires_at = excluded.expires_at
  returning hit_count into v_count;

  return v_count <= p_limit;
end;
$function$;

revoke all on function public.flappy_rate_limit_check(text,text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.flappy_rate_limit_check(text,text,integer,integer)
  to service_role;

create or replace function private.flappy_guard_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not exists (
    select 1
    from public.members m
    where m.id = new.member_id
      and m.user_id = new.user_id
      and not m.exclude_from_leaderboard
  ) then
    raise exception 'FLAPPY_MEMBER_INELIGIBLE' using errcode='42501';
  end if;

  if tg_op='INSERT' then
    perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 71023));
    if exists(
      select 1
      from public.flappy_runs
      where user_id = new.user_id
        and created_at > clock_timestamp() - interval '800 milliseconds'
    ) then
      raise exception 'FLAPPY_RUN_RATE_LIMIT' using errcode='P0001';
    end if;
    if new.submitted_at is not null or new.verified then
      raise exception 'FLAPPY_RUN_MUST_START_PENDING';
    end if;
  else
    if old.submitted_at is not null then
      raise exception 'FLAPPY_RUN_ALREADY_SUBMITTED';
    end if;
    if row(new.id,new.user_id,new.member_id,new.run_token_hash,new.bird_skin,new.game_version,new.started_at,new.expires_at,new.created_at)
       is distinct from
       row(old.id,old.user_id,old.member_id,old.run_token_hash,old.bird_skin,old.game_version,old.started_at,old.expires_at,old.created_at) then
      raise exception 'FLAPPY_RUN_IDENTITY_IMMUTABLE';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function private.flappy_guard_run() from public, anon, authenticated, service_role;

comment on column public.members.exclude_from_leaderboard is
  'When true, the member can use the toolbox but is excluded from Flappy leaderboard scoring.';
