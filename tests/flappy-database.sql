-- Run as migration/admin owner. Transaction always rolls back fixture changes.
begin;
do $$
declare
  m public.members%rowtype;
  t public.members%rowtype;
  r uuid;
  winner uuid;
  n integer;
  v_score integer;
begin
  select members.* into strict m from public.members join auth.users u on u.id=members.user_id where lower(u.email)<>'test@test.com' limit 1;
  select members.* into strict t from public.members join auth.users u on u.id=members.user_id where lower(u.email)='test@test.com' limit 1;
  -- Fixtures use old created_at to avoid exercising the rate guard in this loop.
  foreach v_score in array array[4,9,6] loop
    insert into public.flappy_runs(user_id,member_id,run_token_hash,bird_skin,game_version,started_at,created_at,expires_at)
    values(m.user_id,m.id,encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex'),'warm','2026.09.23-leaderboard-v1',now()-interval '30 seconds',now()-interval '2 minutes',now()+interval '10 minutes') returning id into r;
    update public.flappy_runs set score=v_score,duration_ms=30000,submitted_at=now(),verified=true where id=r;
    if v_score=9 then winner:=r; end if;
    begin
      update public.flappy_runs set score=100 where id=r;
      raise exception 'ASSERT: consumed token accepted';
    exception when raise_exception then
      if sqlerrm<>'FLAPPY_RUN_ALREADY_SUBMITTED' then raise; end if;
    end;
  end loop;
  select count(*) into n from public.flappy_best_scores where user_id=m.user_id and best_score>=9;
  assert n=1,'all-time unique maximum';
  select count(*) into n from public.flappy_weekly_bests where user_id=m.user_id and best_score>=9 and week_start=date_trunc('week',timezone('Asia/Shanghai',now()))::date;
  assert n=1,'weekly unique maximum';
  perform private.flappy_cleanup();
  assert not exists(select 1 from public.flappy_runs where user_id=m.user_id and verified and id<>winner and score in (4,6) and created_at=now()-interval '2 minutes'),'nonbest fixtures cleaned';
  begin
    insert into public.flappy_runs(user_id,member_id,run_token_hash,bird_skin,game_version,expires_at)
    values(t.user_id,t.id,repeat('b',64),'warm','2026.09.23-leaderboard-v1',now()+interval '10 minutes');
    raise exception 'ASSERT: test member accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.flappy_runs(user_id,member_id,run_token_hash,bird_skin,game_version,expires_at)
    values(m.user_id,t.id,repeat('c',64),'warm','2026.09.23-leaderboard-v1',now()+interval '10 minutes');
    raise exception 'ASSERT: mismatched member accepted';
  exception when insufficient_privilege then null;
  end;
  insert into public.flappy_runs(user_id,member_id,run_token_hash,bird_skin,game_version,expires_at)
  values(m.user_id,m.id,repeat('d',64),'slate','2026.09.23-leaderboard-v1',now()+interval '10 minutes');
  begin
    insert into public.flappy_runs(user_id,member_id,run_token_hash,bird_skin,game_version,expires_at)
    values(m.user_id,m.id,repeat('e',64),'slate','2026.09.23-leaderboard-v1',now()+interval '10 minutes');
    raise exception 'ASSERT: rate guard missed';
  exception when raise_exception then
    if sqlerrm<>'FLAPPY_RUN_RATE_LIMIT' then raise; end if;
  end;
end;
$$;
set local role anon;
do $$ begin
  begin perform * from public.flappy_best_scores; raise exception 'ASSERT: anon read'; exception when insufficient_privilege then null; end;
  begin insert into public.flappy_runs default values; raise exception 'ASSERT: anon write'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin perform * from public.flappy_runs; raise exception 'ASSERT: authenticated read'; exception when insufficient_privilege then null; end;
  begin update public.flappy_best_scores set best_score=200; raise exception 'ASSERT: authenticated write'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role service_role;
do $$ begin
  perform * from public.flappy_best_scores;
  begin update public.flappy_best_scores set best_score=200; raise exception 'ASSERT: direct service aggregate write'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: aggregates, cleanup, identity, test exclusion, token, rate, anon/auth/service grants' as result;
rollback;

