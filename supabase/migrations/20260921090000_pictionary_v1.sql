begin;

alter table public.pictionary_rooms drop constraint if exists pictionary_rooms_status_check;
update public.pictionary_rooms set status='lobby' where status='waiting';
alter table public.pictionary_rooms alter column status set default 'lobby';
alter table public.pictionary_rooms add constraint pictionary_rooms_status_check
  check (status in ('lobby','choosing','playing','summary','finished'));
alter table public.pictionary_rooms add column if not exists rounds_per_player smallint not null default 2
  check (rounds_per_player between 1 and 4);
alter table public.pictionary_rooms add column if not exists current_drawer_user_id uuid references auth.users(id) on delete set null;
alter table public.pictionary_rooms add column if not exists ends_at timestamptz;
alter table public.pictionary_rooms add column if not exists summary_until timestamptz;
alter table public.pictionary_rounds add column if not exists hint text;

create table if not exists public.pictionary_guesses (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.pictionary_rooms(id) on delete cascade,
  round_id uuid not null references public.pictionary_rounds(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  guess_text text not null check (char_length(guess_text) between 1 and 40),
  is_correct boolean not null default false,
  score_awarded integer not null default 0 check (score_awarded >= 0),
  created_at timestamptz not null default now()
);
create index if not exists pictionary_guesses_round_idx on public.pictionary_guesses(round_id,created_at);
create unique index if not exists pictionary_one_correct_guess_per_user
  on public.pictionary_guesses(round_id,user_id) where is_correct;
create index if not exists pictionary_players_user_room_idx on public.pictionary_players(user_id,room_id) where active;

alter table public.pictionary_guesses enable row level security;
revoke all on public.pictionary_rooms,public.pictionary_players,public.pictionary_rounds,
  public.pictionary_round_results,public.pictionary_words,public.pictionary_guesses from anon,authenticated;
grant select,insert,update,delete on public.pictionary_rooms,public.pictionary_players,public.pictionary_rounds,
  public.pictionary_round_results,public.pictionary_words,public.pictionary_guesses to service_role;

create or replace function private.is_pictionary_topic_member(p_topic text)
returns boolean language sql stable security definer set search_path=''
as $$
  select private.has_active_session() and exists(
    select 1 from public.pictionary_players pp
    join public.members m on m.user_id=pp.user_id
    where pp.user_id=(select auth.uid()) and pp.active
      and p_topic='pictionary:'||pp.room_id::text
  );
$$;
revoke all on function private.is_pictionary_topic_member(text) from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.is_pictionary_topic_member(text) to authenticated;

drop policy if exists "pictionary private realtime read" on realtime.messages;
drop policy if exists "pictionary private realtime write" on realtime.messages;
drop policy if exists "pictionary members receive realtime" on realtime.messages;
drop policy if exists "pictionary members send realtime" on realtime.messages;
create policy "pictionary members receive realtime" on realtime.messages
  for select to authenticated using(
    extension in ('broadcast','presence')
    and private.is_pictionary_topic_member((select realtime.topic()))
  );
create policy "pictionary members send realtime" on realtime.messages
  for insert to authenticated with check(
    extension in ('broadcast','presence')
    and private.is_pictionary_topic_member((select realtime.topic()))
  );

create or replace function public.pictionary_submit_guess_service(p_room_id uuid,p_user_id uuid,p_guess text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_room public.pictionary_rooms%rowtype;
  v_round public.pictionary_rounds%rowtype;
  v_guess text;
  v_answer text;
  v_correct boolean:=false;
  v_first boolean:=false;
  v_points integer:=0;
  v_rank integer:=0;
  v_guessers integer:=0;
begin
  if p_guess is null or char_length(trim(p_guess))<1 or char_length(p_guess)>40 then
    raise exception '请输入 1–40 个字符的答案';
  end if;
  select * into v_room from public.pictionary_rooms where id=p_room_id for update;
  if not found then raise exception '房间不存在'; end if;
  if v_room.status<>'playing' or v_room.ends_at<=now() then raise exception '本轮已结束'; end if;
  if v_room.current_drawer_user_id=p_user_id then raise exception '画手不能参与猜题'; end if;
  if not exists(select 1 from public.pictionary_players where room_id=p_room_id and user_id=p_user_id and active) then raise exception '你不在这个房间'; end if;
  select * into v_round from public.pictionary_rounds where room_id=p_room_id and round_no=v_room.current_round_no;
  v_guess:=lower(regexp_replace(translate(trim(p_guess),'，。！？、；：“”‘’（）《》·',''),'[[:space:][:punct:]]','','g'));
  v_answer:=lower(regexp_replace(translate(trim(v_round.answer),'，。！？、；：“”‘’（）《》·',''),'[[:space:][:punct:]]','','g'));
  v_correct:=v_guess=v_answer;
  if v_correct and exists(select 1 from public.pictionary_round_results where round_id=v_round.id and user_id=p_user_id) then
    return jsonb_build_object('correct',true,'points',0,'already_correct',true,'round_complete',false);
  end if;
  if v_correct then
    select count(*)+1 into v_rank from public.pictionary_round_results where round_id=v_round.id;
    v_first:=v_rank=1;
    v_points:=100+greatest(0,least(100,floor(extract(epoch from (v_room.ends_at-now()))*100/60)::integer))+case when v_first then 30 else 0 end;
  end if;
  insert into public.pictionary_guesses(room_id,round_id,user_id,guess_text,is_correct,score_awarded)
    values(p_room_id,v_round.id,p_user_id,trim(p_guess),v_correct,v_points);
  if v_correct then
    insert into public.pictionary_round_results(round_id,user_id,rank,points) values(v_round.id,p_user_id,v_rank,v_points);
    update public.pictionary_players set score=score+v_points,updated_at=now() where room_id=p_room_id and user_id=p_user_id;
    update public.pictionary_players set score=score+50,updated_at=now() where room_id=p_room_id and user_id=v_room.current_drawer_user_id;
    select greatest(count(*)-1,0) into v_guessers from public.pictionary_players where room_id=p_room_id and active;
    if v_rank>=v_guessers and v_guessers>0 then
      update public.pictionary_rooms set status='summary',ends_at=null,summary_until=now()+interval '6 seconds',updated_at=now() where id=p_room_id;
      update public.pictionary_rounds set status='ended',ended_at=now() where id=v_round.id;
    end if;
  end if;
  return jsonb_build_object('correct',v_correct,'points',v_points,'first',v_first,
    'round_complete',(v_correct and v_rank>=v_guessers and v_guessers>0));
end;
$$;
revoke all on function public.pictionary_submit_guess_service(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.pictionary_submit_guess_service(uuid,uuid,text) to service_role;

commit;
