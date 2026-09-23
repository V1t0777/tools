-- Defense in depth: membership, immutable token claims and serialized issuance.
create or replace function private.flappy_guard_run()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.members m join auth.users u on u.id=m.user_id
    where m.id=new.member_id and m.user_id=new.user_id
      and lower(btrim(coalesce(u.email,''))) <> 'test@test.com'
  ) then
    raise exception 'FLAPPY_MEMBER_INELIGIBLE' using errcode='42501';
  end if;
  if tg_op='INSERT' then
    perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 71023));
    if exists(select 1 from public.flappy_runs where user_id=new.user_id and created_at > clock_timestamp()-interval '800 milliseconds') then
      raise exception 'FLAPPY_RUN_RATE_LIMIT' using errcode='P0001';
    end if;
    if new.submitted_at is not null or new.verified then
      raise exception 'FLAPPY_RUN_MUST_START_PENDING';
    end if;
  else
    if old.submitted_at is not null then raise exception 'FLAPPY_RUN_ALREADY_SUBMITTED'; end if;
    if row(new.id,new.user_id,new.member_id,new.run_token_hash,new.bird_skin,new.game_version,new.started_at,new.expires_at,new.created_at)
       is distinct from row(old.id,old.user_id,old.member_id,old.run_token_hash,old.bird_skin,old.game_version,old.started_at,old.expires_at,old.created_at) then
      raise exception 'FLAPPY_RUN_IDENTITY_IMMUTABLE';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.flappy_guard_run() from public,anon,authenticated,service_role;
create trigger flappy_runs_guard before insert or update on public.flappy_runs
for each row execute function private.flappy_guard_run();

-- Aggregates are changed only by the private trigger; cleanup runs as its owner.
revoke insert,update,delete on public.flappy_best_scores,public.flappy_weekly_bests from service_role;
revoke delete on public.flappy_runs from service_role;

