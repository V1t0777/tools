-- Blackjack V1.1 performance pass.
-- Keeps the Edge Function boundary but reduces hot-path DB round trips and lock duration.

create or replace function public.blackjack_session_context()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null or not private.has_active_session() then null
    else (
      select jsonb_build_object(
        'id', m.id,
        'user_id', m.user_id,
        'nickname', m.nickname,
        'color', m.color
      )
      from public.members m
      where m.id=private.current_member_id()
        and m.user_id=auth.uid()
      limit 1
    )
  end;
$$;

revoke all on function public.blackjack_session_context() from public,anon;
grant execute on function public.blackjack_session_context() to authenticated;

create or replace function private.blackjack_rate_key(p_user_id uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest('blackjack|'||p_user_id::text,'sha256'),'hex');
$$;

revoke all on function private.blackjack_rate_key(uuid) from public,anon,authenticated;
grant execute on function private.blackjack_rate_key(uuid) to service_role;

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
begin
  if p_action not in ('hit','stand') then raise exception '未知操作'; end if;

  if exists(
    select 1 from private.blackjack_actions
    where action_id=p_action_id and room_id=p_room_id and user_id=p_user_id
  ) then
    return private.blackjack_public_state(p_room_id);
  end if;

  -- Lock only the acting player's row first. Different players can prepare their
  -- actions concurrently; HIT additionally serializes only on the secret deck row.
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
    select * into v_secret
    from private.blackjack_secrets
    where room_id=p_room_id
    for update;
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

  -- This is the only room-row serialization in a normal action. The conditional
  -- update also turns a concurrent room close/phase change into a transaction rollback.
  update public.blackjack_rooms
  set version=version+1,last_activity_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=p_room_id and status='playing' and phase='player_action';
  get diagnostics v_room_rows = row_count;
  if v_room_rows=0 then raise exception '当前不能操作'; end if;

  perform private.blackjack_settle_locked(p_room_id);
  perform private.blackjack_broadcast_state(p_room_id);
  return private.blackjack_public_state(p_room_id);
end;
$$;

create or replace function public.blackjack_action_gateway_service(
  p_room_id uuid,p_user_id uuid,p_action text,p_expected_token uuid,p_action_id uuid
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

  return public.blackjack_action_service(
    p_room_id,p_user_id,p_action,p_expected_token,p_action_id
  );
end;
$$;

revoke all on function public.blackjack_action_gateway_service(uuid,uuid,text,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.blackjack_action_gateway_service(uuid,uuid,text,uuid,uuid)
  to service_role;

comment on function public.blackjack_session_context() is
  'One authenticated lookup for active toolbox session plus Blackjack member profile.';
comment on function public.blackjack_action_gateway_service(uuid,uuid,text,uuid,uuid) is
  'Server-only hot-path gateway combining Blackjack action rate limiting and mutation.';
