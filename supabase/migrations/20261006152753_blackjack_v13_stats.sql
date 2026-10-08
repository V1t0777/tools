-- Blackjack V1.3 personal statistics dashboard.
-- Statistics are derived from the existing private 180-day match history.

create or replace function private.blackjack_dashboard(
  p_user_id uuid,
  p_limit integer default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_history jsonb;
  v_stats jsonb;
  v_recent jsonb;
  v_longest integer:=0;
  v_current integer:=0;
  v_result text;
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
  round_rows as (
    select
      h.id as match_id,
      h.status as match_status,
      h.started_at,
      coalesce((r.round_json->>'settled_at')::timestamptz,h.started_at) as settled_at,
      coalesce((r.round_json->>'round')::integer,0) as round_no,
      p.player_json
    from matches h
    cross join lateral jsonb_array_elements(coalesce(h.rounds,'[]'::jsonb)) r(round_json)
    cross join lateral jsonb_array_elements(coalesce(r.round_json->'players','[]'::jsonb)) p(player_json)
    where p.player_json->>'user_id'=p_user_id::text
  ),
  match_scores as (
    select
      h.id as match_id,
      h.status as match_status,
      coalesce((p.player_json->>'score')::integer,0) as score
    from matches h
    cross join lateral jsonb_array_elements(coalesce(h.players,'[]'::jsonb)) p(player_json)
    where p.player_json->>'user_id'=p_user_id::text
  ),
  agg as (
    select
      count(*)::integer as rounds,
      count(*) filter(where player_json->>'result'='win')::integer as wins,
      count(*) filter(where player_json->>'result'='push')::integer as pushes,
      count(*) filter(where player_json->>'result'='loss')::integer as losses,
      count(*) filter(where player_json->>'hand_status'='blackjack')::integer as blackjacks,
      count(*) filter(where player_json->>'hand_status'='bust')::integer as busts,
      coalesce(sum(coalesce((player_json->>'round_delta')::integer,0)),0)::integer as total_delta,
      round(
        avg((player_json->>'hand_value')::numeric)
        filter(
          where player_json->>'hand_status'='stand'
            and (player_json->>'hand_value') is not null
            and (player_json->>'hand_value')::integer<=21
        ),
        1
      ) as avg_stand_value
    from round_rows
  )
  select jsonb_build_object(
    'matches',(select count(*)::integer from matches),
    'completed_matches',(select count(*)::integer from matches where status='finished'),
    'interrupted_matches',(select count(*)::integer from matches where status in ('abandoned','closed')),
    'rounds',a.rounds,
    'wins',a.wins,
    'pushes',a.pushes,
    'losses',a.losses,
    'win_rate_pct',case when a.rounds>0 then round(a.wins::numeric*100/a.rounds,1) else 0 end,
    'blackjacks',a.blackjacks,
    'busts',a.busts,
    'bust_rate_pct',case when a.rounds>0 then round(a.busts::numeric*100/a.rounds,1) else 0 end,
    'avg_stand_value',coalesce(a.avg_stand_value,0),
    'total_delta',a.total_delta,
    'best_match_score',coalesce(
      (select max(score) from match_scores where match_status='finished'),
      0
    )
  )
  into v_stats
  from agg a;

  for v_result in
    with matches as (
      select *
      from private.blackjack_match_history
      where participant_user_ids @> array[p_user_id]
        and status in ('finished','abandoned','closed')
        and expires_at>now()
    )
    select p.player_json->>'result'
    from matches h
    cross join lateral jsonb_array_elements(coalesce(h.rounds,'[]'::jsonb)) r(round_json)
    cross join lateral jsonb_array_elements(coalesce(r.round_json->'players','[]'::jsonb)) p(player_json)
    where p.player_json->>'user_id'=p_user_id::text
    order by
      coalesce((r.round_json->>'settled_at')::timestamptz,h.started_at),
      h.started_at,
      coalesce((r.round_json->>'round')::integer,0)
  loop
    if v_result='win' then
      v_current:=v_current+1;
      v_longest:=greatest(v_longest,v_current);
    else
      v_current:=0;
    end if;
  end loop;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'match_id',x.match_id,
        'round',x.round_no,
        'result',x.player_json->>'result',
        'delta',coalesce((x.player_json->>'round_delta')::integer,0),
        'value',case
          when x.player_json->>'hand_value' is null then null
          else (x.player_json->>'hand_value')::integer
        end,
        'hand_status',x.player_json->>'hand_status',
        'settled_at',x.settled_at
      )
      order by x.settled_at desc,x.match_id,x.round_no desc
    ),
    '[]'::jsonb
  )
  into v_recent
  from (
    with matches as (
      select *
      from private.blackjack_match_history
      where participant_user_ids @> array[p_user_id]
        and status in ('finished','abandoned','closed')
        and expires_at>now()
    )
    select
      h.id as match_id,
      coalesce((r.round_json->>'round')::integer,0) as round_no,
      coalesce((r.round_json->>'settled_at')::timestamptz,h.started_at) as settled_at,
      p.player_json
    from matches h
    cross join lateral jsonb_array_elements(coalesce(h.rounds,'[]'::jsonb)) r(round_json)
    cross join lateral jsonb_array_elements(coalesce(r.round_json->'players','[]'::jsonb)) p(player_json)
    where p.player_json->>'user_id'=p_user_id::text
    order by settled_at desc,h.id,round_no desc
    limit 10
  ) x;

  v_stats:=coalesce(v_stats,'{}'::jsonb)||jsonb_build_object(
    'longest_win_streak',v_longest,
    'recent_rounds',v_recent,
    'retention_days',180
  );

  return jsonb_build_object(
    'history',coalesce(v_history,'[]'::jsonb),
    'stats',v_stats
  );
end;
$$;

create or replace function public.blackjack_dashboard_service(
  p_user_id uuid,
  p_limit integer default 12
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.blackjack_dashboard(p_user_id,p_limit);
$$;

revoke all on function private.blackjack_dashboard(uuid,integer) from public,anon,authenticated;
revoke all on function public.blackjack_dashboard_service(uuid,integer) from public,anon,authenticated;
grant execute on function private.blackjack_dashboard(uuid,integer) to service_role;
grant execute on function public.blackjack_dashboard_service(uuid,integer) to service_role;

comment on function private.blackjack_dashboard(uuid,integer) is
  'Returns the signed-in player Blackjack history plus 180-day personal statistics.';
comment on function public.blackjack_dashboard_service(uuid,integer) is
  'Service-role-only invoker wrapper for the Blackjack personal dashboard.';
