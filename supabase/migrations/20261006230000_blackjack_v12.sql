-- Blackjack V1.2 realtime protocol, recovery support and multi-device control.
-- Normal play uses compact authoritative game events. Full snapshots remain the recovery source of truth.

create table if not exists private.blackjack_events (
  event_id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.blackjack_rooms(id) on delete cascade,
  event_type text not null check (
    event_type in (
      'lobby_changed','round_started','player_changed','players_changed',
      'round_settled','game_finished'
    )
  ),
  from_version bigint not null check (from_version >= 0),
  version bigint not null check (version > from_version),
  payload jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists blackjack_events_room_created_idx
  on private.blackjack_events(room_id,created_at desc);

create table if not exists private.blackjack_device_leases (
  room_id uuid not null references public.blackjack_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  claimed_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  primary key(room_id,user_id)
);

create index if not exists blackjack_device_leases_user_idx
  on private.blackjack_device_leases(user_id);

revoke all on private.blackjack_events from public,anon,authenticated;
revoke all on private.blackjack_device_leases from public,anon,authenticated;
grant select,insert,update,delete on private.blackjack_events to service_role;
grant select,insert,update,delete on private.blackjack_device_leases to service_role;

create or replace function private.blackjack_emit_event(
  p_room_id uuid,
  p_event_type text,
  p_from_version bigint,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state jsonb;
  v_payload jsonb;
  v_player jsonb;
  v_actor_member_id text;
  v_version bigint;
  v_event_id uuid:=gen_random_uuid();
begin
  if p_event_type not in (
    'lobby_changed','round_started','player_changed','players_changed',
    'round_settled','game_finished'
  ) then
    raise exception 'invalid blackjack event type';
  end if;

  v_state:=private.blackjack_public_state(p_room_id);
  if v_state is null then return null; end if;

  v_version:=coalesce((v_state#>>'{room,version}')::bigint,-1);
  if v_version<=p_from_version then return null; end if;

  v_payload:=jsonb_build_object(
    'event_id',v_event_id,
    'type',p_event_type,
    'room_id',p_room_id,
    'from_version',p_from_version,
    'version',v_version,
    'server_time',v_state->'server_now',
    'room',v_state->'room'
  );

  if p_event_type in ('lobby_changed','round_started','players_changed','round_settled','game_finished') then
    v_payload:=v_payload||jsonb_build_object('players',v_state->'players');
  end if;

  if p_event_type in ('round_started','round_settled','game_finished') then
    v_payload:=v_payload||jsonb_build_object('dealer',v_state->'dealer');
  end if;

  if p_event_type='player_changed' then
    if p_actor_user_id is null then raise exception 'actor required for player_changed'; end if;
    select coalesce(m.id::text,p.user_id::text)
    into v_actor_member_id
    from public.blackjack_players p
    left join public.members m on m.user_id=p.user_id
    where p.room_id=p_room_id and p.user_id=p_actor_user_id
    limit 1;

    select e.value into v_player
    from jsonb_array_elements(v_state->'players') e(value)
    where e.value->>'member_id'=v_actor_member_id
    limit 1;

    if v_player is null then raise exception 'event actor missing from room'; end if;
    v_payload:=v_payload||jsonb_build_object('player',v_player);
  end if;

  insert into private.blackjack_events(event_id,room_id,event_type,from_version,version,payload)
  values(v_event_id,p_room_id,p_event_type,p_from_version,v_version,v_payload);

  perform realtime.send(v_payload,'game_event','blackjack:'||p_room_id::text,true);
  return v_payload;
end;
$$;

create or replace function private.blackjack_assert_device(
  p_room_id uuid,
  p_user_id uuid,
  p_device_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease private.blackjack_device_leases%rowtype;
begin
  if p_device_id is null then
    raise exception using message='设备标识无效',errcode='P4092';
  end if;

  if not exists(
    select 1 from public.blackjack_players
    where room_id=p_room_id and user_id=p_user_id and active
  ) then
    raise exception '你不在这个房间';
  end if;

  select * into v_lease
  from private.blackjack_device_leases
  where room_id=p_room_id and user_id=p_user_id
  for update;

  if not found or v_lease.last_seen_at<clock_timestamp()-interval '75 seconds' then
    insert into private.blackjack_device_leases(room_id,user_id,device_id,claimed_at,last_seen_at)
    values(p_room_id,p_user_id,p_device_id,clock_timestamp(),clock_timestamp())
    on conflict(room_id,user_id) do update
      set device_id=excluded.device_id,
          claimed_at=excluded.claimed_at,
          last_seen_at=excluded.last_seen_at;
    return;
  end if;

  if v_lease.device_id<>p_device_id then
    raise exception using message='此牌局正在另一台设备操作',errcode='P4091';
  end if;

  update private.blackjack_device_leases
  set last_seen_at=clock_timestamp()
  where room_id=p_room_id and user_id=p_user_id;
end;
$$;

create or replace function public.blackjack_claim_device_service(
  p_room_id uuid,
  p_user_id uuid,
  p_device_id uuid,
  p_takeover boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease private.blackjack_device_leases%rowtype;
  v_now timestamptz:=clock_timestamp();
begin
  if p_device_id is null then raise exception '设备标识无效'; end if;

  if not exists(
    select 1
    from public.blackjack_players p
    join public.blackjack_rooms r on r.id=p.room_id
    where p.room_id=p_room_id
      and p.user_id=p_user_id
      and p.active
      and r.status not in ('closed','abandoned')
  ) then
    raise exception '你不在这个房间';
  end if;

  select * into v_lease
  from private.blackjack_device_leases
  where room_id=p_room_id and user_id=p_user_id
  for update;

  if not found then
    insert into private.blackjack_device_leases(room_id,user_id,device_id,claimed_at,last_seen_at)
    values(p_room_id,p_user_id,p_device_id,v_now,v_now);
    return jsonb_build_object('granted',true,'takeover',false,'claimed_at',v_now);
  end if;

  if v_lease.device_id=p_device_id then
    update private.blackjack_device_leases
    set last_seen_at=v_now
    where room_id=p_room_id and user_id=p_user_id;
    return jsonb_build_object('granted',true,'takeover',false,'claimed_at',v_lease.claimed_at);
  end if;

  if p_takeover or v_lease.last_seen_at<v_now-interval '75 seconds' then
    update private.blackjack_device_leases
    set device_id=p_device_id,claimed_at=v_now,last_seen_at=v_now
    where room_id=p_room_id and user_id=p_user_id;
    return jsonb_build_object('granted',true,'takeover',true,'claimed_at',v_now);
  end if;

  return jsonb_build_object(
    'granted',false,
    'reason','other_device',
    'last_seen_at',v_lease.last_seen_at
  );
end;
$$;

create or replace function public.blackjack_toggle_ready_service(p_room_id uuid,p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.blackjack_rooms%rowtype;
  v_from bigint;
begin
  select * into v_room from public.blackjack_rooms where id=p_room_id for update;
  if not found then raise exception '房间不存在'; end if;
  if v_room.status<>'lobby' then raise exception '当前不能修改准备状态'; end if;
  if v_room.host_user_id=p_user_id then raise exception '房主默认已准备'; end if;
  if not exists(select 1 from public.blackjack_players where room_id=p_room_id and user_id=p_user_id and active) then
    raise exception '你不在这个房间';
  end if;

  v_from:=v_room.version;

  update public.blackjack_players
  set ready=not ready,updated_at=clock_timestamp()
  where room_id=p_room_id and user_id=p_user_id;

  update public.blackjack_rooms
  set version=version+1,last_activity_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=p_room_id;

  perform private.blackjack_emit_event(p_room_id,'lobby_changed',v_from,null);
  return private.blackjack_public_state(p_room_id);
end;
$$;

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
  v_from bigint;
  v_phase text;
begin
  if exists(select 1 from private.blackjack_actions where action_id=p_action_id and room_id=p_room_id and user_id=p_user_id) then
    return private.blackjack_public_state(p_room_id);
  end if;

  select * into v_room from public.blackjack_rooms where id=p_room_id for update;
  if not found then raise exception '房间不存在'; end if;
  if v_room.host_user_id<>p_user_id then raise exception '只有房主可以开始'; end if;
  if v_room.status<>'lobby' then raise exception '游戏已经开始'; end if;
  v_from:=v_room.version;

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

  update public.blackjack_rooms set match_id=v_match_id where id=p_room_id;

  perform private.blackjack_start_round_locked(p_room_id,p_deck);
  perform private.blackjack_settle_locked(p_room_id);
  select phase into v_phase from public.blackjack_rooms where id=p_room_id;

  perform private.blackjack_emit_event(
    p_room_id,
    case when v_phase='settlement' then 'round_settled' else 'round_started' end,
    v_from,
    null
  );
  return private.blackjack_public_state(p_room_id);
end;
$$;

create or replace function public.blackjack_action_service(
  p_room_id uuid,p_user_id uuid,p_action text,p_expected_token uuid,p_action_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player public.blackjack_players%rowtype;
  v_secret private.blackjack_secrets%rowtype;
  v_cards text[];
  v_value integer;
  v_rows integer;
  v_room_rows integer;
  v_from bigint;
  v_phase text;
begin
  if p_action not in ('hit','stand') then raise exception '未知操作'; end if;

  if exists(
    select 1 from private.blackjack_actions
    where action_id=p_action_id and room_id=p_room_id and user_id=p_user_id
  ) then
    return private.blackjack_public_state(p_room_id);
  end if;

  select * into v_player
  from public.blackjack_players
  where room_id=p_room_id and user_id=p_user_id and active
  for update;
  if not found then raise exception '你不在这个房间'; end if;
  if v_player.hand_status<>'active' then raise exception '本轮已经完成操作'; end if;
  if v_player.action_token is distinct from p_expected_token then
    raise exception using message='操作状态已更新，请重试',errcode='40001';
  end if;

  insert into private.blackjack_actions(action_id,room_id,user_id,action)
  values(p_action_id,p_room_id,p_user_id,p_action)
  on conflict do nothing;
  get diagnostics v_rows=row_count;
  if v_rows=0 then return private.blackjack_public_state(p_room_id); end if;

  if p_action='stand' then
    update public.blackjack_players
    set hand_status='stand',decision_deadline=null,action_token=null,updated_at=clock_timestamp()
    where room_id=p_room_id and user_id=p_user_id;
  else
    select * into v_secret
    from private.blackjack_secrets
    where room_id=p_room_id
    for update;
    if not found or v_secret.draw_index>52 then raise exception '牌堆状态异常'; end if;

    v_cards:=v_player.hand_cards||v_secret.deck[v_secret.draw_index];
    v_value:=private.blackjack_hand_value(v_cards);

    update private.blackjack_secrets
    set draw_index=draw_index+1,updated_at=clock_timestamp()
    where room_id=p_room_id;

    update public.blackjack_players
    set hand_cards=v_cards,
        hand_value=v_value,
        hand_status=case when v_value>21 then 'bust' when v_value=21 then 'stand' else 'active' end,
        decision_deadline=case when v_value<21 then clock_timestamp()+interval '20 seconds' else null end,
        action_token=case when v_value<21 then gen_random_uuid() else null end,
        updated_at=clock_timestamp()
    where room_id=p_room_id and user_id=p_user_id;
  end if;

  update public.blackjack_rooms
  set version=version+1,last_activity_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=p_room_id and status='playing' and phase='player_action'
  returning version-1 into v_from;
  get diagnostics v_room_rows=row_count;
  if v_room_rows=0 then raise exception '当前不能操作'; end if;

  perform private.blackjack_settle_locked(p_room_id);
  select phase into v_phase from public.blackjack_rooms where id=p_room_id;

  perform private.blackjack_emit_event(
    p_room_id,
    case when v_phase='settlement' then 'round_settled' else 'player_changed' end,
    v_from,
    case when v_phase='settlement' then null else p_user_id end
  );
  return private.blackjack_public_state(p_room_id);
end;
$$;

create or replace function public.blackjack_action_gateway_service(
  p_room_id uuid,
  p_user_id uuid,
  p_action text,
  p_expected_token uuid,
  p_action_id uuid,
  p_device_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_action not in ('hit','stand') then raise exception '未知操作'; end if;

  if not public.flappy_rate_limit_check(
    private.blackjack_rate_key(p_user_id),
    'blackjack:'||p_action,
    120,
    60
  ) then
    raise exception using message='请求过于频繁，请稍后再试',errcode='P4290';
  end if;

  perform private.blackjack_assert_device(p_room_id,p_user_id,p_device_id);

  return public.blackjack_action_service(
    p_room_id,p_user_id,p_action,p_expected_token,p_action_id
  );
end;
$$;

create or replace function public.blackjack_timeout_service(p_room_id uuid,p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.blackjack_rooms%rowtype;
  v_before bigint;
  v_rows integer;
  v_after bigint;
  v_phase text;
begin
  if not exists(select 1 from public.blackjack_players where room_id=p_room_id and user_id=p_user_id and active) then
    raise exception '你不在这个房间';
  end if;

  select * into v_room from public.blackjack_rooms where id=p_room_id for update;
  if not found then raise exception '房间不存在'; end if;
  v_before:=v_room.version;

  if v_room.status='playing' and v_room.phase='player_action' then
    update public.blackjack_players
    set hand_status='stand',decision_deadline=null,action_token=null,updated_at=clock_timestamp()
    where room_id=p_room_id and active and hand_status='active'
      and decision_deadline is not null and decision_deadline<=clock_timestamp();
    get diagnostics v_rows=row_count;

    if v_rows>0 then
      update public.blackjack_rooms
      set version=version+1,last_activity_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=p_room_id;

      perform private.blackjack_settle_locked(p_room_id);
    end if;
  end if;

  select version,phase into v_after,v_phase from public.blackjack_rooms where id=p_room_id;
  if v_after<>v_before then
    perform private.blackjack_emit_event(
      p_room_id,
      case when v_phase='settlement' then 'round_settled' else 'players_changed' end,
      v_before,
      null
    );
  end if;

  return private.blackjack_public_state(p_room_id);
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
  v_phase text;
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
    perform private.blackjack_emit_event(p_room_id,'game_finished',v_room.version,null);
  else
    perform private.blackjack_start_round_locked(p_room_id,p_deck);
    perform private.blackjack_settle_locked(p_room_id);
    select phase into v_phase from public.blackjack_rooms where id=p_room_id;

    perform private.blackjack_emit_event(
      p_room_id,
      case when v_phase='settlement' then 'round_settled' else 'round_started' end,
      v_room.version,
      null
    );
  end if;

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
  delete from private.blackjack_device_leases where room_id=p_room_id;

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

  perform private.blackjack_emit_event(p_room_id,'lobby_changed',v_room.version,null);
  return private.blackjack_public_state(p_room_id);
end;
$$;

revoke all on function private.blackjack_emit_event(uuid,text,bigint,uuid) from public,anon,authenticated;
revoke all on function private.blackjack_assert_device(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.blackjack_claim_device_service(uuid,uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.blackjack_action_gateway_service(uuid,uuid,text,uuid,uuid,uuid) from public,anon,authenticated;

grant execute on function public.blackjack_claim_device_service(uuid,uuid,uuid,boolean) to service_role;
grant execute on function public.blackjack_action_gateway_service(uuid,uuid,text,uuid,uuid,uuid) to service_role;

comment on table private.blackjack_events is
  'Short-lived authoritative Blackjack event log. Rows disappear with transient rooms after lifecycle cleanup.';
comment on table private.blackjack_device_leases is
  'One active controller device per Blackjack player/room; leases expire after 75 seconds of inactivity.';
comment on function public.blackjack_claim_device_service(uuid,uuid,uuid,boolean) is
  'Server-only device controller claim/takeover endpoint for Blackjack V1.2.';
