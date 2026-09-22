-- Run inside a transaction after the migration, as service_role, then ROLLBACK.
-- Existing member IDs are used only for foreign keys; all fixture rows roll back.
set local role service_role;
do $$
declare
 users uuid[]; rid uuid:=gen_random_uuid(); roundid uuid:=gen_random_uuid();
 wrongid uuid:=gen_random_uuid(); correctid uuid:=gen_random_uuid();
 first jsonb; retry jsonb; out jsonb; n integer; rejected boolean;
begin
 select array_agg(user_id) into users from (select user_id from public.members where user_id is not null order by id limit 2) m;
 if coalesce(array_length(users,1),0)<2 then raise exception 'Two existing members required for rolled-back regression fixture'; end if;
 insert into public.pictionary_rooms(id,room_code,host_user_id,status,current_round_no,total_rounds,current_drawer_user_id,ends_at)
 values(rid,translate(upper(substr(replace(rid::text,'-',''),1,6)),'01','XY'),users[1],'playing',1,4,users[1],clock_timestamp()+interval '60 seconds');
 insert into public.pictionary_players(room_id,user_id,display_name,seat,ready) values(rid,users[1],'fixture-drawer',1,true),(rid,users[2],'fixture-guesser',2,true);
 insert into public.pictionary_rounds(id,room_id,round_no,drawer_user_id,status,answer,started_at,ends_at)
 values(roundid,rid,1,users[1],'drawing','猫',clock_timestamp(),clock_timestamp()+interval '60 seconds');

 out:=public.pictionary_save_canvas_service(rid,roundid,users[1],200,'[{"id":"new","color":"#111827","size":7,"points":[[0,0]]}]');
 if (out->>'version')::bigint<>200 then raise exception 'new canvas version not stored'; end if;
 out:=public.pictionary_save_canvas_service(rid,roundid,users[1],150,'[]');
 if (out->>'accepted')::boolean or (select canvas_state->0->>'id' from public.pictionary_rounds where id=roundid)<>'new' then raise exception 'stale canvas replaced latest'; end if;
 out:=public.pictionary_save_canvas_service(rid,roundid,users[1],200,'[]');
 if not (out->>'accepted')::boolean or (select canvas_state->0->>'id' from public.pictionary_rounds where id=roundid)<>'new' then raise exception 'same revision was not idempotent'; end if;
 rejected:=false;
 begin perform public.pictionary_save_canvas_service(rid,roundid,users[2],300,'[]'); exception when others then rejected:=true; end;
 if not rejected then raise exception 'non-drawer wrote canvas'; end if;

 first:=public.pictionary_submit_guess_v2(rid,users[2],'狗',wrongid,roundid);
 retry:=public.pictionary_submit_guess_v2(rid,users[2],'狗',wrongid,roundid);
 if first<>retry then raise exception 'wrong guess retry returned different receipt'; end if;
 select count(*) into n from public.pictionary_guesses where room_id=rid;
 if n<>1 then raise exception 'duplicate wrong guess was inserted'; end if;
 rejected:=false;
 begin perform public.pictionary_submit_guess_v2(rid,users[2],'猫',wrongid,roundid); exception when others then rejected:=true; end;
 if not rejected then raise exception 'same client id accepted different text'; end if;
 rejected:=false;
 begin perform public.pictionary_submit_guess_v2(rid,users[2],'猫',gen_random_uuid(),gen_random_uuid()); exception when others then rejected:=true; end;
 if not rejected then raise exception 'stale round guess was accepted'; end if;

 first:=public.pictionary_submit_guess_v2(rid,users[2],'猫',correctid,roundid);
 if not (first->>'correct')::boolean or not (first->>'round_complete')::boolean then raise exception 'correct guess failed'; end if;
 if (first->'score_state'->>'revision')::bigint<>2 then raise exception 'score revision not incremented for both players'; end if;
 if (select score from public.pictionary_players where room_id=rid and user_id=users[2])<>(first->>'points')::integer then raise exception 'guesser total mismatch'; end if;
 if (select score from public.pictionary_players where room_id=rid and user_id=users[1])<>50 then raise exception 'drawer total mismatch'; end if;
 retry:=public.pictionary_submit_guess_v2(rid,users[2],'猫',correctid,roundid);
 if first<>retry then raise exception 'correct guess retry after round end not idempotent'; end if;
 select count(*) into n from public.pictionary_guesses where room_id=rid;
 if n<>2 then raise exception 'retry changed guess count'; end if;
 if (select score_revision from public.pictionary_rooms where id=rid)<>2 then raise exception 'retry changed scores'; end if;
end;
$$;
reset role;
select 'pictionary transactional regression passed; fixture will be rolled back' as result;
