-- Blackjack match history + scheduled lifecycle cleanup.
-- Completed/abandoned match summaries are retained for 180 days.
-- Transient rooms are removed 24 hours after they end.

alter table public.blackjack_rooms
  add column if not exists match_id uuid;

create table if not exists private.blackjack_match_history (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null,
  room_code text not null check (room_code ~ '^[A-Z2-9]{6}$'),
  round_limit smallint not null check (round_limit in (3,5,10)),
  status text not null default 'playing'
    check (status in ('playing','finished','abandoned','closed')),
  participant_user_ids uuid[] not null,
  players jsonb not null default '[]'::jsonb,
  rounds jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  expires_at timestamptz not null default (clock_timestamp()+interval '180 days'),
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists blackjack_match_history_participants_idx
  on private.blackjack_match_history using gin(participant_user_ids);
create index if not exists blackjack_match_history_finished_idx
  on private.blackjack_match_history(finished_at desc);
create index if not exists blackjack_match_history_room_idx
  on private.blackjack_match_history(room_id);

revoke all on private.blackjack_match_history from public,anon,authenticated;
grant select,insert,update,delete on private.blackjack_match_history to service_role;

create or replace function private.blackjack_history_players(p_room_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'user_id', p.user_id,
      'member_id', coalesce(m.id::text,p.user_id::text),
      'nickname', coalesce(m.nickname,p.display_name),
      'color', coalesce(m.color,'#8EC5FF'),
      'seat', p.seat,
      'score', p.score,
      'hand_cards', to_jsonb(p.hand_cards),
      'hand_value', p.hand_value,
      'hand_status', p.hand_status,
      'round_delta', p.round_delta,
      'result', p.result
    )
    order by p.seat
  ),'[]'::jsonb)
  from public.blackjack_players p
  left join public.members m on m.user_id=p.user_id
  where p.room_id=p_room_id and p.active;
$$;

create or replace function private.blackjack_record_round_locked(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.blackjack_rooms%rowtype;
  v_secret private.blackjack_secrets%rowtype;
  v_round jsonb;
begin
  select * into v_room from public.blackjack_rooms where id=p_room_id;
  if not found or v_room.match_id is null or v_room.phase<>'settlement' then return; end if;

  if exists (
    select 1
    from private.blackjack_match_history h,
         lateral jsonb_array_elements(h.rounds) r
    where h.id=v_room.match_id
      and coalesce((r->>'round')::integer,-1)=v_room.current_round
  ) then
    return;
  end if;

  select * into v_secret
  from private.blackjack_secrets
  where room_id=p_room_id;

  v_round:=jsonb_build_object(
    'round',v_room.current_round,
    'dealer',jsonb_build_object(
      'cards',coalesce(to_jsonb(v_secret.dealer_cards),'[]'::jsonb),
      'value',v_room.dealer_value,
      'status',v_room.dealer_status
    ),
    'players',private.blackjack_history_players(p_room_id),
    'settled_at',clock_timestamp()
  );

  update private.blackjack_match_history
  set rounds=rounds||jsonb_build_array(v_round),
      players=private.blackjack_history_players(p_room_id),
      updated_at=clock_timestamp()
  where id=v_room.match_id and status='playing';
end;
$$;

create or replace function private.blackjack_finalize_match(p_room_id uuid,p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match_id uuid;
begin
  if p_status not in ('finished','abandoned','closed') then
    raise exception 'invalid match status';
  end if;

  select match_id into v_match_id
  from public.blackjack_rooms
  where id=p_room_id;

  if v_match_id is null then return; end if;

  update private.blackjack_match_history
  set status=p_status,
      players=private.blackjack_history_players(p_room_id),
      finished_at=coalesce(finished_at,clock_timestamp()),
      expires_at=clock_timestamp()+interval '180 days',
      updated_at=clock_timestamp()
  where id=v_match_id and status='playing';
end;
$$;

create or replace function public.blackjack_history_service(p_user_id uuid,p_limit integer default 12)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(h) order by coalesce(h.finished_at,h.updated_at) desc),'[]'::jsonb)
  from (
    select
      id,room_code,round_limit,status,players,rounds,started_at,finished_at
    from private.blackjack_match_history
    where p_user_id=any(participant_user_ids)
      and status in ('finished','abandoned','closed')
    order by coalesce(finished_at,updated_at) desc
    limit greatest(1,least(coalesce(p_limit,12),20))
  ) h;
$$;

create or replace function public.blackjack_finalize_match_service(p_room_id uuid,p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.blackjack_finalize_match(p_room_id,p_status);
end;
$$;

create or replace function private.blackjack_cleanup()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actions integer:=0;
  v_rooms integer:=0;
  v_history integer:=0;
  v_cron_logs integer:=0;
  v_job_id bigint;
begin
  delete from private.blackjack_actions
  where created_at<clock_timestamp()-interval '1 day';
  get diagnostics v_actions=row_count;

  delete from public.blackjack_rooms
  where status in ('finished','closed','abandoned')
    and coalesce(finished_at,updated_at)<clock_timestamp()-interval '24 hours';
  get diagnostics v_rooms=row_count;

  delete from private.blackjack_match_history
  where expires_at<clock_timestamp();
  get diagnostics v_history=row_count;

  select jobid into v_job_id
  from cron.job
  where jobname='blackjack-daily-cleanup'
  limit 1;

  if v_job_id is not null then
    delete from cron.job_run_details
    where jobid=v_job_id
      and start_time<clock_timestamp()-interval '30 days';
    get diagnostics v_cron_logs=row_count;
  end if;

  return jsonb_build_object(
    'actions_deleted',v_actions,
    'rooms_deleted',v_rooms,
    'history_deleted',v_history,
    'cron_logs_deleted',v_cron_logs,
    'ran_at',clock_timestamp()
  );
end;
$$;

revoke all on function private.blackjack_history_players(uuid) from public,anon,authenticated;
revoke all on function private.blackjack_record_round_locked(uuid) from public,anon,authenticated;
revoke all on function private.blackjack_finalize_match(uuid,text) from public,anon,authenticated;
revoke all on function private.blackjack_cleanup() from public,anon,authenticated;

revoke all on function public.blackjack_history_service(uuid,integer) from public,anon,authenticated;
revoke all on function public.blackjack_finalize_match_service(uuid,text) from public,anon,authenticated;
grant execute on function public.blackjack_history_service(uuid,integer) to service_role;
grant execute on function public.blackjack_finalize_match_service(uuid,text) to service_role;

create or replace function public.blackjack_start_game_service(
  p_room_id uuid,p_user_id uuid,p_deck text[],p_action_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.blackjack_rooms%rowtype;
  v_count integer;
  v_rows integer;
  v_match_id uuid:=gen_random_uuid();
  v_participants uuid[];
begin
  if exists(select 1 from private.blackjack_actions where action_id=p_action_id and room_id=p_room_id and user_id=p_user_id) then
    return private.blackjack_public_state(p_room_id);
  end if;

  select * into v_room from public.blackjack_rooms where id=p_room_id for update;
  if not found then raise exception '房间不存在'; end if;
  if v_room.host_user_id<>p_user_id then raise exception '只有房主可以开始'; end if;
  if v_room.status<>'lobby' then raise exception '游戏已经开始'; end if;

  select count(*),array_agg(user_id order by seat)
  into v_count,v_participants
  from public.blackjack_players
  where room_id=p_room_id and active;

  if v_count<2 or v_count>3 then raise exception '需要 2 至 3 名玩家'; end if;
  if exists(select 1 from public.blackjack_players where room_id=p_room_id and active and user_id<>p_user_id and not ready) then
    raise exception '还有玩家未准备';
  end if;

  insert into private.blackjack_actions(action_id,room_id,user_id,action)
  values(p_action_id,p_room_id,p_user_id,'start_game')
  on conflict do nothing;
  get diagnostics v_rows=row_count;
  if v_rows=0 then return private.blackjack_public_state(p_room_id); end if;

  delete from private.blackjack_actions
  where room_id=p_room_id and created_at<clock_timestamp()-interval '1 day';

  update public.blackjack_players
  set score=0,round_delta=0,result=null,updated_at=clock_timestamp()
  where room_id=p_room_id and active;

  insert into private.blackjack_match_history(
    id,room_id,room_code,round_limit,status,participant_user_ids,players,started_at,expires_at,updated_at
  )
  values(
    v_match_id,p_room_id,v_room.room_code,v_room.round_limit,'playing',
    v_participants,private.blackjack_history_players(p_room_id),
    clock_timestamp(),clock_timestamp()+interval '180 days',clock_timestamp()
  );

  update public.blackjack_rooms
  set match_id=v_match_id
  where id=p_room_id;

  perform private.blackjack_start_round_locked(p_room_id,p_deck);
  perform private.blackjack_settle_locked(p_room_id);
  perform private.blackjack_broadcast_state(p_room_id);
  return private.blackjack_public_state(p_room_id);
end;
$$;

create or replace function private.blackjack_settle_locked(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.blackjack_rooms%rowtype;
  v_secret private.blackjack_secrets%rowtype;
  v_cards text[];
  v_index integer;
  v_dealer_value integer;
  v_dealer_bj boolean;
  v_player record;
  v_delta integer;
  v_result text;
  v_non_bust integer;
begin
  select * into v_room from public.blackjack_rooms where id=p_room_id for update;
  if not found or v_room.phase<>'player_action' then return; end if;

  if exists (
    select 1 from public.blackjack_players
    where room_id=p_room_id and active and hand_status='active'
  ) then return; end if;

  select * into v_secret from private.blackjack_secrets where room_id=p_room_id for update;
  if not found then raise exception '牌局状态缺失'; end if;

  v_cards:=v_secret.dealer_cards;
  v_index:=v_secret.draw_index;

  select count(*) into v_non_bust
  from public.blackjack_players
  where room_id=p_room_id and active and hand_status<>'bust';

  if v_non_bust>0 then
    while private.blackjack_hand_value(v_cards)<17 loop
      if v_index>52 then raise exception '牌堆已耗尽'; end if;
      v_cards:=v_cards||v_secret.deck[v_index];
      v_index:=v_index+1;
    end loop;
  end if;

  v_dealer_value:=private.blackjack_hand_value(v_cards);
  v_dealer_bj:=private.blackjack_is_blackjack(v_cards);

  for v_player in
    select user_id,hand_value,hand_status
    from public.blackjack_players
    where room_id=p_room_id and active
    for update
  loop
    if v_player.hand_status='bust' then
      v_delta:=-1;
    elsif v_dealer_bj and v_player.hand_status='blackjack' then
      v_delta:=0;
    elsif v_dealer_bj then
      v_delta:=-1;
    elsif v_player.hand_status='blackjack' then
      v_delta:=3;
    elsif v_dealer_value>21 then
      v_delta:=2;
    elsif v_player.hand_value>v_dealer_value then
      v_delta:=2;
    elsif v_player.hand_value=v_dealer_value then
      v_delta:=0;
    else
      v_delta:=-1;
    end if;

    v_result:=case when v_delta>0 then 'win' when v_delta=0 then 'push' else 'loss' end;

    update public.blackjack_players
    set score=score+v_delta,round_delta=v_delta,result=v_result,
        decision_deadline=null,updated_at=clock_timestamp()
    where room_id=p_room_id and user_id=v_player.user_id;
  end loop;

  update private.blackjack_secrets
  set dealer_cards=v_cards,draw_index=v_index,updated_at=clock_timestamp()
  where room_id=p_room_id;

  update public.blackjack_rooms
  set phase='settlement',
      dealer_value=v_dealer_value,
      dealer_status=case when v_dealer_bj then 'blackjack' when v_dealer_value>21 then 'bust' else 'stand' end,
      summary_until=clock_timestamp()+interval '5 seconds',
      version=version+1,
      last_activity_at=clock_timestamp(),
      updated_at=clock_timestamp()
  where id=p_room_id;

  perform private.blackjack_record_round_locked(p_room_id);
end;
$$;

create or replace function public.blackjack_advance_service(
  p_room_id uuid,p_user_id uuid,p_deck text[],p_action_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.blackjack_rooms%rowtype;
  v_rows integer;
begin
  if exists(select 1 from private.blackjack_actions where action_id=p_action_id and room_id=p_room_id and user_id=p_user_id) then
    return private.blackjack_public_state(p_room_id);
  end if;

  select * into v_room from public.blackjack_rooms where id=p_room_id for update;
  if not found then raise exception '房间不存在'; end if;
  if not exists(select 1 from public.blackjack_players where room_id=p_room_id and user_id=p_user_id and active) then
    raise exception '你不在这个房间';
  end if;
  if v_room.phase<>'settlement' then return private.blackjack_public_state(p_room_id); end if;
  if v_room.summary_until is not null and v_room.summary_until>clock_timestamp() then
    return private.blackjack_public_state(p_room_id);
  end if;

  insert into private.blackjack_actions(action_id,room_id,user_id,action)
  values(p_action_id,p_room_id,p_user_id,'advance')
  on conflict do nothing;
  get diagnostics v_rows=row_count;
  if v_rows=0 then return private.blackjack_public_state(p_room_id); end if;

  if v_room.current_round>=v_room.round_limit then
    update public.blackjack_rooms
    set status='finished',phase='finished',summary_until=null,finished_at=clock_timestamp(),
        version=version+1,last_activity_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=p_room_id;

    perform private.blackjack_finalize_match(p_room_id,'finished');
  else
    perform private.blackjack_start_round_locked(p_room_id,p_deck);
    perform private.blackjack_settle_locked(p_room_id);
  end if;

  perform private.blackjack_broadcast_state(p_room_id);
  return private.blackjack_public_state(p_room_id);
end;
$$;

create or replace function public.blackjack_play_again_service(p_room_id uuid,p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.blackjack_rooms%rowtype;
begin
  select * into v_room from public.blackjack_rooms where id=p_room_id for update;
  if not found then raise exception '房间不存在'; end if;
  if v_room.host_user_id<>p_user_id then raise exception '只有房主可以发起下一场'; end if;
  if v_room.status<>'finished' then raise exception '当前不能重新开始'; end if;

  delete from private.blackjack_secrets where room_id=p_room_id;
  delete from private.blackjack_actions where room_id=p_room_id;

  update public.blackjack_players
  set score=0,hand_cards='{}'::text[],hand_value=null,hand_status='none',round_delta=0,result=null,
      decision_deadline=null,action_token=null,ready=(user_id=p_user_id),updated_at=clock_timestamp()
  where room_id=p_room_id and active;

  update public.blackjack_rooms
  set status='lobby',current_round=0,phase='lobby',
      dealer_up_card=null,dealer_value=null,dealer_status='hidden',
      summary_until=null,finished_at=null,closed_reason=null,match_id=null,
      version=version+1,last_activity_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=p_room_id;

  perform private.blackjack_broadcast_state(p_room_id);
  return private.blackjack_public_state(p_room_id);
end;
$$;

select cron.schedule(
  'blackjack-daily-cleanup',
  '30 18 * * *',
  'select private.blackjack_cleanup();'
);
