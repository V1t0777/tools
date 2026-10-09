begin;

alter table public.pictionary_rooms
 add column if not exists state_revision bigint not null default 0;

create or replace function private.pictionary_bump_state_revision()
returns trigger language plpgsql set search_path to '' as $$
begin
  new.state_revision:=old.state_revision+1;
  return new;
end;$$;
revoke all on function private.pictionary_bump_state_revision() from public,anon,authenticated;
drop trigger if exists pictionary_state_revision_bump on public.pictionary_rooms;
create trigger pictionary_state_revision_bump before update on public.pictionary_rooms
 for each row execute function private.pictionary_bump_state_revision();

-- Sender is identified by a JWT-backed session, never by a client-supplied ID.
create or replace function public.pictionary_identity_v3()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_session jsonb;v_member jsonb;
begin
 v_session:=public.toolbox_session_status();
 if coalesce((v_session->>'active')::boolean,false) is not true
    or v_session->>'member_id' is null then return null;end if;
 select jsonb_build_object('id',m.id,'user_id',m.user_id,'nickname',m.nickname,'color',m.color)
 into v_member from public.members m
 where m.id=(v_session->>'member_id')::uuid and m.user_id=(select auth.uid());
 return v_member;
end;$$;
revoke all on function public.pictionary_identity_v3() from public,anon,authenticated;
grant execute on function public.pictionary_identity_v3() to authenticated;

-- One internal RPC, strictly server-side, with membership checks and
-- drawer-only answer/options and 30-second hint confidentiality.
create or replace function public.pictionary_state_snapshot_v3(p_room_id uuid,p_user_id uuid)
returns jsonb language plpgsql stable security invoker set search_path to '' as $$
declare
 v_room public.pictionary_rooms%rowtype;
 v_round public.pictionary_rounds%rowtype;
 v_players jsonb:='[]'::jsonb;
 v_guesses jsonb:='[]'::jsonb;
 v_solved jsonb:='[]'::jsonb;
 v_options jsonb:=null;
 v_round_payload jsonb:=null;
 v_answer text:=null;
 v_revealed text:=null;
 v_score jsonb;
 v_host_member uuid;
 v_drawer_member uuid;
 v_drawer_name text;
 v_hint_unlocked boolean:=false;
begin
 select * into v_room from public.pictionary_rooms where id=p_room_id;
 if not found then raise exception 'ROOM_NOT_FOUND';end if;
 if not exists(select 1 from public.pictionary_players p
      where p.room_id=p_room_id and p.user_id=p_user_id and p.active)
 then raise exception 'NOT_ROOM_MEMBER';end if;

 select m.id into v_host_member from public.members m where m.user_id=v_room.host_user_id;
 select m.id into v_drawer_member from public.members m where m.user_id=v_room.current_drawer_user_id;

 select coalesce(jsonb_agg(jsonb_build_object(
    'member_id',coalesce(m.id,p.user_id),
    'nickname',coalesce(m.nickname,p.display_name),
    'color',coalesce(m.color,'#8EC5FF'),
    'turn_order',p.seat-1,
    'score',p.score,'ready',p.ready,'joined_at',p.joined_at
 ) order by p.seat),'[]'::jsonb)
 into v_players from public.pictionary_players p
 left join public.members m on m.user_id=p.user_id
 where p.room_id=p_room_id and p.active;

 if v_room.current_round_no>0 then
   select * into v_round from public.pictionary_rounds rd
   where rd.room_id=p_room_id and rd.round_no=v_room.current_round_no;
   if found then
     select coalesce(m.nickname,p.display_name,'好友') into v_drawer_name
     from public.pictionary_players p
     left join public.members m on m.user_id=p.user_id
     where p.room_id=p_room_id and p.user_id=v_round.drawer_user_id;
     v_hint_unlocked:=p_user_id=v_round.drawer_user_id
       or v_room.status in ('summary','finished')
       or (v_room.status='playing' and v_round.ends_at is not null
           and v_round.ends_at-clock_timestamp()<=interval '30 seconds');

     v_round_payload:=jsonb_build_object(
       'id',v_round.id,'round_number',v_round.round_no,
       'drawer_member_id',coalesce(v_drawer_member,v_round.drawer_user_id),
       'drawer_nickname',coalesce(v_drawer_name,'好友'),
       'category',case when v_hint_unlocked then v_round.category else null end,
       'difficulty',v_round.difficulty,
       'char_count',v_round.word_length,
       'hint',case when v_hint_unlocked then coalesce(v_round.hint,'它属于「'||coalesce(v_round.category,'常见事物')||'」类') else null end,
       'started_at',v_round.started_at,'ends_at',v_round.ends_at);

     if p_user_id=v_round.drawer_user_id then v_answer:=v_round.answer;end if;
     if v_room.status in ('summary','finished') then v_revealed:=v_round.answer;end if;

     select coalesce(jsonb_agg(jsonb_build_object(
       'id',g.id,'client_id',g.client_id,
       'member_id',coalesce(m.id,g.user_id),
       'nickname',coalesce(m.nickname,p.display_name,'好友'),
       'text',case when g.is_correct then '' else g.guess_text end,
       'is_correct',g.is_correct,'score_awarded',g.score_awarded,
       'created_at',g.created_at
     ) order by g.created_at,g.id),'[]'::jsonb)
     into v_guesses
     from (select * from public.pictionary_guesses
           where round_id=v_round.id order by created_at desc,id desc limit 100) g
     left join public.members m on m.user_id=g.user_id
     left join public.pictionary_players p on p.room_id=p_room_id and p.user_id=g.user_id;

     select coalesce(jsonb_agg(coalesce(m.id,rr.user_id)),'[]'::jsonb)
     into v_solved
     from public.pictionary_round_results rr
     left join public.members m on m.user_id=rr.user_id
     where rr.round_id=v_round.id;

     if v_room.status='choosing' and v_room.current_drawer_user_id=p_user_id then
       select coalesce(jsonb_agg(jsonb_build_object(
         'id',w.id::text,'word',w.word,'category',w.category,'difficulty',w.difficulty
       )),'[]'::jsonb)
       into v_options from public.pictionary_words w
       where w.id=any(v_round.option_word_ids);
     end if;
   end if;
 end if;
 v_score:=public.pictionary_score_state_service(p_room_id);
 return jsonb_build_object(
  'room',jsonb_build_object(
    'id',v_room.id,'code',v_room.room_code,
    'realtime_token',v_room.realtime_token,
    'realtime_generation',v_room.realtime_generation,
    'state_revision',v_room.state_revision,
    'host_member_id',coalesce(v_host_member,v_room.host_user_id),
    'status',v_room.status,'round_no',v_room.current_round_no,
    'rounds_per_player',v_room.rounds_per_player,
    'total_rounds',v_room.total_rounds,
    'current_drawer_member_id',coalesce(v_drawer_member,v_room.current_drawer_user_id),
    'ends_at',v_room.ends_at,'summary_until',v_room.summary_until
  ),
  'players',v_players,'round',v_round_payload,
  'answer',v_answer,'revealed_answer',v_revealed,
  'options',v_options,'guesses',v_guesses,
  'solved_members',v_solved,'score_state',v_score
 );
end;$$;
revoke all on function public.pictionary_state_snapshot_v3(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pictionary_state_snapshot_v3(uuid,uuid) to service_role;

-- Transactional completion event, after server-side validation and scoring.
-- The answer is revealed only once the room actually enters summary.
create or replace function private.pictionary_notify_summary_v3()
returns trigger language plpgsql set search_path to '' as $$
declare v_answer text;v_score jsonb;
begin
 if new.status='summary' and old.status is distinct from 'summary' then
   select rd.answer into v_answer from public.pictionary_rounds rd
    where rd.room_id=new.id and rd.round_no=new.current_round_no;
   v_score:=public.pictionary_score_state_service(new.id);
   perform realtime.send(
      jsonb_build_object(
        'room_id',new.id,
        'room',jsonb_build_object('id',new.id,'status','summary',
          'state_revision',new.state_revision,'round_no',new.current_round_no,
          'summary_until',new.summary_until,'ends_at',null),
        'revealed_answer',v_answer,'score_state',v_score),
      'room_transition',
      'pictionary:'||new.id::text||':'||new.realtime_token::text,
      true
   );
 end if;
 return new;
end;$$;
revoke all on function private.pictionary_notify_summary_v3() from public,anon,authenticated;
drop trigger if exists pictionary_summary_notify_v3 on public.pictionary_rooms;
create trigger pictionary_summary_notify_v3
after update of status on public.pictionary_rooms
for each row execute function private.pictionary_notify_summary_v3();

commit;
