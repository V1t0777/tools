-- Flappy Bird online friend leaderboard.
-- All writes are server-side only. Raw runs are retained only while they are
-- needed by the all-time or current-week best aggregates.

create schema if not exists private;

create table public.flappy_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  run_token_hash text not null unique check (run_token_hash ~ '^[0-9a-f]{64}$'),
  score integer check (score between 0 and 200),
  duration_ms integer check (duration_ms between 250 and 1200000),
  bird_skin text not null check (bird_skin in ('warm','slate')),
  game_version text not null check (char_length(game_version) between 1 and 64),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  submitted_at timestamptz,
  verified boolean not null default false,
  rejection_reason text check (rejection_reason is null or char_length(rejection_reason) <= 80),
  created_at timestamptz not null default now(),
  constraint flappy_runs_verified_shape check (
    not verified or (submitted_at is not null and score is not null and duration_ms is not null and rejection_reason is null)
  )
);

create table public.flappy_best_scores (
  user_id uuid primary key references auth.users(id) on delete cascade,
  member_id uuid not null unique references public.members(id) on delete cascade,
  best_score integer not null check (best_score between 0 and 200),
  best_run_id uuid references public.flappy_runs(id) on delete set null,
  bird_skin text not null check (bird_skin in ('warm','slate')),
  achieved_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table public.flappy_weekly_bests (
  week_start date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  best_score integer not null check (best_score between 0 and 200),
  best_run_id uuid references public.flappy_runs(id) on delete set null,
  bird_skin text not null check (bird_skin in ('warm','slate')),
  achieved_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (week_start,user_id),
  unique (week_start,member_id)
);

create index flappy_runs_user_created_idx on public.flappy_runs(user_id,created_at desc);
create index flappy_runs_cleanup_idx on public.flappy_runs(verified,submitted_at,expires_at);
create index flappy_best_rank_idx on public.flappy_best_scores(best_score desc,achieved_at asc);
create index flappy_weekly_rank_idx on public.flappy_weekly_bests(week_start,best_score desc,achieved_at asc);

alter table public.flappy_runs enable row level security;
alter table public.flappy_best_scores enable row level security;
alter table public.flappy_weekly_bests enable row level security;

revoke all on table public.flappy_runs from public,anon,authenticated;
revoke all on table public.flappy_best_scores from public,anon,authenticated;
revoke all on table public.flappy_weekly_bests from public,anon,authenticated;

grant select,insert,update,delete on table public.flappy_runs to service_role;
grant select,insert,update,delete on table public.flappy_best_scores to service_role;
grant select,insert,update,delete on table public.flappy_weekly_bests to service_role;

create or replace function private.flappy_update_bests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_week_start date;
begin
  if not new.verified or coalesce(old.verified,false) then
    return new;
  end if;

  v_week_start := date_trunc('week', timezone('Asia/Shanghai',new.submitted_at))::date;

  insert into public.flappy_best_scores(
    user_id,member_id,best_score,best_run_id,bird_skin,achieved_at,updated_at
  ) values (
    new.user_id,new.member_id,new.score,new.id,new.bird_skin,new.submitted_at,now()
  )
  on conflict (user_id) do update
    set member_id=excluded.member_id,
        best_score=excluded.best_score,
        best_run_id=excluded.best_run_id,
        bird_skin=excluded.bird_skin,
        achieved_at=excluded.achieved_at,
        updated_at=now()
  where excluded.best_score > public.flappy_best_scores.best_score;

  insert into public.flappy_weekly_bests(
    week_start,user_id,member_id,best_score,best_run_id,bird_skin,achieved_at,updated_at
  ) values (
    v_week_start,new.user_id,new.member_id,new.score,new.id,new.bird_skin,new.submitted_at,now()
  )
  on conflict (week_start,user_id) do update
    set member_id=excluded.member_id,
        best_score=excluded.best_score,
        best_run_id=excluded.best_run_id,
        bird_skin=excluded.bird_skin,
        achieved_at=excluded.achieved_at,
        updated_at=now()
  where excluded.best_score > public.flappy_weekly_bests.best_score;

  return new;
end;
$$;

revoke all on function private.flappy_update_bests() from public,anon,authenticated;

create trigger flappy_runs_update_bests
after update of verified on public.flappy_runs
for each row
when (new.verified and not old.verified)
execute function private.flappy_update_bests();

create or replace function private.flappy_cleanup()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_week_start date := date_trunc('week',timezone('Asia/Shanghai',now()))::date;
  v_weekly_deleted integer := 0;
  v_runs_deleted integer := 0;
begin
  delete from public.flappy_weekly_bests
  where week_start < v_week_start;
  get diagnostics v_weekly_deleted = row_count;

  delete from public.flappy_runs r
  where
    (r.submitted_at is null and r.expires_at < now())
    or (r.submitted_at is not null and not r.verified and r.submitted_at < now() - interval '2 hours')
    or (
      r.verified
      and not exists (select 1 from public.flappy_best_scores b where b.best_run_id=r.id)
      and not exists (select 1 from public.flappy_weekly_bests w where w.best_run_id=r.id)
    );
  get diagnostics v_runs_deleted = row_count;

  return jsonb_build_object('runs_deleted',v_runs_deleted,'weekly_deleted',v_weekly_deleted);
end;
$$;

revoke all on function private.flappy_cleanup() from public,anon,authenticated;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in select jobid from cron.job where jobname='flappy-minimal-history-cleanup'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end
$$;

select cron.schedule(
  'flappy-minimal-history-cleanup',
  '10 19 * * *',
  'select private.flappy_cleanup();'
);

comment on table public.flappy_runs is 'Server-issued Flappy runs. Browser roles have no direct access.';
comment on table public.flappy_best_scores is 'One authoritative all-time best score per eligible member.';
comment on table public.flappy_weekly_bests is 'One current-week best score per eligible member; old weeks are removed daily.';

