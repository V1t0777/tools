create or replace function public.current_member_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select private.current_member_id();
$$;

create or replace function public.can_access_night_shift()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.has_app_role('night_shift', array['viewer','editor','admin']::text[]);
$$;

create or replace function public.can_access_department_roster()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.has_app_role('department_roster', array['viewer','editor','admin']::text[]);
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.has_app_role('department_roster', array['admin']::text[]);
$$;

create or replace function public.toolbox_session_status()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'active', private.has_active_session(),
    'member_id', private.current_member_id(),
    'night_shift', private.has_app_role('night_shift', array['viewer','editor','admin']::text[]),
    'department_roster', private.has_app_role('department_roster', array['viewer','editor','admin']::text[]),
    'department_roster_admin', private.has_app_role('department_roster', array['admin']::text[])
  );
$$;

revoke all on function public.current_member_id() from public, anon;
revoke all on function public.can_access_night_shift() from public, anon;
revoke all on function public.can_access_department_roster() from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.toolbox_session_status() from public, anon;

grant execute on function public.current_member_id() to authenticated;
grant execute on function public.can_access_night_shift() to authenticated;
grant execute on function public.can_access_department_roster() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.toolbox_session_status() to authenticated;