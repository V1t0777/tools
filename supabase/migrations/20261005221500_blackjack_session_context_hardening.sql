-- Keep the one-RPC session lookup without exposing a SECURITY DEFINER function
-- from the public API schema.

create or replace function private.blackjack_current_member_context()
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

revoke all on function private.blackjack_current_member_context() from public,anon;
grant execute on function private.blackjack_current_member_context() to authenticated;

create or replace function public.blackjack_session_context()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.blackjack_current_member_context();
$$;

revoke all on function public.blackjack_session_context() from public,anon;
grant execute on function public.blackjack_session_context() to authenticated;
