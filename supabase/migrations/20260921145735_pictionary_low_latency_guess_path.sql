
alter table public.pictionary_guesses
  add column if not exists client_id uuid;

create unique index if not exists pictionary_guess_client_id_unique
  on public.pictionary_guesses(round_id, user_id, client_id)
  where client_id is not null;

drop function if exists public.pictionary_submit_guess_service(uuid,uuid,text);

create or replace function public.pictionary_submit_guess_service(
  p_room_id uuid,
  p_user_id uuid,
  p_guess text,
  p_client_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
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
    'pictionary:' || p_room_id::text,
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
$$;

revoke all on function public.pictionary_submit_guess_service(uuid,uuid,text,uuid)
  from public, anon, authenticated;
grant execute on function public.pictionary_submit_guess_service(uuid,uuid,text,uuid)
  to service_role;

drop policy if exists "pictionary members send realtime" on realtime.messages;
create policy "pictionary members send realtime"
on realtime.messages
for insert
to authenticated
with check (
  private.is_pictionary_topic_member((select realtime.topic()))
  and (
    extension = 'presence'
    or (
      extension = 'broadcast'
      and (
        event = any(array['state_changed'::text,'sync_request'::text,'ping'::text,'pong'::text])
        or (
          event = any(array['stroke'::text,'clear'::text,'undo'::text,'snapshot'::text])
          and private.is_pictionary_topic_drawer((select realtime.topic()))
        )
      )
    )
  )
);

