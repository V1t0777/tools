
create table if not exists public.stack_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  run_token_hash text not null unique check (run_token_hash ~ '^[0-9a-f]{64}$'),
  theme_id text not null check (theme_id in ('night','sand','slate','forest')),
  game_version text not null check (char_length(game_version) between 1 and 64),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  height smallint check (height between 0 and 200),
  perfect_count smallint check (perfect_count between 0 and 200),
  max_combo smallint check (max_combo between 0 and 200),
  duration_ms integer check (duration_ms between 250 and 1200000),
  submitted_at timestamptz,
  verified boolean not null default false,
  rejection_reason text check (rejection_reason is null or char_length(rejection_reason) <= 80),
  created_at timestamptz not null default now(),
  constraint stack_runs_perfect_lte_height check (perfect_count is null or height is null or perfect_count <= height),
  constraint stack_runs_combo_lte_perfect check (max_combo is null or perfect_count is null or max_combo <= perfect_count),
  constraint stack_runs_verified_shape check (
    not verified or (
      submitted_at is not null
      and height is not null
      and perfect_count is not null
      and max_combo is not null
      and duration_ms is not null
      and rejection_reason is null
    )
  )
);

create table if not exists public.stack_best_scores (
  user_id uuid primary key references auth.users(id) on delete cascade,
  member_id uuid not null unique references public.members(id) on delete cascade,
  best_height smallint not null check (best_height between 0 and 200),
  perfect_count smallint not null check (perfect_count between 0 and 200),
  max_combo smallint not null check (max_combo between 0 and 200),
  theme_id text not null check (theme_id in ('night','sand','slate','forest')),
  best_run_id uuid references public.stack_runs(id) on delete set null,
  achieved_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint stack_best_perfect_lte_height check (perfect_count <= best_height),
  constraint stack_best_combo_lte_perfect check (max_combo <= perfect_count)
);

create index if not exists stack_runs_user_created_idx
  on public.stack_runs(user_id, created_at desc);
create index if not exists stack_runs_expiry_idx
  on public.stack_runs(expires_at)
  where submitted_at is null;
create index if not exists stack_best_rank_idx
  on public.stack_best_scores(best_height desc, perfect_count desc, max_combo desc, achieved_at asc);

alter table public.stack_runs enable row level security;
alter table public.stack_best_scores enable row level security;

revoke all on table public.stack_runs from public, anon, authenticated;
revoke all on table public.stack_best_scores from public, anon, authenticated;
grant select, insert, update on table public.stack_runs to service_role;
grant select on table public.stack_best_scores to service_role;

create table if not exists private.stack_rate_limits (
  action text not null,
  client_hash text not null,
  bucket_start timestamptz not null,
  hit_count integer not null default 0 check (hit_count >= 0),
  expires_at timestamptz not null,
  primary key (action, client_hash, bucket_start),
  check (char_length(action) between 1 and 40),
  check (client_hash ~ '^[0-9a-f]{64}$')
);

alter table private.stack_rate_limits enable row level security;
revoke all on table private.stack_rate_limits from public, anon, authenticated, service_role;

create or replace function public.stack_rate_limit_check(
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

  delete from private.stack_rate_limits where expires_at < v_now;

  insert into private.stack_rate_limits(action, client_hash, bucket_start, hit_count, expires_at)
  values (
    p_action,
    p_key,
    v_bucket_start,
    1,
    v_bucket_start + make_interval(secs => p_window_seconds * 2)
  )
  on conflict (action, client_hash, bucket_start)
  do update set
    hit_count = private.stack_rate_limits.hit_count + 1,
    expires_at = excluded.expires_at
  returning hit_count into v_count;

  return v_count <= p_limit;
end;
$function$;

revoke all on function public.stack_rate_limit_check(text,text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.stack_rate_limit_check(text,text,integer,integer)
  to service_role;

create or replace function private.stack_guard_run()
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
    raise exception 'STACK_MEMBER_INELIGIBLE' using errcode='42501';
  end if;

  if tg_op='INSERT' then
    perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 81024));
    if exists(
      select 1 from public.stack_runs
      where user_id = new.user_id
        and created_at > clock_timestamp() - interval '800 milliseconds'
    ) then
      raise exception 'STACK_RUN_RATE_LIMIT' using errcode='P0001';
    end if;
    if new.submitted_at is not null or new.verified then
      raise exception 'STACK_RUN_MUST_START_PENDING';
    end if;
  else
    if old.submitted_at is not null then
      raise exception 'STACK_RUN_ALREADY_SUBMITTED';
    end if;
    if row(new.id,new.user_id,new.member_id,new.run_token_hash,new.theme_id,new.game_version,new.started_at,new.expires_at,new.created_at)
       is distinct from
       row(old.id,old.user_id,old.member_id,old.run_token_hash,old.theme_id,old.game_version,old.started_at,old.expires_at,old.created_at) then
      raise exception 'STACK_RUN_IDENTITY_IMMUTABLE';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function private.stack_guard_run()
  from public, anon, authenticated, service_role;

drop trigger if exists stack_runs_guard on public.stack_runs;
create trigger stack_runs_guard
before insert or update on public.stack_runs
for each row execute function private.stack_guard_run();

create or replace function private.stack_update_best()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not new.verified or coalesce(old.verified,false) then
    return new;
  end if;

  insert into public.stack_best_scores(
    user_id, member_id, best_height, perfect_count, max_combo,
    theme_id, best_run_id, achieved_at, updated_at
  ) values (
    new.user_id, new.member_id, new.height, new.perfect_count, new.max_combo,
    new.theme_id, new.id, new.submitted_at, now()
  )
  on conflict (user_id) do update set
    member_id = excluded.member_id,
    best_height = excluded.best_height,
    perfect_count = excluded.perfect_count,
    max_combo = excluded.max_combo,
    theme_id = excluded.theme_id,
    best_run_id = excluded.best_run_id,
    achieved_at = excluded.achieved_at,
    updated_at = now()
  where
    (excluded.best_height, excluded.perfect_count, excluded.max_combo)
    >
    (public.stack_best_scores.best_height, public.stack_best_scores.perfect_count, public.stack_best_scores.max_combo);

  return new;
end;
$function$;

revoke all on function private.stack_update_best()
  from public, anon, authenticated, service_role;

drop trigger if exists stack_runs_update_best on public.stack_runs;
create trigger stack_runs_update_best
after update on public.stack_runs
for each row execute function private.stack_update_best();

create or replace function private.stack_cleanup()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_runs_deleted integer := 0;
  v_rate_deleted integer := 0;
begin
  delete from public.stack_runs r
  where
    (r.submitted_at is null and r.expires_at < now())
    or (r.submitted_at is not null and not r.verified and r.submitted_at < now() - interval '2 hours')
    or (
      r.verified
      and not exists (
        select 1 from public.stack_best_scores b where b.best_run_id = r.id
      )
    );
  get diagnostics v_runs_deleted = row_count;

  delete from private.stack_rate_limits where expires_at < now();
  get diagnostics v_rate_deleted = row_count;

  return jsonb_build_object(
    'runs_deleted', v_runs_deleted,
    'rate_rows_deleted', v_rate_deleted
  );
end;
$function$;

revoke all on function private.stack_cleanup()
  from public, anon, authenticated, service_role;

do $$
begin
  if not exists (select 1 from cron.job where jobname='stack-minimal-history-cleanup') then
    perform cron.schedule(
      'stack-minimal-history-cleanup',
      '20 19 * * *',
      'select private.stack_cleanup();'
    );
  end if;
end $$;
