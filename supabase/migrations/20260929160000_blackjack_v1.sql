create table if not exists public.blackjack_rooms (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique check (room_code ~ '^[A-Z2-9]{6}$'),
  host_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'lobby' check (status in ('lobby','playing','finished','closed','abandoned')),
  round_limit smallint not null default 5 check (round_limit in (3,5,10)),
  current_round smallint not null default 0 check (current_round >= 0),
  phase text not null default 'lobby' check (phase in ('lobby','player_action','settlement','finished')),
  version bigint not null default 0 check (version >= 0),
  dealer_up_card text,
  dealer_value smallint,
  dealer_status text not null default 'hidden' check (dealer_status in ('hidden','stand','blackjack','bust')),
  summary_until timestamptz,
  last_activity_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  closed_reason text
);

create table if not exists public.blackjack_players (
  room_id uuid not null references public.blackjack_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  seat smallint not null check (seat between 1 and 3),
  ready boolean not null default false,
  active boolean not null default true,
  score integer not null default 0 check (score between -100000 and 100000),
  hand_cards text[] not null default '{}'::text[],
  hand_value smallint,
  hand_status text not null default 'none' check (hand_status in ('none','active','stand','bust','blackjack')),
  round_delta smallint not null default 0 check (round_delta between -10 and 10),
  result text check (result is null or result in ('win','push','loss')),
  decision_deadline timestamptz,
  action_token uuid,
  joined_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (room_id,user_id),
  unique (room_id,seat)
);

create schema if not exists private;

create table if not exists private.blackjack_secrets (
  room_id uuid primary key references public.blackjack_rooms(id) on delete cascade,
  deck text[] not null,
  draw_index smallint not null check (draw_index between 1 and 53),
  dealer_cards text[] not null default '{}'::text[],
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists private.blackjack_actions (
  action_id uuid primary key,
  room_id uuid not null references public.blackjack_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (char_length(action) between 1 and 32),
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists blackjack_rooms_code_idx on public.blackjack_rooms(room_code);
create index if not exists blackjack_players_room_active_idx on public.blackjack_players(room_id,active,seat);
create index if not exists blackjack_actions_room_created_idx on private.blackjack_actions(room_id,created_at);

alter table public.blackjack_rooms enable row level security;
alter table public.blackjack_players enable row level security;

revoke all on public.blackjack_rooms from anon, authenticated;
revoke all on public.blackjack_players from anon, authenticated;
revoke all on private.blackjack_secrets from public, anon, authenticated;
revoke all on private.blackjack_actions from public, anon, authenticated;

grant select,insert,update,delete on public.blackjack_rooms to service_role;
grant select,insert,update,delete on public.blackjack_players to service_role;
grant usage on schema private to service_role;
grant select,insert,update,delete on private.blackjack_secrets to service_role;
grant select,insert,update,delete on private.blackjack_actions to service_role;

create or replace function private.blackjack_hand_value(p_cards text[])
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_total integer := 0;
  v_aces integer := 0;
  v_card text;
  v_rank text;
begin
  if p_cards is null then return 0; end if;
  foreach v_card in array p_cards loop
    v_rank := regexp_replace(v_card, '[SHDC]$', '');
    if v_rank = 'A' then
      v_total := v_total + 11;
      v_aces := v_aces + 1;
    elsif v_rank in ('K','Q','J') then
      v_total := v_total + 10;
    else
      v_total := v_total + v_rank::integer;
    end if;
  end loop;
  while v_total > 21 and v_aces > 0 loop
    v_total := v_total - 10;
    v_aces := v_aces - 1;
  end loop;
  return v_total;
end;
$$;

create or replace function private.blackjack_is_blackjack(p_cards text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(cardinality(p_cards)=2 and private.blackjack_hand_value(p_cards)=21,false);
$$;

create or replace function private.blackjack_validate_deck(p_deck text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    cardinality(p_deck)=52
    and (select count(distinct c)=52 from unnest(p_deck) c)
    and not exists (
      select 1
      from unnest(p_deck) c
      where c !~ '^(A|[2-9]|10|J|Q|K)[SHDC]$'
    );
$$;

create or replace function private.blackjack_public_state(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_room public.blackjack_rooms%rowtype;
  v_secret private.blackjack_secrets%rowtype;
  v_players jsonb;
  v_revealed boolean;
begin
  select * into v_room from public.blackjack_rooms where id=p_room_id;
  if not found then return null; end if;
  select * into v_secret from private.blackjack_secrets where room_id=p_room_id;
  v_revealed := v_room.phase in ('settlement','finished') or v_room.status='finished';

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'member_id', coalesce(m.id::text,p.user_id::text),
      'nickname', coalesce(m.nickname,p.display_name),
      'color', coalesce(m.color,'#8EC5FF'),
      'seat', p.seat,
      'ready', p.ready,
      'score', p.score,
      'hand_cards', to_jsonb(p.hand_cards),
      'hand_value', p.hand_value,
      'hand_status', p.hand_status,
      'round_delta', p.round_delta,
      'result', p.result,
      'decision_deadline', p.decision_deadline,
      'action_token', p.action_token
    ) order by p.seat
  ),'[]'::jsonb)
  into v_players
  from public.blackjack_players p
  left join public.members m on m.user_id=p.user_id
  where p.room_id=p_room_id and p.active;

  return jsonb_build_object(
    'server_now', clock_timestamp(),
    'room', jsonb_build_object(
      'id', v_room.id,
      'code', v_room.room_code,
      'host_member_id', coalesce((select m.id::text from public.members m where m.user_id=v_room.host_user_id limit 1),v_room.host_user_id::text),
      'status', v_room.status,
      'round_limit', v_room.round_limit,
      'current_round', v_room.current_round,
      'phase', v_room.phase,
      'version', v_room.version,
      'summary_until', v_room.summary_until
    ),
    'players', v_players,
    'dealer', jsonb_build_object(
      'cards', case
        when v_secret.room_id is null then '[]'::jsonb
        when v_revealed then to_jsonb(v_secret.dealer_cards)
        else jsonb_build_array(v_room.dealer_up_card,'BACK')
      end,
      'value', case when v_revealed then v_room.dealer_value else null end,
      'status', case when v_revealed then v_room.dealer_status else 'hidden' end
    )
  );
end;
$$;

create or replace function private.blackjack_broadcast_state(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
begin
  v_payload := private.blackjack_public_state(p_room_id);
  if v_payload is not null then
    perform realtime.send(v_payload,'state_snapshot','blackjack:'||p_room_id::text,true);
  end if;
end;
$$;

create or replace function private.blackjack_start_round_locked(p_room_id uuid,p_deck text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_index integer := 1;
  v_player record;
  v_hand text[];
  v_value integer;
  v_dealer text[] := '{}'::text[];
  v_count integer;
begin
  if not private.blackjack_validate_deck(p_deck) then
    raise exception '牌堆校验失败';
  end if;

  select count(*) into v_count
  from public.blackjack_players
  where room_id=p_room_id and active;
  if v_count < 2 or v_count > 3 then
    raise exception '需要 2 至 3 名玩家';
  end if;

  update public.blackjack_players
  set hand_cards='{}'::text[],hand_value=null,hand_status='none',round_delta=0,result=null,
      decision_deadline=null,action_token=null,updated_at=clock_timestamp()
  where room_id=p_room_id and active;

  for v_player in
    select user_id from public.blackjack_players
    where room_id=p_room_id and active
    order by seat
  loop
    update public.blackjack_players
    set hand_cards=array[p_deck[v_index]],updated_at=clock_timestamp()
    where room_id=p_room_id and user_id=v_player.user_id;
    v_index := v_index + 1;
  end loop;

  v_dealer := array[p_deck[v_index]];
  v_index := v_index + 1;

  for v_player in
    select user_id from public.blackjack_players
    where room_id=p_room_id and active
    order by seat
  loop
    select hand_cards || p_deck[v_index]
    into v_hand
    from public.blackjack_players
    where room_id=p_room_id and user_id=v_player.user_id
    for update;
    v_index := v_index + 1;
    v_value := private.blackjack_hand_value(v_hand);
    update public.blackjack_players
    set hand_cards=v_hand,
        hand_value=v_value,
        hand_status=case when private.blackjack_is_blackjack(v_hand) then 'blackjack' else 'active' end,
        decision_deadline=case when private.blackjack_is_blackjack(v_hand) then null else clock_timestamp()+interval '20 seconds' end,
        action_token=case when private.blackjack_is_blackjack(v_hand) then null else gen_random_uuid() end,
        updated_at=clock_timestamp()
    where room_id=p_room_id and user_id=v_player.user_id;
  end loop;

  v_dealer := v_dealer || p_deck[v_index];
  v_index := v_index + 1;

  insert into private.blackjack_secrets(room_id,deck,draw_index,dealer_cards,updated_at)
  values(p_room_id,p_deck,v_index,v_dealer,clock_timestamp())
  on conflict (room_id) do update
    set deck=excluded.deck,draw_index=excluded.draw_index,dealer_cards=excluded.dealer_cards,updated_at=excluded.updated_at;

  update public.blackjack_rooms
  set status='playing',
      current_round=current_round+1,
      phase='player_action',
      dealer_up_card=v_dealer[1],
      dealer_value=null,
      dealer_status='hidden',
      summary_until=null,
      version=version+1,
      last_activity_at=clock_timestamp(),
      updated_at=clock_timestamp(),
      finished_at=null,
      closed_reason=null
  where id=p_room_id;
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
  if not found or v_room.phase <> 'player_action' then return; end if;

  if exists (
    select 1 from public.blackjack_players
    where room_id=p_room_id and active and hand_status='active'
  ) then return; end if;

  select * into v_secret from private.blackjack_secrets where room_id=p_room_id for update;
  if not found then raise exception '牌局状态缺失'; end if;

  v_cards := v_secret.dealer_cards;
  v_index := v_secret.draw_index;
  select count(*) into v_non_bust
  from public.blackjack_players
  where room_id=p_room_id and active and hand_status <> 'bust';

  if v_non_bust > 0 then
    while private.blackjack_hand_value(v_cards) < 17 loop
      if v_index > 52 then raise exception '牌堆已耗尽'; end if;
      v_cards := v_cards || v_secret.deck[v_index];
      v_index := v_index + 1;
    end loop;
  end if;

  v_dealer_value := private.blackjack_hand_value(v_cards);
  v_dealer_bj := private.blackjack_is_blackjack(v_cards);

  for v_player in
    select user_id,hand_value,hand_status
    from public.blackjack_players
    where room_id=p_room_id and active
    for update
  loop
    if v_player.hand_status='bust' then
      v_delta := -1;
    elsif v_dealer_bj and v_player.hand_status='blackjack' then
      v_delta := 0;
    elsif v_dealer_bj then
      v_delta := -1;
    elsif v_player.hand_status='blackjack' then
      v_delta := 3;
    elsif v_dealer_value > 21 then
      v_delta := 2;
    elsif v_player.hand_value > v_dealer_value then
      v_delta := 2;
    elsif v_player.hand_value = v_dealer_value then
      v_delta := 0;
    else
      v_delta := -1;
    end if;
    v_result := case when v_delta>0 then 'win' when v_delta=0 then 'push' else 'loss' end;
    update public.blackjack_players
    set score=score+v_delta,round_delta=v_delta,result=v_result,decision_deadline=null,updated_at=clock_timestamp()
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
end;
$$;

create or replace function public.blackjack_state_service(p_room_id uuid,p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.blackjack_players
    where room_id=p_room_id and user_id=p_user_id and active
  ) then
    raise exception '你不在这个房间';
  end if;
  return private.blackjack_public_state(p_room_id);
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
begin
  select * into v_room from public.blackjack_rooms where id=p_room_id for update;
  if not found then raise exception '房间不存在'; end if;
  if v_room.status <> 'lobby' then raise exception '当前不能修改准备状态'; end if;
  if v_room.host_user_id=p_user_id then raise exception '房主默认已准备'; end if;
  if not exists(select 1 from public.blackjack_players where room_id=p_room_id and user_id=p_user_id and active) then raise exception '你不在这个房间'; end if;

  update public.blackjack_players
  set ready=not ready,updated_at=clock_timestamp()
  where room_id=p_room_id and user_id=p_user_id;

  update public.blackjack_rooms
  set version=version+1,last_activity_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=p_room_id;

  perform private.blackjack_broadcast_state(p_room_id);
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
begin
  if exists(select 1 from private.blackjack_actions where action_id=p_action_id and room_id=p_room_id and user_id=p_user_id) then
    return private.blackjack_public_state(p_room_id);
  end if;

  select * into v_room from public.blackjack_rooms where id=p_room_id for update;
  if not found then raise exception '房间不存在'; end if;
  if v_room.host_user_id<>p_user_id then raise exception '只有房主可以开始'; end if;
  if v_room.status<>'lobby' then raise exception '游戏已经开始'; end if;

  select count(*) into v_count from public.blackjack_players where room_id=p_room_id and active;
  if v_count<2 or v_count>3 then raise exception '需要 2 至 3 名玩家'; end if;
  if exists(select 1 from public.blackjack_players where room_id=p_room_id and active and user_id<>p_user_id and not ready) then
    raise exception '还有玩家未准备';
  end if;

  insert into private.blackjack_actions(action_id,room_id,user_id,action)
  values(p_action_id,p_room_id,p_user_id,'start_game')
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows=0 then return private.blackjack_public_state(p_room_id); end if;

  delete from private.blackjack_actions where room_id=p_room_id and created_at<clock_timestamp()-interval '1 day';
  update public.blackjack_players
  set score=0,round_delta=0,result=null,updated_at=clock_timestamp()
  where room_id=p_room_id and active;

  perform private.blackjack_start_round_locked(p_room_id,p_deck);
  perform private.blackjack_settle_locked(p_room_id);
  perform private.blackjack_broadcast_state(p_room_id);
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
  v_room public.blackjack_rooms%rowtype;
  v_player public.blackjack_players%rowtype;
  v_secret private.blackjack_secrets%rowtype;
  v_cards text[];
  v_value integer;
  v_rows integer;
begin
  if p_action not in ('hit','stand') then raise exception '未知操作'; end if;
  if exists(select 1 from private.blackjack_actions where action_id=p_action_id and room_id=p_room_id and user_id=p_user_id) then
    return private.blackjack_public_state(p_room_id);
  end if;

  select * into v_room from public.blackjack_rooms where id=p_room_id for update;
  if not found then raise exception '房间不存在'; end if;
  if v_room.status<>'playing' or v_room.phase<>'player_action' then raise exception '当前不能操作'; end if;
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
  get diagnostics v_rows = row_count;
  if v_rows=0 then return private.blackjack_public_state(p_room_id); end if;

  if p_action='stand' then
    update public.blackjack_players
    set hand_status='stand',decision_deadline=null,action_token=null,updated_at=clock_timestamp()
    where room_id=p_room_id and user_id=p_user_id;
  else
    select * into v_secret from private.blackjack_secrets where room_id=p_room_id for update;
    if not found or v_secret.draw_index>52 then raise exception '牌堆状态异常'; end if;
    v_cards := v_player.hand_cards || v_secret.deck[v_secret.draw_index];
    v_value := private.blackjack_hand_value(v_cards);
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
  where id=p_room_id;

  perform private.blackjack_settle_locked(p_room_id);
  perform private.blackjack_broadcast_state(p_room_id);
  return private.blackjack_public_state(p_room_id);
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
begin
  if not exists(select 1 from public.blackjack_players where room_id=p_room_id and user_id=p_user_id and active) then
    raise exception '你不在这个房间';
  end if;
  select * into v_room from public.blackjack_rooms where id=p_room_id for update;
  if not found then raise exception '房间不存在'; end if;
  v_before := v_room.version;

  if v_room.status='playing' and v_room.phase='player_action' then
    update public.blackjack_players
    set hand_status='stand',decision_deadline=null,action_token=null,updated_at=clock_timestamp()
    where room_id=p_room_id and active and hand_status='active'
      and decision_deadline is not null and decision_deadline<=clock_timestamp();
    get diagnostics v_rows = row_count;
    if v_rows>0 then
      update public.blackjack_rooms
      set version=version+1,last_activity_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=p_room_id;
      perform private.blackjack_settle_locked(p_room_id);
    end if;
  end if;

  select version into v_after from public.blackjack_rooms where id=p_room_id;
  if v_after<>v_before then perform private.blackjack_broadcast_state(p_room_id); end if;
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
begin
  if exists(select 1 from private.blackjack_actions where action_id=p_action_id and room_id=p_room_id and user_id=p_user_id) then
    return private.blackjack_public_state(p_room_id);
  end if;
  select * into v_room from public.blackjack_rooms where id=p_room_id for update;
  if not found then raise exception '房间不存在'; end if;
  if not exists(select 1 from public.blackjack_players where room_id=p_room_id and user_id=p_user_id and active) then raise exception '你不在这个房间'; end if;
  if v_room.phase<>'settlement' then return private.blackjack_public_state(p_room_id); end if;
  if v_room.summary_until is not null and v_room.summary_until>clock_timestamp() then return private.blackjack_public_state(p_room_id); end if;

  insert into private.blackjack_actions(action_id,room_id,user_id,action)
  values(p_action_id,p_room_id,p_user_id,'advance')
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows=0 then return private.blackjack_public_state(p_room_id); end if;

  if v_room.current_round>=v_room.round_limit then
    update public.blackjack_rooms
    set status='finished',phase='finished',summary_until=null,finished_at=clock_timestamp(),
        version=version+1,last_activity_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=p_room_id;
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
  set status='lobby',current_round=0,phase='lobby',dealer_up_card=null,dealer_value=null,dealer_status='hidden',
      summary_until=null,finished_at=null,closed_reason=null,version=version+1,last_activity_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=p_room_id;

  perform private.blackjack_broadcast_state(p_room_id);
  return private.blackjack_public_state(p_room_id);
end;
$$;

create or replace function private.is_blackjack_topic_member(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_active_session() and exists(
    select 1
    from public.blackjack_players bp
    join public.members m on m.user_id=bp.user_id
    join public.blackjack_rooms br on br.id=bp.room_id
    where bp.user_id=(select auth.uid())
      and bp.active
      and br.status not in ('closed','abandoned')
      and p_topic='blackjack:'||bp.room_id::text
  );
$$;

revoke all on function public.blackjack_state_service(uuid,uuid) from public,anon,authenticated;
revoke all on function public.blackjack_toggle_ready_service(uuid,uuid) from public,anon,authenticated;
revoke all on function public.blackjack_start_game_service(uuid,uuid,text[],uuid) from public,anon,authenticated;
revoke all on function public.blackjack_action_service(uuid,uuid,text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.blackjack_timeout_service(uuid,uuid) from public,anon,authenticated;
revoke all on function public.blackjack_advance_service(uuid,uuid,text[],uuid) from public,anon,authenticated;
revoke all on function public.blackjack_play_again_service(uuid,uuid) from public,anon,authenticated;

grant execute on function public.blackjack_state_service(uuid,uuid) to service_role;
grant execute on function public.blackjack_toggle_ready_service(uuid,uuid) to service_role;
grant execute on function public.blackjack_start_game_service(uuid,uuid,text[],uuid) to service_role;
grant execute on function public.blackjack_action_service(uuid,uuid,text,uuid,uuid) to service_role;
grant execute on function public.blackjack_timeout_service(uuid,uuid) to service_role;
grant execute on function public.blackjack_advance_service(uuid,uuid,text[],uuid) to service_role;
grant execute on function public.blackjack_play_again_service(uuid,uuid) to service_role;

revoke all on function private.blackjack_hand_value(text[]) from public,anon,authenticated;
revoke all on function private.blackjack_is_blackjack(text[]) from public,anon,authenticated;
revoke all on function private.blackjack_validate_deck(text[]) from public,anon,authenticated;
revoke all on function private.blackjack_public_state(uuid) from public,anon,authenticated;
revoke all on function private.blackjack_broadcast_state(uuid) from public,anon,authenticated;
revoke all on function private.blackjack_start_round_locked(uuid,text[]) from public,anon,authenticated;
revoke all on function private.blackjack_settle_locked(uuid) from public,anon,authenticated;

revoke all on function private.is_blackjack_topic_member(text) from public,anon;
grant execute on function private.is_blackjack_topic_member(text) to authenticated;

drop policy if exists "blackjack members receive realtime" on realtime.messages;
create policy "blackjack members receive realtime"
on realtime.messages
for select
to authenticated
using (
  extension in ('broadcast','presence')
  and private.is_blackjack_topic_member((select realtime.topic()))
);

drop policy if exists "blackjack members send realtime" on realtime.messages;
create policy "blackjack members send realtime"
on realtime.messages
for insert
to authenticated
with check (
  private.is_blackjack_topic_member((select realtime.topic()))
  and (
    extension='presence'
    or (
      extension='broadcast'
      and event in ('state_changed','ping','pong','emoji')
    )
  )
);

comment on table public.blackjack_rooms is 'Friends-only Blackjack rooms. Browser roles have no direct table access.';
comment on table public.blackjack_players is 'Blackjack player state. Mutations are server-authoritative through the Edge Function.';
comment on table private.blackjack_secrets is 'Hidden deck and dealer hole cards. Never exposed through the Data API.';
