-- Blackjack V1.4 Casino Table.
-- Match-local virtual chips only: no purchase, cash-out, transfer, or carry-over between matches.
-- Performance design: one authoritative mutation per user action, compact Realtime player events,
-- and full snapshots only for recovery.

alter table public.blackjack_rooms drop constraint if exists blackjack_rooms_phase_check;
alter table public.blackjack_rooms
  add constraint blackjack_rooms_phase_check
  check (phase in ('lobby','betting','insurance','player_action','settlement','finished'));

alter table public.blackjack_rooms
  add column if not exists initial_stack numeric(10,1) not null default 1000,
  add column if not exists min_bet numeric(10,1) not null default 10,
  add column if not exists max_bet numeric(10,1) not null default 500;

alter table public.blackjack_rooms
  drop constraint if exists blackjack_rooms_initial_stack_check,
  drop constraint if exists blackjack_rooms_bet_range_check;
alter table public.blackjack_rooms
  add constraint blackjack_rooms_initial_stack_check check (initial_stack=1000),
  add constraint blackjack_rooms_bet_range_check check (min_bet=10 and max_bet=500);

alter table public.blackjack_players
  add column if not exists stack numeric(10,1) not null default 1000,
  add column if not exists round_start_stack numeric(10,1) not null default 1000,
  add column if not exists current_bet numeric(10,1) not null default 0,
  add column if not exists bet_locked boolean not null default false,
  add column if not exists insurance_bet numeric(10,1) not null default 0,
  add column if not exists insurance_decided boolean not null default false;

alter table public.blackjack_players
  drop constraint if exists blackjack_players_stack_check,
  drop constraint if exists blackjack_players_current_bet_check,
  drop constraint if exists blackjack_players_insurance_bet_check;
alter table public.blackjack_players
  add constraint blackjack_players_stack_check check (stack>=0 and stack<=100000),
  add constraint blackjack_players_current_bet_check check (current_bet>=0 and current_bet<=500),
  add constraint blackjack_players_insurance_bet_check check (insurance_bet>=0 and insurance_bet<=250);

create table if not exists private.blackjack_hands (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null,
  user_id uuid not null,
  hand_no smallint not null check (hand_no between 1 and 4),
  cards text[] not null default '{}',
  hand_value smallint,
  status text not null default 'active'
    check (status in ('active','stand','bust','blackjack','surrender')),
  bet numeric(10,1) not null check (bet>=10 and bet<=2000),
  doubled boolean not null default false,
  from_split boolean not null default false,
  split_aces boolean not null default false,
  action_token uuid,
  decision_deadline timestamptz,
  payout numeric(10,1) not null default 0,
  net_delta numeric(10,1) not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(room_id,user_id,hand_no),
  foreign key(room_id,user_id)
    references public.blackjack_players(room_id,user_id)
    on delete cascade
);

create index if not exists blackjack_hands_room_user_idx
  on private.blackjack_hands(room_id,user_id,hand_no);

revoke all on private.blackjack_hands from public,anon,authenticated;
grant select,insert,update,delete on private.blackjack_hands to service_role;

create or replace function private.blackjack_card_rank(p_card text)
returns text
language sql
immutable
set search_path=''
as $$
  select left(p_card,greatest(length(p_card)-1,0));
$$;

create or replace function private.blackjack_is_ten_value(p_card text)
returns boolean
language sql
immutable
set search_path=''
as $$
  select private.blackjack_card_rank(p_card) in ('10','J','Q','K');
$$;

create or replace function private.blackjack_player_hands_json(
  p_room_id uuid,
  p_user_id uuid,
  p_stack numeric
)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',h.id,
      'hand_no',h.hand_no,
      'cards',to_jsonb(h.cards),
      'value',h.hand_value,
      'status',h.status,
      'bet',h.bet,
      'doubled',h.doubled,
      'from_split',h.from_split,
      'split_aces',h.split_aces,
      'action_token',h.action_token,
      'decision_deadline',h.decision_deadline,
      'payout',h.payout,
      'net_delta',h.net_delta,
      'can_double',
        h.status='active'
        and coalesce(array_length(h.cards,1),0)=2
        and not h.split_aces
        and p_stack>=h.bet,
      'can_split',
        h.status='active'
        and coalesce(array_length(h.cards,1),0)=2
        and not h.split_aces
        and p_stack>=h.bet
        and (select count(*) from private.blackjack_hands x
             where x.room_id=p_room_id and x.user_id=p_user_id)<4
        and private.blackjack_card_rank(h.cards[1])=private.blackjack_card_rank(h.cards[2]),
      'can_surrender',
        h.status='active'
        and coalesce(array_length(h.cards,1),0)=2
        and not h.from_split
        and not h.doubled
    )
    order by h.hand_no
  ),'[]'::jsonb)
  from private.blackjack_hands h
  where h.room_id=p_room_id and h.user_id=p_user_id;
$$;

create or replace function private.blackjack_public_state(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_room public.blackjack_rooms%rowtype;
  v_secret private.blackjack_secrets%rowtype;
  v_players jsonb;
  v_revealed boolean;
begin
  select * into v_room from public.blackjack_rooms where id=p_room_id;
  if not found then return null; end if;

  select * into v_secret
  from private.blackjack_secrets
  where room_id=p_room_id;

  v_revealed:=v_room.phase in ('settlement','finished') or v_room.status='finished';

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'member_id',coalesce(m.id::text,p.user_id::text),
      'nickname',coalesce(m.nickname,p.display_name),
      'color',coalesce(m.color,'#8EC5FF'),
      'seat',p.seat,
      'ready',p.ready,
      'score',p.score,
      'stack',p.stack,
      'round_start_stack',p.round_start_stack,
      'current_bet',p.current_bet,
      'bet_locked',p.bet_locked,
      'insurance_bet',p.insurance_bet,
      'insurance_decided',p.insurance_decided,
      'round_delta',p.round_delta,
      'result',p.result,
      'hand_cards',to_jsonb(p.hand_cards),
      'hand_value',p.hand_value,
      'hand_status',p.hand_status,
      'action_token',p.action_token,
      'decision_deadline',p.decision_deadline,
      'active_hand_id',(
        select h.id
        from private.blackjack_hands h
        where h.room_id=p_room_id
          and h.user_id=p.user_id
          and h.status='active'
          and h.action_token is not null
        order by h.hand_no
        limit 1
      ),
      'hands',private.blackjack_player_hands_json(p_room_id,p.user_id,p.stack)
    )
    order by p.seat
  ),'[]'::jsonb)
  into v_players
  from public.blackjack_players p
  left join public.members m on m.user_id=p.user_id
  where p.room_id=p_room_id and p.active;

  return jsonb_build_object(
    'server_now',clock_timestamp(),
    'room',jsonb_build_object(
      'id',v_room.id,
      'code',v_room.room_code,
      'host_member_id',coalesce(
        (select m.id::text from public.members m where m.user_id=v_room.host_user_id limit 1),
        v_room.host_user_id::text
      ),
      'status',v_room.status,
      'round_limit',v_room.round_limit,
      'current_round',v_room.current_round,
      'phase',v_room.phase,
      'version',v_room.version,
      'summary_until',v_room.summary_until,
      'initial_stack',v_room.initial_stack,
      'min_bet',v_room.min_bet,
      'max_bet',v_room.max_bet,
      'rules',jsonb_build_object(
        'blackjack_pays','3:2',
        'dealer_rule','S17',
        'double_after_split',true,
        'max_hands',4,
        'resplit_aces',false,
        'split_aces_one_card',true,
        'insurance_pays','2:1',
        'late_surrender',true
      )
    ),
    'players',v_players,
    'dealer',jsonb_build_object(
      'cards',case
        when v_secret.room_id is null then '[]'::jsonb
        when v_revealed then to_jsonb(v_secret.dealer_cards)
        else jsonb_build_array(v_room.dealer_up_card,'BACK')
      end,
      'value',case when v_revealed then v_room.dealer_value else null end,
      'status',case when v_revealed then v_room.dealer_status else 'hidden' end
    )
  );
end;
$$;

create or replace function private.blackjack_activate_player_hand(
  p_room_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_hand_id uuid;
begin
  update private.blackjack_hands
  set action_token=null,decision_deadline=null
  where room_id=p_room_id and user_id=p_user_id and status='active';

  select id into v_hand_id
  from private.blackjack_hands
  where room_id=p_room_id and user_id=p_user_id and status='active'
  order by hand_no
  limit 1;

  if v_hand_id is not null then
    update private.blackjack_hands
    set action_token=gen_random_uuid(),
        decision_deadline=clock_timestamp()+interval '20 seconds',
        updated_at=clock_timestamp()
    where id=v_hand_id;
  end if;
end;
$$;

create or replace function private.blackjack_activate_all_players(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid;
begin
  for v_user in
    select user_id
    from public.blackjack_players
    where room_id=p_room_id and active and bet_locked and current_bet>0
    order by seat
  loop
    perform private.blackjack_activate_player_hand(p_room_id,v_user);
  end loop;
end;
$$;

create or replace function private.blackjack_history_players(p_room_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'user_id',p.user_id,
      'member_id',coalesce(m.id::text,p.user_id::text),
      'nickname',coalesce(m.nickname,p.display_name),
      'color',coalesce(m.color,'#8EC5FF'),
      'seat',p.seat,
      'score',p.score,
      'stack',p.stack,
      'round_start_stack',p.round_start_stack,
      'current_bet',p.current_bet,
      'insurance_bet',p.insurance_bet,
      'net_chips',p.stack-p.round_start_stack,
      'hand_cards',to_jsonb(p.hand_cards),
      'hand_value',p.hand_value,
      'hand_status',p.hand_status,
      'round_delta',p.round_delta,
      'result',p.result,
      'hands',private.blackjack_player_hands_json(p_room_id,p.user_id,p.stack)
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
set search_path=''
as $$
declare
  v_room public.blackjack_rooms%rowtype;
  v_secret private.blackjack_secrets%rowtype;
  v_round jsonb;
begin
  select * into v_room from public.blackjack_rooms where id=p_room_id;
  if not found or v_room.match_id is null or v_room.phase<>'settlement' then return; end if;

  if exists(
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
    'mode','casino',
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

create or replace function private.blackjack_finish_settlement_locked(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_room public.blackjack_rooms%rowtype;
  v_secret private.blackjack_secrets%rowtype;
  v_cards text[];
  v_index integer;
  v_dealer_value integer;
  v_dealer_bj boolean;
  v_need_dealer boolean;
  v_hand record;
  v_return numeric(10,1);
  v_player record;
  v_insurance_return numeric(10,1);
  v_round_net numeric(10,1);
begin
  select * into v_room
  from public.blackjack_rooms
  where id=p_room_id
  for update;
  if not found then raise exception '房间不存在'; end if;
  if v_room.phase not in ('player_action','insurance') then return; end if;

  if v_room.phase='player_action' and exists(
    select 1 from private.blackjack_hands
    where room_id=p_room_id and status='active'
  ) then
    return;
  end if;

  select * into v_secret
  from private.blackjack_secrets
  where room_id=p_room_id
  for update;
  if not found then raise exception '牌堆状态缺失'; end if;

  v_cards:=v_secret.dealer_cards;
  v_index:=v_secret.draw_index;
  v_dealer_bj:=private.blackjack_is_blackjack(v_cards);

  select exists(
    select 1
    from private.blackjack_hands
    where room_id=p_room_id and status not in ('bust','surrender')
  ) into v_need_dealer;

  if not v_dealer_bj and v_need_dealer then
    while private.blackjack_hand_value(v_cards)<17 loop
      if v_index>52 then raise exception '牌堆已耗尽'; end if;
      v_cards:=v_cards||v_secret.deck[v_index];
      v_index:=v_index+1;
    end loop;
  end if;

  v_dealer_value:=private.blackjack_hand_value(v_cards);
  v_dealer_bj:=private.blackjack_is_blackjack(v_cards);

  update private.blackjack_secrets
  set dealer_cards=v_cards,draw_index=v_index,updated_at=clock_timestamp()
  where room_id=p_room_id;

  for v_hand in
    select *
    from private.blackjack_hands
    where room_id=p_room_id
    order by user_id,hand_no
    for update
  loop
    if v_hand.status='surrender' then
      v_return:=v_hand.bet/2;
    elsif v_hand.status='blackjack' and not v_hand.from_split then
      if v_dealer_bj then v_return:=v_hand.bet;
      else v_return:=v_hand.bet*2.5;
      end if;
    elsif v_hand.status='bust' then
      v_return:=0;
    elsif v_dealer_bj then
      v_return:=0;
    elsif v_dealer_value>21 then
      v_return:=v_hand.bet*2;
    elsif v_hand.hand_value>v_dealer_value then
      v_return:=v_hand.bet*2;
    elsif v_hand.hand_value=v_dealer_value then
      v_return:=v_hand.bet;
    else
      v_return:=0;
    end if;

    update private.blackjack_hands
    set payout=v_return,
        net_delta=v_return-v_hand.bet,
        action_token=null,
        decision_deadline=null,
        updated_at=clock_timestamp()
    where id=v_hand.id;
  end loop;

  for v_player in
    select *
    from public.blackjack_players
    where room_id=p_room_id and active
    order by seat
    for update
  loop
    v_insurance_return:=case
      when v_dealer_bj then v_player.insurance_bet*3
      else 0
    end;

    update public.blackjack_players p
    set stack=p.stack+
          coalesce((select sum(h.payout) from private.blackjack_hands h
                    where h.room_id=p_room_id and h.user_id=p.user_id),0)
          +v_insurance_return,
        updated_at=clock_timestamp()
    where p.room_id=p_room_id and p.user_id=v_player.user_id;

    select stack-round_start_stack
    into v_round_net
    from public.blackjack_players
    where room_id=p_room_id and user_id=v_player.user_id;

    update public.blackjack_players
    set score=round(stack)::integer,
        round_delta=case when v_round_net>0 then 1 when v_round_net<0 then -1 else 0 end,
        result=case when v_round_net>0 then 'win' when v_round_net<0 then 'loss' else 'push' end,
        hand_status=case when v_round_net>0 then 'stand' when v_round_net<0 then 'bust' else 'stand' end,
        hand_cards=coalesce((
          select cards from private.blackjack_hands
          where room_id=p_room_id and user_id=v_player.user_id
          order by hand_no limit 1
        ),'{}'::text[]),
        hand_value=(
          select hand_value from private.blackjack_hands
          where room_id=p_room_id and user_id=v_player.user_id
          order by hand_no limit 1
        ),
        action_token=null,
        decision_deadline=null,
        updated_at=clock_timestamp()
    where room_id=p_room_id and user_id=v_player.user_id;
  end loop;

  update public.blackjack_rooms
  set phase='settlement',
      dealer_value=v_dealer_value,
      dealer_status=case
        when v_dealer_bj then 'blackjack'
        when v_dealer_value>21 then 'bust'
        else 'stand'
      end,
      summary_until=clock_timestamp()+interval '5 seconds',
      version=version+1,
      last_activity_at=clock_timestamp(),
      updated_at=clock_timestamp()
  where id=p_room_id;

  perform private.blackjack_record_round_locked(p_room_id);
end;
$$;

create or replace function private.blackjack_deal_round_locked(
  p_room_id uuid,
  p_deck text[]
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_room public.blackjack_rooms%rowtype;
  v_player record;
  v_cards text[];
  v_dealer text[];
  v_index integer:=1;
  v_up text;
  v_dealer_bj boolean;
begin
  perform private.blackjack_validate_deck(p_deck);

  select * into v_room
  from public.blackjack_rooms
  where id=p_room_id
  for update;
  if not found or v_room.phase<>'betting' then raise exception '当前不能发牌'; end if;

  if exists(
    select 1 from public.blackjack_players
    where room_id=p_room_id and active and stack>=v_room.min_bet and not bet_locked
  ) then
    raise exception '还有玩家未确认下注';
  end if;

  if not exists(
    select 1 from public.blackjack_players
    where room_id=p_room_id and active and bet_locked and current_bet>=v_room.min_bet
  ) then
    raise exception '没有有效下注';
  end if;

  delete from private.blackjack_hands where room_id=p_room_id;

  for v_player in
    select user_id,current_bet
    from public.blackjack_players
    where room_id=p_room_id and active and bet_locked and current_bet>=v_room.min_bet
    order by seat
  loop
    v_cards:=array[p_deck[v_index],p_deck[v_index+1]];
    v_index:=v_index+2;

    insert into private.blackjack_hands(
      room_id,user_id,hand_no,cards,hand_value,status,bet
    )
    values(
      p_room_id,v_player.user_id,1,v_cards,
      private.blackjack_hand_value(v_cards),
      case when private.blackjack_is_blackjack(v_cards) then 'blackjack' else 'active' end,
      v_player.current_bet
    );
  end loop;

  v_dealer:=array[p_deck[v_index],p_deck[v_index+1]];
  v_index:=v_index+2;
  v_up:=v_dealer[1];
  v_dealer_bj:=private.blackjack_is_blackjack(v_dealer);

  insert into private.blackjack_secrets(room_id,deck,draw_index,dealer_cards,updated_at)
  values(p_room_id,p_deck,v_index,v_dealer,clock_timestamp())
  on conflict(room_id) do update
    set deck=excluded.deck,
        draw_index=excluded.draw_index,
        dealer_cards=excluded.dealer_cards,
        updated_at=excluded.updated_at;

  update public.blackjack_rooms
  set dealer_up_card=v_up,
      dealer_value=null,
      dealer_status='hidden',
      summary_until=null,
      phase=case
        when private.blackjack_card_rank(v_up)='A' then 'insurance'
        else 'player_action'
      end,
      version=version+1,
      last_activity_at=clock_timestamp(),
      updated_at=clock_timestamp()
  where id=p_room_id;

  if private.blackjack_card_rank(v_up)<>'A' and private.blackjack_is_ten_value(v_up) and v_dealer_bj then
    perform private.blackjack_finish_settlement_locked(p_room_id);
    return;
  end if;

  if private.blackjack_card_rank(v_up)<>'A' then
    perform private.blackjack_activate_all_players(p_room_id);
    if not exists(
      select 1 from private.blackjack_hands
      where room_id=p_room_id and status='active'
    ) then
      perform private.blackjack_finish_settlement_locked(p_room_id);
    end if;
  end if;
end;
$$;

create or replace function public.blackjack_start_game_service(
  p_room_id uuid,p_user_id uuid,p_deck text[],p_action_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_room public.blackjack_rooms%rowtype;
  v_count integer;
  v_rows integer;
  v_match_id uuid:=gen_random_uuid();
  v_participants uuid[];
  v_from bigint;
begin
  if exists(
    select 1 from private.blackjack_actions
    where action_id=p_action_id and room_id=p_room_id and user_id=p_user_id
  ) then
    return private.blackjack_public_state(p_room_id);
  end if;

  select * into v_room
  from public.blackjack_rooms
  where id=p_room_id
  for update;
  if not found then raise exception '房间不存在'; end if;
  if v_room.host_user_id<>p_user_id then raise exception '只有房主可以开始'; end if;
  if v_room.status<>'lobby' then raise exception '游戏已经开始'; end if;

  select count(*),array_agg(user_id order by seat)
  into v_count,v_participants
  from public.blackjack_players
  where room_id=p_room_id and active;

  if v_count<2 or v_count>3 then raise exception '需要 2 至 3 名玩家'; end if;
  if exists(
    select 1 from public.blackjack_players
    where room_id=p_room_id and active and user_id<>p_user_id and not ready
  ) then
    raise exception '还有玩家未准备';
  end if;

  insert into private.blackjack_actions(action_id,room_id,user_id,action)
  values(p_action_id,p_room_id,p_user_id,'start_game')
  on conflict do nothing;
  get diagnostics v_rows=row_count;
  if v_rows=0 then return private.blackjack_public_state(p_room_id); end if;

  v_from:=v_room.version;

  delete from private.blackjack_secrets where room_id=p_room_id;
  delete from private.blackjack_hands where room_id=p_room_id;
  delete from private.blackjack_device_leases where room_id=p_room_id;

  update public.blackjack_players
  set score=1000,
      stack=1000,
      round_start_stack=1000,
      current_bet=0,
      bet_locked=false,
      insurance_bet=0,
      insurance_decided=false,
      hand_cards='{}',
      hand_value=null,
      hand_status='none',
      round_delta=0,
      result=null,
      decision_deadline=null,
      action_token=null,
      updated_at=clock_timestamp()
  where room_id=p_room_id and active;

  insert into private.blackjack_match_history(
    id,room_id,room_code,round_limit,status,participant_user_ids,players,
    started_at,expires_at,updated_at
  )
  values(
    v_match_id,p_room_id,v_room.room_code,v_room.round_limit,'playing',
    v_participants,private.blackjack_history_players(p_room_id),
    clock_timestamp(),clock_timestamp()+interval '180 days',clock_timestamp()
  );

  update public.blackjack_rooms
  set match_id=v_match_id,
      status='playing',
      current_round=1,
      phase='betting',
      dealer_up_card=null,
      dealer_value=null,
      dealer_status='hidden',
      summary_until=null,
      finished_at=null,
      closed_reason=null,
      version=version+1,
      last_activity_at=clock_timestamp(),
      updated_at=clock_timestamp()
  where id=p_room_id;

  perform private.blackjack_emit_event(p_room_id,'round_started',v_from,null);
  return private.blackjack_public_state(p_room_id);
end;
$$;

create or replace function public.blackjack_bet_service(
  p_room_id uuid,
  p_user_id uuid,
  p_amount numeric,
  p_deck text[],
  p_action_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_room public.blackjack_rooms%rowtype;
  v_player public.blackjack_players%rowtype;
  v_rows integer;
  v_from bigint;
  v_dealt boolean:=false;
begin
  if exists(
    select 1 from private.blackjack_actions
    where action_id=p_action_id and room_id=p_room_id and user_id=p_user_id
  ) then
    return private.blackjack_public_state(p_room_id);
  end if;

  select * into v_room
  from public.blackjack_rooms
  where id=p_room_id
  for update;
  if not found then raise exception '房间不存在'; end if;
  if v_room.status<>'playing' or v_room.phase<>'betting' then raise exception '当前不是下注阶段'; end if;

  select * into v_player
  from public.blackjack_players
  where room_id=p_room_id and user_id=p_user_id and active
  for update;
  if not found then raise exception '你不在这个房间'; end if;
  if v_player.stack<v_room.min_bet then raise exception '筹码不足，本场暂时观战'; end if;
  if v_player.bet_locked then raise exception '本局下注已经确认'; end if;
  if p_amount<v_room.min_bet or p_amount>v_room.max_bet then raise exception '下注金额超出范围'; end if;
  if mod(p_amount,10)<>0 then raise exception '下注需为 10 的整数倍'; end if;
  if p_amount>v_player.stack then raise exception '筹码不足'; end if;

  insert into private.blackjack_actions(action_id,room_id,user_id,action)
  values(p_action_id,p_room_id,p_user_id,'bet')
  on conflict do nothing;
  get diagnostics v_rows=row_count;
  if v_rows=0 then return private.blackjack_public_state(p_room_id); end if;

  v_from:=v_room.version;

  update public.blackjack_players
  set stack=stack-p_amount,
      current_bet=p_amount,
      bet_locked=true,
      insurance_bet=0,
      insurance_decided=false,
      hand_cards='{}',
      hand_value=null,
      hand_status='none',
      result=null,
      round_delta=0,
      updated_at=clock_timestamp()
  where room_id=p_room_id and user_id=p_user_id;

  update public.blackjack_rooms
  set version=version+1,last_activity_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=p_room_id;

  if not exists(
    select 1 from public.blackjack_players
    where room_id=p_room_id and active and stack>=v_room.min_bet and not bet_locked
  ) then
    perform private.blackjack_deal_round_locked(p_room_id,p_deck);
    v_dealt:=true;
  end if;

  perform private.blackjack_emit_event(
    p_room_id,
    case when v_dealt then
      case
        when (select phase from public.blackjack_rooms where id=p_room_id)='settlement' then 'round_settled'
        else 'round_started'
      end
    else 'player_changed'
    end,
    v_from,
    case when v_dealt then null else p_user_id end
  );

  return private.blackjack_public_state(p_room_id);
end;
$$;

create or replace function public.blackjack_insurance_service(
  p_room_id uuid,
  p_user_id uuid,
  p_take boolean,
  p_action_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_room public.blackjack_rooms%rowtype;
  v_player public.blackjack_players%rowtype;
  v_secret private.blackjack_secrets%rowtype;
  v_amount numeric(10,1):=0;
  v_rows integer;
  v_from bigint;
  v_dealer_bj boolean;
begin
  if exists(
    select 1 from private.blackjack_actions
    where action_id=p_action_id and room_id=p_room_id and user_id=p_user_id
  ) then
    return private.blackjack_public_state(p_room_id);
  end if;

  select * into v_room
  from public.blackjack_rooms
  where id=p_room_id
  for update;
  if not found then raise exception '房间不存在'; end if;
  if v_room.phase<>'insurance' then raise exception '当前不能购买保险'; end if;

  select * into v_player
  from public.blackjack_players
  where room_id=p_room_id and user_id=p_user_id and active and bet_locked and current_bet>0
  for update;
  if not found then raise exception '本局没有有效下注'; end if;
  if v_player.insurance_decided then raise exception '保险选择已经确认'; end if;

  if p_take then
    v_amount:=v_player.current_bet/2;
    if v_player.stack<v_amount then raise exception '筹码不足，无法购买保险'; end if;
  end if;

  insert into private.blackjack_actions(action_id,room_id,user_id,action)
  values(p_action_id,p_room_id,p_user_id,'insurance')
  on conflict do nothing;
  get diagnostics v_rows=row_count;
  if v_rows=0 then return private.blackjack_public_state(p_room_id); end if;

  v_from:=v_room.version;

  update public.blackjack_players
  set stack=stack-v_amount,
      insurance_bet=v_amount,
      insurance_decided=true,
      updated_at=clock_timestamp()
  where room_id=p_room_id and user_id=p_user_id;

  update public.blackjack_rooms
  set version=version+1,last_activity_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=p_room_id;

  if not exists(
    select 1 from public.blackjack_players
    where room_id=p_room_id and active and bet_locked and current_bet>0 and not insurance_decided
  ) then
    select * into v_secret from private.blackjack_secrets where room_id=p_room_id;
    v_dealer_bj:=private.blackjack_is_blackjack(v_secret.dealer_cards);

    if v_dealer_bj then
      perform private.blackjack_finish_settlement_locked(p_room_id);
    else
      update public.blackjack_rooms
      set phase='player_action',version=version+1,updated_at=clock_timestamp()
      where id=p_room_id;
      perform private.blackjack_activate_all_players(p_room_id);

      if not exists(
        select 1 from private.blackjack_hands
        where room_id=p_room_id and status='active'
      ) then
        perform private.blackjack_finish_settlement_locked(p_room_id);
      end if;
    end if;
  end if;

  perform private.blackjack_emit_event(
    p_room_id,
    case
      when (select phase from public.blackjack_rooms where id=p_room_id)='settlement' then 'round_settled'
      when (select phase from public.blackjack_rooms where id=p_room_id)='player_action' then 'players_changed'
      else 'player_changed'
    end,
    v_from,
    case
      when (select phase from public.blackjack_rooms where id=p_room_id)='insurance' then p_user_id
      else null
    end
  );

  return private.blackjack_public_state(p_room_id);
end;
$$;

create or replace function public.blackjack_casino_action_service(
  p_room_id uuid,
  p_user_id uuid,
  p_hand_id uuid,
  p_action text,
  p_expected_token uuid,
  p_action_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_room public.blackjack_rooms%rowtype;
  v_player public.blackjack_players%rowtype;
  v_hand private.blackjack_hands%rowtype;
  v_secret private.blackjack_secrets%rowtype;
  v_cards text[];
  v_value integer;
  v_rows integer;
  v_from bigint;
  v_new_hand_no integer;
  v_split_card text;
  v_is_aces boolean;
begin
  if p_action not in ('hit','stand','double','split','surrender') then raise exception '未知操作'; end if;

  if exists(
    select 1 from private.blackjack_actions
    where action_id=p_action_id and room_id=p_room_id and user_id=p_user_id
  ) then
    return private.blackjack_public_state(p_room_id);
  end if;

  select * into v_room
  from public.blackjack_rooms
  where id=p_room_id
  for update;
  if not found or v_room.status<>'playing' or v_room.phase<>'player_action' then
    raise exception '当前不能操作';
  end if;
  v_from:=v_room.version;

  select * into v_player
  from public.blackjack_players
  where room_id=p_room_id and user_id=p_user_id and active
  for update;
  if not found then raise exception '你不在这个房间'; end if;

  select * into v_hand
  from private.blackjack_hands
  where id=p_hand_id and room_id=p_room_id and user_id=p_user_id
  for update;
  if not found then raise exception '手牌不存在'; end if;
  if v_hand.status<>'active' then raise exception '这手牌已经完成操作'; end if;
  if v_hand.action_token is distinct from p_expected_token then
    raise exception using message='操作状态已更新，请重试',errcode='40001';
  end if;

  if exists(
    select 1 from private.blackjack_hands
    where room_id=p_room_id and user_id=p_user_id and status='active'
      and hand_no<v_hand.hand_no
  ) then
    raise exception '请先完成当前手牌';
  end if;

  insert into private.blackjack_actions(action_id,room_id,user_id,action)
  values(p_action_id,p_room_id,p_user_id,p_action)
  on conflict do nothing;
  get diagnostics v_rows=row_count;
  if v_rows=0 then return private.blackjack_public_state(p_room_id); end if;

  if p_action in ('hit','double','split') then
    select * into v_secret
    from private.blackjack_secrets
    where room_id=p_room_id
    for update;
    if not found or v_secret.draw_index>52 then raise exception '牌堆状态异常'; end if;
  end if;

  if p_action='stand' then
    update private.blackjack_hands
    set status='stand',action_token=null,decision_deadline=null,updated_at=clock_timestamp()
    where id=p_hand_id;

  elsif p_action='surrender' then
    if coalesce(array_length(v_hand.cards,1),0)<>2 or v_hand.from_split or v_hand.doubled then
      raise exception '当前不能投降';
    end if;
    update private.blackjack_hands
    set status='surrender',action_token=null,decision_deadline=null,updated_at=clock_timestamp()
    where id=p_hand_id;

  elsif p_action='hit' then
    v_cards:=v_hand.cards||v_secret.deck[v_secret.draw_index];
    v_value:=private.blackjack_hand_value(v_cards);

    update private.blackjack_secrets
    set draw_index=draw_index+1,updated_at=clock_timestamp()
    where room_id=p_room_id;

    update private.blackjack_hands
    set cards=v_cards,
        hand_value=v_value,
        status=case when v_value>21 then 'bust' when v_value=21 then 'stand' else 'active' end,
        action_token=null,
        decision_deadline=null,
        updated_at=clock_timestamp()
    where id=p_hand_id;

  elsif p_action='double' then
    if coalesce(array_length(v_hand.cards,1),0)<>2 or v_hand.split_aces then
      raise exception '当前不能加倍';
    end if;
    if v_player.stack<v_hand.bet then raise exception '筹码不足，无法加倍'; end if;

    update public.blackjack_players
    set stack=stack-v_hand.bet,updated_at=clock_timestamp()
    where room_id=p_room_id and user_id=p_user_id;

    v_cards:=v_hand.cards||v_secret.deck[v_secret.draw_index];
    v_value:=private.blackjack_hand_value(v_cards);

    update private.blackjack_secrets
    set draw_index=draw_index+1,updated_at=clock_timestamp()
    where room_id=p_room_id;

    update private.blackjack_hands
    set cards=v_cards,
        hand_value=v_value,
        bet=bet*2,
        doubled=true,
        status=case when v_value>21 then 'bust' else 'stand' end,
        action_token=null,
        decision_deadline=null,
        updated_at=clock_timestamp()
    where id=p_hand_id;

  elsif p_action='split' then
    if coalesce(array_length(v_hand.cards,1),0)<>2 then raise exception '当前不能分牌'; end if;
    if private.blackjack_card_rank(v_hand.cards[1])<>private.blackjack_card_rank(v_hand.cards[2]) then
      raise exception '只有相同点数牌可以分牌';
    end if;
    if (select count(*) from private.blackjack_hands
        where room_id=p_room_id and user_id=p_user_id)>=4 then
      raise exception '最多只能分成 4 手牌';
    end if;
    if v_player.stack<v_hand.bet then raise exception '筹码不足，无法分牌'; end if;

    v_is_aces:=private.blackjack_card_rank(v_hand.cards[1])='A';
    if v_is_aces and v_hand.from_split then raise exception '分 A 后不能再次分 A'; end if;

    update public.blackjack_players
    set stack=stack-v_hand.bet,updated_at=clock_timestamp()
    where room_id=p_room_id and user_id=p_user_id;

    select coalesce(max(hand_no),0)+1 into v_new_hand_no
    from private.blackjack_hands
    where room_id=p_room_id and user_id=p_user_id;

    v_split_card:=v_hand.cards[2];

    v_cards:=array[v_hand.cards[1],v_secret.deck[v_secret.draw_index]];
    v_value:=private.blackjack_hand_value(v_cards);

    update private.blackjack_hands
    set cards=v_cards,
        hand_value=v_value,
        status=case
          when v_is_aces then 'stand'
          when v_value>21 then 'bust'
          when v_value=21 then 'stand'
          else 'active'
        end,
        from_split=true,
        split_aces=v_is_aces,
        action_token=null,
        decision_deadline=null,
        updated_at=clock_timestamp()
    where id=p_hand_id;

    v_cards:=array[v_split_card,v_secret.deck[v_secret.draw_index+1]];
    v_value:=private.blackjack_hand_value(v_cards);

    insert into private.blackjack_hands(
      room_id,user_id,hand_no,cards,hand_value,status,bet,
      from_split,split_aces
    )
    values(
      p_room_id,p_user_id,v_new_hand_no,v_cards,v_value,
      case
        when v_is_aces then 'stand'
        when v_value>21 then 'bust'
        when v_value=21 then 'stand'
        else 'active'
      end,
      v_hand.bet,true,v_is_aces
    );

    update private.blackjack_secrets
    set draw_index=draw_index+2,updated_at=clock_timestamp()
    where room_id=p_room_id;
  end if;

  perform private.blackjack_activate_player_hand(p_room_id,p_user_id);

  update public.blackjack_rooms
  set version=version+1,last_activity_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=p_room_id;

  if not exists(
    select 1 from private.blackjack_hands
    where room_id=p_room_id and status='active'
  ) then
    perform private.blackjack_finish_settlement_locked(p_room_id);
  end if;

  perform private.blackjack_emit_event(
    p_room_id,
    case when (select phase from public.blackjack_rooms where id=p_room_id)='settlement'
      then 'round_settled' else 'player_changed' end,
    v_from,
    case when (select phase from public.blackjack_rooms where id=p_room_id)='settlement'
      then null else p_user_id end
  );

  return private.blackjack_public_state(p_room_id);
end;
$$;

create or replace function public.blackjack_casino_action_gateway_service(
  p_room_id uuid,
  p_user_id uuid,
  p_hand_id uuid,
  p_action text,
  p_expected_token uuid,
  p_action_id uuid,
  p_device_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_action not in ('hit','stand','double','split','surrender') then raise exception '未知操作'; end if;

  if not public.flappy_rate_limit_check(
    private.blackjack_rate_key(p_user_id),
    'blackjack:'||p_action,
    120,
    60
  ) then
    raise exception using message='请求过于频繁，请稍后再试',errcode='P4290';
  end if;

  perform private.blackjack_assert_device(p_room_id,p_user_id,p_device_id);

  return public.blackjack_casino_action_service(
    p_room_id,p_user_id,p_hand_id,p_action,p_expected_token,p_action_id
  );
end;
$$;

create or replace function public.blackjack_timeout_service(p_room_id uuid,p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_room public.blackjack_rooms%rowtype;
  v_before bigint;
  v_rows integer;
begin
  if not exists(
    select 1 from public.blackjack_players
    where room_id=p_room_id and user_id=p_user_id and active
  ) then
    raise exception '你不在这个房间';
  end if;

  select * into v_room
  from public.blackjack_rooms
  where id=p_room_id
  for update;
  if not found then raise exception '房间不存在'; end if;
  v_before:=v_room.version;

  if v_room.phase='player_action' then
    update private.blackjack_hands
    set status='stand',action_token=null,decision_deadline=null,updated_at=clock_timestamp()
    where room_id=p_room_id
      and status='active'
      and decision_deadline is not null
      and decision_deadline<=clock_timestamp();
    get diagnostics v_rows=row_count;

    if v_rows>0 then
      perform private.blackjack_activate_all_players(p_room_id);
      update public.blackjack_rooms
      set version=version+1,last_activity_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=p_room_id;

      if not exists(
        select 1 from private.blackjack_hands
        where room_id=p_room_id and status='active'
      ) then
        perform private.blackjack_finish_settlement_locked(p_room_id);
      end if;
    end if;
  end if;

  if (select version from public.blackjack_rooms where id=p_room_id)<>v_before then
    perform private.blackjack_emit_event(
      p_room_id,
      case when (select phase from public.blackjack_rooms where id=p_room_id)='settlement'
        then 'round_settled' else 'players_changed' end,
      v_before,null
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
set search_path=''
as $$
declare
  v_room public.blackjack_rooms%rowtype;
  v_rows integer;
  v_from bigint;
  v_finish boolean;
begin
  if exists(
    select 1 from private.blackjack_actions
    where action_id=p_action_id and room_id=p_room_id and user_id=p_user_id
  ) then
    return private.blackjack_public_state(p_room_id);
  end if;

  select * into v_room
  from public.blackjack_rooms
  where id=p_room_id
  for update;
  if not found then raise exception '房间不存在'; end if;
  if not exists(
    select 1 from public.blackjack_players
    where room_id=p_room_id and user_id=p_user_id and active
  ) then raise exception '你不在这个房间'; end if;
  if v_room.phase<>'settlement' then return private.blackjack_public_state(p_room_id); end if;
  if v_room.summary_until is not null and v_room.summary_until>clock_timestamp() then
    return private.blackjack_public_state(p_room_id);
  end if;

  insert into private.blackjack_actions(action_id,room_id,user_id,action)
  values(p_action_id,p_room_id,p_user_id,'advance')
  on conflict do nothing;
  get diagnostics v_rows=row_count;
  if v_rows=0 then return private.blackjack_public_state(p_room_id); end if;

  v_from:=v_room.version;
  v_finish:=v_room.current_round>=v_room.round_limit or not exists(
    select 1 from public.blackjack_players
    where room_id=p_room_id and active and stack>=v_room.min_bet
  );

  if v_finish then
    update public.blackjack_rooms
    set status='finished',phase='finished',summary_until=null,finished_at=clock_timestamp(),
        version=version+1,last_activity_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=p_room_id;

    perform private.blackjack_finalize_match(p_room_id,'finished');
    perform private.blackjack_emit_event(p_room_id,'game_finished',v_from,null);
  else
    delete from private.blackjack_hands where room_id=p_room_id;
    delete from private.blackjack_secrets where room_id=p_room_id;

    update public.blackjack_players
    set round_start_stack=stack,
        current_bet=0,
        bet_locked=case when stack<v_room.min_bet then true else false end,
        insurance_bet=0,
        insurance_decided=false,
        hand_cards='{}',
        hand_value=null,
        hand_status='none',
        round_delta=0,
        result=null,
        action_token=null,
        decision_deadline=null,
        updated_at=clock_timestamp()
    where room_id=p_room_id and active;

    update public.blackjack_rooms
    set current_round=current_round+1,
        phase='betting',
        dealer_up_card=null,
        dealer_value=null,
        dealer_status='hidden',
        summary_until=null,
        version=version+1,
        last_activity_at=clock_timestamp(),
        updated_at=clock_timestamp()
    where id=p_room_id;

    perform private.blackjack_emit_event(p_room_id,'round_started',v_from,null);
  end if;

  return private.blackjack_public_state(p_room_id);
end;
$$;

create or replace function public.blackjack_play_again_service(p_room_id uuid,p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_room public.blackjack_rooms%rowtype;
begin
  select * into v_room
  from public.blackjack_rooms
  where id=p_room_id
  for update;
  if not found then raise exception '房间不存在'; end if;
  if v_room.host_user_id<>p_user_id then raise exception '只有房主可以发起下一场'; end if;
  if v_room.status<>'finished' then raise exception '当前不能重新开始'; end if;

  delete from private.blackjack_secrets where room_id=p_room_id;
  delete from private.blackjack_actions where room_id=p_room_id;
  delete from private.blackjack_hands where room_id=p_room_id;
  delete from private.blackjack_device_leases where room_id=p_room_id;

  update public.blackjack_players
  set score=0,
      stack=1000,
      round_start_stack=1000,
      current_bet=0,
      bet_locked=false,
      insurance_bet=0,
      insurance_decided=false,
      hand_cards='{}',
      hand_value=null,
      hand_status='none',
      round_delta=0,
      result=null,
      decision_deadline=null,
      action_token=null,
      ready=(user_id=p_user_id),
      updated_at=clock_timestamp()
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

create or replace function private.blackjack_finalize_match(p_room_id uuid,p_status text)
returns void
language plpgsql
security definer
set search_path=''
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

create or replace function private.blackjack_dashboard(
  p_user_id uuid,
  p_limit integer default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_history jsonb;
  v_stats jsonb;
begin
  select coalesce(
    jsonb_agg(to_jsonb(h) order by coalesce(h.finished_at,h.started_at) desc),
    '[]'::jsonb
  )
  into v_history
  from (
    select id,room_code,round_limit,status,players,rounds,started_at,finished_at
    from private.blackjack_match_history
    where participant_user_ids @> array[p_user_id]
      and status in ('finished','abandoned','closed')
      and expires_at>now()
    order by coalesce(finished_at,updated_at) desc
    limit greatest(1,least(coalesce(p_limit,12),20))
  ) h;

  with matches as (
    select *
    from private.blackjack_match_history
    where participant_user_ids @> array[p_user_id]
      and status in ('finished','abandoned','closed')
      and expires_at>now()
  ),
  rounds as (
    select h.id,
           h.status,
           r.round_json,
           p.player_json
    from matches h
    cross join lateral jsonb_array_elements(coalesce(h.rounds,'[]'::jsonb)) r(round_json)
    cross join lateral jsonb_array_elements(coalesce(r.round_json->'players','[]'::jsonb)) p(player_json)
    where p.player_json->>'user_id'=p_user_id::text
  ),
  hands as (
    select r.id,r.status,h.hand_json
    from rounds r
    cross join lateral jsonb_array_elements(coalesce(r.player_json->'hands','[]'::jsonb)) h(hand_json)
  ),
  final_players as (
    select h.id,h.status,p.player_json
    from matches h
    cross join lateral jsonb_array_elements(coalesce(h.players,'[]'::jsonb)) p(player_json)
    where p.player_json->>'user_id'=p_user_id::text
  )
  select jsonb_build_object(
    'matches',(select count(*)::integer from matches),
    'completed_matches',(select count(*)::integer from matches where status='finished'),
    'interrupted_matches',(select count(*)::integer from matches where status in ('abandoned','closed')),
    'rounds',(select count(*)::integer from rounds),
    'wins',(select count(*)::integer from rounds where (player_json->>'net_chips')::numeric>0),
    'pushes',(select count(*)::integer from rounds where (player_json->>'net_chips')::numeric=0),
    'losses',(select count(*)::integer from rounds where (player_json->>'net_chips')::numeric<0),
    'win_rate_pct',coalesce((
      select round(
        count(*) filter(where (player_json->>'net_chips')::numeric>0)::numeric*100/nullif(count(*),0),
        1
      ) from rounds
    ),0),
    'blackjacks',(select count(*)::integer from hands where hand_json->>'status'='blackjack'),
    'busts',(select count(*)::integer from hands where hand_json->>'status'='bust'),
    'bust_rate_pct',coalesce((
      select round(
        count(*) filter(where hand_json->>'status'='bust')::numeric*100/nullif(count(*),0),
        1
      ) from hands
    ),0),
    'avg_stand_value',coalesce((
      select round(avg((hand_json->>'value')::numeric),1)
      from hands
      where hand_json->>'status' in ('stand','blackjack')
        and hand_json->>'value' is not null
        and (hand_json->>'value')::numeric<=21
    ),0),
    'best_match_score',coalesce((
      select max((player_json->>'stack')::numeric)
      from final_players where status='finished'
    ),0),
    'net_chips',coalesce((
      select sum((player_json->>'net_chips')::numeric) from rounds
    ),0),
    'doubles',(select count(*)::integer from hands where coalesce((hand_json->>'doubled')::boolean,false)),
    'split_hands',(select count(*)::integer from hands where coalesce((hand_json->>'from_split')::boolean,false)),
    'surrenders',(select count(*)::integer from hands where hand_json->>'status'='surrender'),
    'retention_days',180,
    'recent_rounds',coalesce((
      select jsonb_agg(x.item order by x.settled_at desc)
      from (
        select jsonb_build_object(
          'match_id',r.id,
          'round',coalesce((r.round_json->>'round')::integer,0),
          'result',case
            when (r.player_json->>'net_chips')::numeric>0 then 'win'
            when (r.player_json->>'net_chips')::numeric<0 then 'loss'
            else 'push'
          end,
          'delta',(r.player_json->>'net_chips')::numeric,
          'value',null,
          'hand_status','casino',
          'settled_at',coalesce((r.round_json->>'settled_at')::timestamptz,now())
        ) item,
        coalesce((r.round_json->>'settled_at')::timestamptz,now()) settled_at
        from rounds r
        order by settled_at desc
        limit 10
      ) x
    ),'[]'::jsonb)
  )
  into v_stats;

  return jsonb_build_object(
    'history',coalesce(v_history,'[]'::jsonb),
    'stats',coalesce(v_stats,'{}'::jsonb)
  );
end;
$$;

revoke all on private.blackjack_hands from public,anon,authenticated;
revoke all on function private.blackjack_card_rank(text) from public,anon,authenticated;
revoke all on function private.blackjack_is_ten_value(text) from public,anon,authenticated;
revoke all on function private.blackjack_player_hands_json(uuid,uuid,numeric) from public,anon,authenticated;
revoke all on function private.blackjack_activate_player_hand(uuid,uuid) from public,anon,authenticated;
revoke all on function private.blackjack_activate_all_players(uuid) from public,anon,authenticated;
revoke all on function private.blackjack_deal_round_locked(uuid,text[]) from public,anon,authenticated;
revoke all on function private.blackjack_finish_settlement_locked(uuid) from public,anon,authenticated;

revoke all on function public.blackjack_bet_service(uuid,uuid,numeric,text[],uuid) from public,anon,authenticated;
revoke all on function public.blackjack_insurance_service(uuid,uuid,boolean,uuid) from public,anon,authenticated;
revoke all on function public.blackjack_casino_action_service(uuid,uuid,uuid,text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.blackjack_casino_action_gateway_service(uuid,uuid,uuid,text,uuid,uuid,uuid) from public,anon,authenticated;

grant execute on function public.blackjack_bet_service(uuid,uuid,numeric,text[],uuid) to service_role;
grant execute on function public.blackjack_insurance_service(uuid,uuid,boolean,uuid) to service_role;
grant execute on function public.blackjack_casino_action_service(uuid,uuid,uuid,text,uuid,uuid) to service_role;
grant execute on function public.blackjack_casino_action_gateway_service(uuid,uuid,uuid,text,uuid,uuid,uuid) to service_role;

comment on table private.blackjack_hands is
  'V1.4 authoritative per-hand wager/action state for Double, Split and Surrender.';
comment on function public.blackjack_bet_service(uuid,uuid,numeric,text[],uuid) is
  'Server-only confirmed match-local wager. UI chip composition remains client-side until confirmation.';
comment on function public.blackjack_casino_action_gateway_service(uuid,uuid,uuid,text,uuid,uuid,uuid) is
  'Server-only V1.4 action gateway with device ownership and rate limiting.';
