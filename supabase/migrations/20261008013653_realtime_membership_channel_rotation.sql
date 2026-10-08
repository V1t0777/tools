-- Supabase Realtime caches authorization for existing channels. A random per-room
-- channel token is rotated transactionally on membership/session revocation.
-- New subscriptions must match the current nonce; superseded topics receive no
-- authoritative server messages. Old malicious sockets cannot be disconnected
-- synchronously at the Supabase gateway; see docs/realtime-revocation.md.
ALTER TABLE public.pictionary_rooms ADD COLUMN realtime_token uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.pictionary_rooms ADD COLUMN realtime_generation bigint NOT NULL DEFAULT 0;
ALTER TABLE public.blackjack_rooms ADD COLUMN realtime_token uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.blackjack_rooms ADD COLUMN realtime_generation bigint NOT NULL DEFAULT 0;
CREATE OR REPLACE FUNCTION private.is_pictionary_topic_member(p_topic text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.has_active_session() and exists(
    select 1
    from public.pictionary_players pp
    join public.members m on m.user_id = pp.user_id
    join public.pictionary_rooms pr on pr.id = pp.room_id
    where pp.user_id = (select auth.uid())
      and pp.active
      and pr.status not in ('closed','abandoned')
      and p_topic = 'pictionary:' || pp.room_id::text || ':' || pr.realtime_token::text
  );
$function$;

CREATE OR REPLACE FUNCTION private.is_pictionary_topic_drawer(p_topic text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.has_active_session() and exists(
    select 1
    from public.pictionary_rooms pr
    where pr.current_drawer_user_id=(select auth.uid())
      and pr.status='playing'
      and p_topic='pictionary:'||pr.id::text||':'||pr.realtime_token::text
  );
$function$;

CREATE OR REPLACE FUNCTION private.is_pictionary_guess_sender(p_topic text, p_payload jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    private.has_active_session()
    and jsonb_typeof(p_payload)='object'
    and char_length(trim(coalesce(p_payload->>'text',''))) between 1 and 40
    and char_length(coalesce(p_payload->>'client_id','')) between 1 and 100
    and octet_length(p_payload::text) <= 2048
    and exists(
      select 1
      from public.pictionary_rooms pr
      join public.pictionary_players pp
        on pp.room_id=pr.id
       and pp.user_id=(select auth.uid())
       and pp.active
      join public.members m
        on m.user_id=pp.user_id
      join public.pictionary_rounds rd
        on rd.room_id=pr.id
       and rd.round_no=pr.current_round_no
      where pr.status='playing'
        and pr.current_drawer_user_id<>(select auth.uid())
        and p_topic='pictionary:'||pr.id::text||':'||pr.realtime_token::text
        and m.id::text=p_payload->>'member_id'
        and rd.id::text=p_payload->>'round_id'
    );
$function$;

CREATE OR REPLACE FUNCTION private.is_blackjack_topic_member(p_topic text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.has_active_session() and exists(
    select 1
    from public.blackjack_players bp
    join public.members m on m.user_id=bp.user_id
    join public.blackjack_rooms br on br.id=bp.room_id
    where bp.user_id=(select auth.uid())
      and bp.active
      and br.status not in ('closed','abandoned')
      and p_topic='blackjack:'||bp.room_id::text||':'||br.realtime_token::text
  );
$function$;

CREATE OR REPLACE FUNCTION public.pictionary_emit_event_service(p_room_id uuid, p_event text, p_payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if p_event <> 'state_sync' then
    raise exception 'unsupported pictionary realtime event';
  end if;
  if p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or octet_length(p_payload::text) > 65536 then
    raise exception 'pictionary realtime payload invalid';
  end if;
  perform realtime.send(
    p_payload,
    p_event,
    'pictionary:'||p_room_id::text||':'||(select realtime_token::text from public.pictionary_rooms where id=p_room_id),
    true
  );
end;
$function$;

CREATE OR REPLACE FUNCTION private.blackjack_public_state(p_room_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      'realtime_token',v_room.realtime_token,
      'realtime_generation',v_room.realtime_generation,
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
$function$;


-- Every session/room membership revocation invalidates the old channel address.
CREATE OR REPLACE FUNCTION private.rotate_room_realtime_topic(p_game text,p_room uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  v_old uuid;
BEGIN
  IF p_game='pictionary' THEN
    SELECT realtime_token INTO v_old FROM public.pictionary_rooms WHERE id=p_room FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;
    UPDATE public.pictionary_rooms SET realtime_token=gen_random_uuid(),
      realtime_generation=realtime_generation+1 WHERE id=p_room;
  ELSIF p_game='blackjack' THEN
    SELECT realtime_token INTO v_old FROM public.blackjack_rooms WHERE id=p_room FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;
    UPDATE public.blackjack_rooms SET realtime_token=gen_random_uuid(),
      realtime_generation=realtime_generation+1 WHERE id=p_room;
  ELSE
    RAISE EXCEPTION 'unsupported game';
  END IF;

  -- Old subscribers see only a non-secret rotation signal. They cannot derive
  -- the replacement random topic. No client can publish this event type via RLS.
  BEGIN
    PERFORM realtime.send(
      jsonb_build_object('room_id',p_room),
      'channel_rotated',
      p_game||':'||p_room::text||':'||v_old::text,
      true
    );
  EXCEPTION WHEN OTHERS THEN
    -- Realtime transport failure must not roll back security rekey.
    RAISE WARNING 'realtime rotation notice failed: %', SQLSTATE;
  END;
END;
$body$;

REVOKE ALL ON FUNCTION private.rotate_room_realtime_topic(text,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.rekey_game_player_revocation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $body$
BEGIN
  IF TG_OP='DELETE' OR (OLD.active AND NOT NEW.active) THEN
    PERFORM private.rotate_room_realtime_topic(TG_ARGV[0],OLD.room_id);
  END IF;
  RETURN NULL;
END;
$body$;
REVOKE ALL ON FUNCTION private.rekey_game_player_revocation() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER pictionary_rekey_removed_player
AFTER UPDATE OF active OR DELETE ON public.pictionary_players
FOR EACH ROW EXECUTE FUNCTION private.rekey_game_player_revocation('pictionary');
CREATE TRIGGER blackjack_rekey_removed_player
AFTER UPDATE OF active OR DELETE ON public.blackjack_players
FOR EACH ROW EXECUTE FUNCTION private.rekey_game_player_revocation('blackjack');

CREATE OR REPLACE FUNCTION private.rekey_rooms_for_user(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $body$
DECLARE v_room uuid;
BEGIN
  FOR v_room IN SELECT DISTINCT room_id FROM public.pictionary_players
      WHERE user_id=p_user_id AND active
  LOOP
    PERFORM private.rotate_room_realtime_topic('pictionary',v_room);
  END LOOP;
  FOR v_room IN SELECT DISTINCT room_id FROM public.blackjack_players
      WHERE user_id=p_user_id AND active
  LOOP
    PERFORM private.rotate_room_realtime_topic('blackjack',v_room);
  END LOOP;
END;
$body$;
REVOKE ALL ON FUNCTION private.rekey_rooms_for_user(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.rekey_rooms_on_member_revocation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $body$
BEGIN
  PERFORM private.rekey_rooms_for_user(OLD.user_id);
  RETURN NULL;
END;
$body$;
REVOKE ALL ON FUNCTION private.rekey_rooms_on_member_revocation() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER members_rekey_on_revoke
BEFORE DELETE ON public.members
FOR EACH ROW EXECUTE FUNCTION private.rekey_rooms_on_member_revocation();

CREATE OR REPLACE FUNCTION private.rekey_rooms_on_session_revocation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $body$
BEGIN
  PERFORM private.rekey_rooms_for_user(OLD.user_id);
  RETURN NULL;
END;
$body$;
REVOKE ALL ON FUNCTION private.rekey_rooms_on_session_revocation() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER auth_sessions_rekey_on_revoke
AFTER DELETE ON auth.sessions
FOR EACH ROW EXECUTE FUNCTION private.rekey_rooms_on_session_revocation();

-- Authoritative guess receipts, blackjack snapshots and game events are also nonce-scoped.
CREATE OR REPLACE FUNCTION private.blackjack_broadcast_state(p_room_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_payload jsonb;
begin
  v_payload := private.blackjack_public_state(p_room_id);
  if v_payload is not null then
    perform realtime.send(v_payload,'state_snapshot','blackjack:'||p_room_id::text||':'||(select realtime_token::text from public.blackjack_rooms where id=p_room_id),true);
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.blackjack_emit_event(p_room_id uuid, p_event_type text, p_from_version bigint, p_actor_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  perform realtime.send(v_payload,'game_event','blackjack:'||p_room_id::text||':'||(select realtime_token::text from public.blackjack_rooms where id=p_room_id),true);
  return v_payload;
end;
$function$;

CREATE OR REPLACE FUNCTION public.pictionary_submit_guess_service(p_room_id uuid, p_user_id uuid, p_guess text, p_client_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room public.pictionary_rooms%rowtype;
  v_round public.pictionary_rounds%rowtype;
  v_guess text;
  v_answer text;
  v_correct boolean := false;
  v_first boolean := false;
  v_points integer := 0;
  v_rank integer := 0;
  v_guessers integer := 0;
  v_member_id uuid;
  v_drawer_member_id uuid;
  v_nickname text;
  v_guess_id uuid;
  v_created_at timestamptz;
  v_round_complete boolean := false;
begin
  if p_guess is null or char_length(trim(p_guess)) < 1 or char_length(p_guess) > 40 then
    raise exception '请输入 1–40 个字符的答案';
  end if;

  select * into v_room
  from public.pictionary_rooms
  where id = p_room_id
  for update;

  if not found then raise exception '房间不存在'; end if;
  if v_room.status <> 'playing' or v_room.ends_at <= now() then raise exception '本轮已结束'; end if;
  if v_room.current_drawer_user_id = p_user_id then raise exception '画手不能参与猜题'; end if;

  select m.id, coalesce(m.nickname, pp.display_name)
    into v_member_id, v_nickname
  from public.pictionary_players pp
  left join public.members m on m.user_id = pp.user_id
  where pp.room_id = p_room_id
    and pp.user_id = p_user_id
    and pp.active;

  if not found then raise exception '你不在这个房间'; end if;

  select m.id into v_drawer_member_id
  from public.members m
  where m.user_id = v_room.current_drawer_user_id;

  select * into v_round
  from public.pictionary_rounds
  where room_id = p_room_id
    and round_no = v_room.current_round_no;

  v_guess := lower(regexp_replace(
    translate(trim(p_guess),'，。！？、；：“”‘’（）《》·',''),
    '[[:space:][:punct:]]','','g'
  ));
  v_answer := lower(regexp_replace(
    translate(trim(v_round.answer),'，。！？、；：“”‘’（）《》·',''),
    '[[:space:][:punct:]]','','g'
  ));
  v_correct := v_guess = v_answer;

  if v_correct and exists(
    select 1 from public.pictionary_round_results
    where round_id = v_round.id and user_id = p_user_id
  ) then
    return jsonb_build_object(
      'correct',true,'points',0,'already_correct',true,
      'round_complete',false,'client_id',p_client_id
    );
  end if;

  if v_correct then
    select count(*) + 1 into v_rank
    from public.pictionary_round_results
    where round_id = v_round.id;

    v_first := v_rank = 1;
    v_points := 100
      + greatest(0,least(100,floor(extract(epoch from (v_room.ends_at-now()))*100/60)::integer))
      + case when v_first then 30 else 0 end;
  end if;

  insert into public.pictionary_guesses(
    room_id,round_id,user_id,guess_text,is_correct,score_awarded,client_id
  )
  values(
    p_room_id,v_round.id,p_user_id,trim(p_guess),v_correct,v_points,p_client_id
  )
  returning id,created_at into v_guess_id,v_created_at;

  if v_correct then
    insert into public.pictionary_round_results(round_id,user_id,rank,points)
    values(v_round.id,p_user_id,v_rank,v_points);

    update public.pictionary_players
    set score=score+v_points,updated_at=now()
    where room_id=p_room_id and user_id=p_user_id;

    update public.pictionary_players
    set score=score+50,updated_at=now()
    where room_id=p_room_id and user_id=v_room.current_drawer_user_id;

    select greatest(count(*)-1,0) into v_guessers
    from public.pictionary_players
    where room_id=p_room_id and active;

    v_round_complete := v_rank>=v_guessers and v_guessers>0;

    if v_round_complete then
      update public.pictionary_rooms
      set status='summary',
          ends_at=null,
          summary_until=now()+interval '6 seconds',
          last_activity_at=now(),
          updated_at=now()
      where id=p_room_id;

      update public.pictionary_rounds
      set status='ended',ended_at=now()
      where id=v_round.id;
    else
      update public.pictionary_rooms
      set last_activity_at=now()
      where id=p_room_id;
    end if;
  else
    update public.pictionary_rooms
    set last_activity_at=now()
    where id=p_room_id;
  end if;

  perform realtime.send(
    jsonb_build_object(
      'guess_id',v_guess_id,
      'client_id',p_client_id,
      'round_id',v_round.id,
      'member_id',v_member_id,
      'drawer_member_id',v_drawer_member_id,
      'nickname',v_nickname,
      'text',case when v_correct then '' else trim(p_guess) end,
      'correct',v_correct,
      'points',v_points,
      'first',v_first,
      'round_complete',v_round_complete,
      'created_at',v_created_at
    ),
    'guess_result',
    'pictionary:' || p_room_id::text||':'||(select realtime_token::text from public.pictionary_rooms where id=p_room_id),
    true
  );

  return jsonb_build_object(
    'guess_id',v_guess_id,
    'client_id',p_client_id,
    'created_at',v_created_at,
    'correct',v_correct,
    'points',v_points,
    'first',v_first,
    'round_complete',v_round_complete
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.pictionary_submit_guess_v2(p_room_id uuid, p_user_id uuid, p_guess text, p_client_id uuid, p_round_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_room public.pictionary_rooms%rowtype;
  v_existing public.pictionary_guesses%rowtype;
  v_receipt jsonb;
  v_round public.pictionary_rounds%rowtype;
  v_guess text;
  v_answer text;
  v_correct boolean := false;
  v_first boolean := false;
  v_points integer := 0;
  v_rank integer := 0;
  v_guessers integer := 0;
  v_member_id uuid;
  v_drawer_member_id uuid;
  v_nickname text;
  v_guess_id uuid;
  v_created_at timestamptz;
  v_round_complete boolean := false;
begin
  if p_guess is null or char_length(trim(p_guess)) < 1 or char_length(p_guess) > 40 then
    raise exception '请输入 1–40 个字符的答案';
  end if;

  select * into v_room
  from public.pictionary_rooms
  where id = p_room_id
  for update;

  if not found then raise exception '房间不存在'; end if;
  if p_client_id is null or p_round_id is null then raise exception '页面已更新，请刷新后继续'; end if;
  if not exists(select 1 from public.pictionary_players where room_id=p_room_id and user_id=p_user_id and active)
    then raise exception '你不在这个房间'; end if;
  select * into v_existing from public.pictionary_guesses
    where room_id=p_room_id and round_id=p_round_id and user_id=p_user_id and client_id=p_client_id;
  if found then
    if v_existing.guess_text<>trim(p_guess) then raise exception '消息编号重复，请重新输入'; end if;
    if v_existing.delivery_receipt is not null then return v_existing.delivery_receipt; end if;
    return jsonb_build_object('guess_id',v_existing.id,'client_id',p_client_id,'round_id',p_round_id,
      'correct',v_existing.is_correct,'points',v_existing.score_awarded,'text',case when v_existing.is_correct then '' else v_existing.guess_text end,
      'created_at',v_existing.created_at,'score_state',public.pictionary_score_state_service(p_room_id));
  end if;
  if not exists(select 1 from public.pictionary_rounds where id=p_round_id and room_id=p_room_id and round_no=v_room.current_round_no)
    then raise exception '轮次已切换，请重新输入'; end if;
  if v_room.status <> 'playing' or v_room.ends_at <= clock_timestamp() then raise exception '本轮已结束'; end if;
  if v_room.current_drawer_user_id = p_user_id then raise exception '画手不能参与猜题'; end if;

  select m.id, coalesce(m.nickname, pp.display_name)
    into v_member_id, v_nickname
  from public.pictionary_players pp
  left join public.members m on m.user_id = pp.user_id
  where pp.room_id = p_room_id
    and pp.user_id = p_user_id
    and pp.active;

  if not found then raise exception '你不在这个房间'; end if;

  select m.id into v_drawer_member_id
  from public.members m
  where m.user_id = v_room.current_drawer_user_id;

  select * into v_round
  from public.pictionary_rounds
  where room_id = p_room_id
    and round_no = v_room.current_round_no;

  v_guess := lower(regexp_replace(
    translate(trim(p_guess),'，。！？、；：“”‘’（）《》·',''),
    '[[:space:][:punct:]]','','g'
  ));
  v_answer := lower(regexp_replace(
    translate(trim(v_round.answer),'，。！？、；：“”‘’（）《》·',''),
    '[[:space:][:punct:]]','','g'
  ));
  v_correct := v_guess = v_answer;

  if v_correct and exists(
    select 1 from public.pictionary_round_results
    where round_id = v_round.id and user_id = p_user_id
  ) then
    select * into v_existing from public.pictionary_guesses where round_id=v_round.id and user_id=p_user_id and is_correct limit 1;
    return coalesce(v_existing.delivery_receipt,jsonb_build_object(
      'guess_id',v_existing.id,'client_id',v_existing.client_id,'round_id',v_round.id,'member_id',v_member_id,
      'correct',true,'points',0,'round_complete',false,'score_state',public.pictionary_score_state_service(p_room_id)
    ))||jsonb_build_object('already_correct',true);
  end if;

  if v_correct then
    select count(*) + 1 into v_rank
    from public.pictionary_round_results
    where round_id = v_round.id;

    v_first := v_rank = 1;
    v_points := 100
      + greatest(0,least(100,floor(extract(epoch from (v_room.ends_at-clock_timestamp()))*100/60)::integer))
      + case when v_first then 30 else 0 end;
  end if;

  insert into public.pictionary_guesses(
    room_id,round_id,user_id,guess_text,is_correct,score_awarded,client_id
  )
  values(
    p_room_id,v_round.id,p_user_id,trim(p_guess),v_correct,v_points,p_client_id
  )
  returning id,created_at into v_guess_id,v_created_at;

  if v_correct then
    insert into public.pictionary_round_results(round_id,user_id,rank,points)
    values(v_round.id,p_user_id,v_rank,v_points);

    update public.pictionary_players
    set score=score+v_points,updated_at=now()
    where room_id=p_room_id and user_id=p_user_id;

    update public.pictionary_players
    set score=score+50,updated_at=now()
    where room_id=p_room_id and user_id=v_room.current_drawer_user_id;

    select greatest(count(*)-1,0) into v_guessers
    from public.pictionary_players
    where room_id=p_room_id and active;

    v_round_complete := v_rank>=v_guessers and v_guessers>0;

    if v_round_complete then
      update public.pictionary_rooms
      set status='summary',
          ends_at=null,
          summary_until=now()+interval '3.2 seconds',
          last_activity_at=now(),
          updated_at=now()
      where id=p_room_id;

      update public.pictionary_rounds
      set status='ended',ended_at=now()
      where id=v_round.id;
    else
      update public.pictionary_rooms
      set last_activity_at=now()
      where id=p_room_id;
    end if;
  else
    update public.pictionary_rooms
    set last_activity_at=now()
    where id=p_room_id;
  end if;

  v_receipt := jsonb_build_object(
    'guess_id',v_guess_id,'client_id',p_client_id,'round_id',v_round.id,
    'member_id',v_member_id,'drawer_member_id',v_drawer_member_id,'nickname',v_nickname,
    'text',case when v_correct then '' else trim(p_guess) end,
    'correct',v_correct,'points',v_points,'first',v_first,'round_complete',v_round_complete,
    'created_at',v_created_at,'score_state',public.pictionary_score_state_service(p_room_id)
  );
  update public.pictionary_guesses set delivery_receipt=v_receipt where id=v_guess_id;
  perform realtime.send(v_receipt,'guess_result','pictionary:'||p_room_id::text||':'||(select realtime_token::text from public.pictionary_rooms where id=p_room_id),true);
  return v_receipt;
end;
$function$;
