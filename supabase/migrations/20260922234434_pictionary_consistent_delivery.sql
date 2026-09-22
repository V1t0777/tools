begin;
alter table public.pictionary_rooms add column if not exists score_revision bigint not null default 0;
alter table public.pictionary_guesses add column if not exists delivery_receipt jsonb;

-- Totals and revision are read in one MVCC snapshot. Only the authenticated Edge service calls this.
create or replace function public.pictionary_score_state_service(p_room_id uuid)
returns jsonb language sql stable security invoker set search_path=''
as $$
  select jsonb_build_object('revision',r.score_revision,'scores',coalesce((
    select jsonb_agg(jsonb_build_object('member_id',coalesce(m.id,p.user_id),'score',p.score))
    from public.pictionary_players p left join public.members m on m.user_id=p.user_id
    where p.room_id=r.id and p.active
  ),'[]'::jsonb)) from public.pictionary_rooms r where r.id=p_room_id;
$$;
revoke all on function public.pictionary_score_state_service(uuid) from public,anon,authenticated;
grant execute on function public.pictionary_score_state_service(uuid) to service_role;

create or replace function private.pictionary_score_changed()
returns trigger language plpgsql security invoker set search_path=''
as $$
begin
  update public.pictionary_rooms set score_revision=score_revision+1 where id=new.room_id;
  return new;
end;
$$;
revoke all on function private.pictionary_score_changed() from public,anon,authenticated;
drop trigger if exists pictionary_score_revision on public.pictionary_players;
create trigger pictionary_score_revision after update of score on public.pictionary_players
for each row when (old.score is distinct from new.score) execute function private.pictionary_score_changed();

create or replace function public.pictionary_submit_guess_v2(
  p_room_id uuid,
  p_user_id uuid,
  p_guess text,
  p_client_id uuid,
  p_round_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
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

  v_receipt := jsonb_build_object(
    'guess_id',v_guess_id,'client_id',p_client_id,'round_id',v_round.id,
    'member_id',v_member_id,'drawer_member_id',v_drawer_member_id,'nickname',v_nickname,
    'text',case when v_correct then '' else trim(p_guess) end,
    'correct',v_correct,'points',v_points,'first',v_first,'round_complete',v_round_complete,
    'created_at',v_created_at,'score_state',public.pictionary_score_state_service(p_room_id)
  );
  update public.pictionary_guesses set delivery_receipt=v_receipt where id=v_guess_id;
  perform realtime.send(v_receipt,'guess_result','pictionary:'||p_room_id::text,true);
  return v_receipt;
end;
$$;
revoke all on function public.pictionary_submit_guess_v2(uuid,uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.pictionary_submit_guess_v2(uuid,uuid,text,uuid,uuid) to service_role;

create or replace function public.pictionary_save_canvas_service(
 p_room_id uuid,p_round_id uuid,p_user_id uuid,p_revision bigint,p_strokes jsonb)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare
 r public.pictionary_rooms%rowtype;
 rd public.pictionary_rounds%rowtype;
begin
 select * into r from public.pictionary_rooms where id=p_room_id for update;
 if not found or r.status<>'playing' or r.current_drawer_user_id<>p_user_id or r.ends_at<=clock_timestamp()
   then raise exception '当前不能更新画布'; end if;
 if not exists(select 1 from public.pictionary_players where room_id=p_room_id and user_id=p_user_id and active)
   then raise exception '你不在这个房间'; end if;
 select * into rd from public.pictionary_rounds where id=p_round_id and room_id=p_room_id and round_no=r.current_round_no;
 if not found or rd.drawer_user_id<>p_user_id then raise exception '轮次已切换'; end if;
 if p_revision is null or p_revision<1 or p_revision>9007199254740991
   or jsonb_typeof(p_strokes)<>'array' or octet_length(p_strokes::text)>1200000
   then raise exception '画布数据无效或过大'; end if;
 if p_revision<=rd.canvas_version then
   return jsonb_build_object('ok',true,'accepted',p_revision=rd.canvas_version,'version',rd.canvas_version);
 end if;
 update public.pictionary_rounds set canvas_state=p_strokes,canvas_version=p_revision,canvas_updated_at=clock_timestamp() where id=p_round_id;
 update public.pictionary_rooms set last_activity_at=clock_timestamp() where id=p_room_id;
 return jsonb_build_object('ok',true,'accepted',true,'version',p_revision);
end;
$$;
revoke all on function public.pictionary_save_canvas_service(uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.pictionary_save_canvas_service(uuid,uuid,uuid,bigint,jsonb) to service_role;
commit;
