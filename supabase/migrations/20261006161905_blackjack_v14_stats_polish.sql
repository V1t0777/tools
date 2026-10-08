-- Restore longest-win-streak statistic for Blackjack V1.4 casino dashboard.

create or replace function private.blackjack_longest_win_streak(p_user_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_result text;
  v_current integer:=0;
  v_longest integer:=0;
begin
  for v_result in
    with matches as (
      select *
      from private.blackjack_match_history
      where participant_user_ids @> array[p_user_id]
        and status in ('finished','abandoned','closed')
        and expires_at>now()
    )
    select case
      when (p.player_json->>'net_chips')::numeric>0 then 'win'
      when (p.player_json->>'net_chips')::numeric<0 then 'loss'
      else 'push'
    end
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

  return v_longest;
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
set search_path=''
as $$
  with d as (
    select private.blackjack_dashboard(p_user_id,p_limit) as payload
  )
  select payload || jsonb_build_object(
    'stats',
    coalesce(payload->'stats','{}'::jsonb) ||
      jsonb_build_object('longest_win_streak',private.blackjack_longest_win_streak(p_user_id))
  )
  from d;
$$;

revoke all on function private.blackjack_longest_win_streak(uuid) from public,anon,authenticated;
grant execute on function private.blackjack_longest_win_streak(uuid) to service_role;
revoke all on function public.blackjack_dashboard_service(uuid,integer) from public,anon,authenticated;
grant execute on function public.blackjack_dashboard_service(uuid,integer) to service_role;
