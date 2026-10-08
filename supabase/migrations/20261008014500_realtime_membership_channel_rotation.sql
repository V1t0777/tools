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
