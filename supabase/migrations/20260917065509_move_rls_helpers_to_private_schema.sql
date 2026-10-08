create schema if not exists private;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter table public.app_access set schema private;
alter table public.admin_users set schema private;

revoke all on table private.app_access from anon, authenticated;
revoke all on table private.admin_users from anon, authenticated;

create or replace function private.has_app_role(p_app_code text, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.app_access aa
    where aa.user_id = (select auth.uid())
      and aa.app_code = p_app_code
      and aa.role = any(p_roles)
  );
$$;

create or replace function private.current_member_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
  from public.members m
  where m.user_id = (select auth.uid())
  limit 1;
$$;

create or replace function private.is_dinner_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.dinner_group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = (select auth.uid())
  );
$$;

create or replace function private.is_dinner_group_admin(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.dinner_group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = (select auth.uid())
      and gm.role = 'admin'
  );
$$;

revoke execute on function private.has_app_role(text,text[]) from public, anon, authenticated;
revoke execute on function private.current_member_id() from public, anon, authenticated;
revoke execute on function private.is_dinner_group_member(uuid) from public, anon, authenticated;
revoke execute on function private.is_dinner_group_admin(uuid) from public, anon, authenticated;
grant execute on function private.has_app_role(text,text[]) to authenticated;
grant execute on function private.current_member_id() to authenticated;
grant execute on function private.is_dinner_group_member(uuid) to authenticated;
grant execute on function private.is_dinner_group_admin(uuid) to authenticated;

alter policy members_can_read_members on public.members
  using (
    (select private.has_app_role('night_shift', array['viewer','editor','admin']::text[]))
    or (select private.has_app_role('department_roster', array['viewer','editor','admin']::text[]))
  );

alter policy night_shift_authorized_read on public.night_shifts
  using ((select private.has_app_role('night_shift', array['viewer','editor','admin']::text[])));
alter policy night_shift_editor_delete_own on public.night_shifts
  using (
    (select private.has_app_role('night_shift', array['editor','admin']::text[]))
    and member_id = (select private.current_member_id())
  );
alter policy night_shift_editor_insert_own on public.night_shifts
  with check (
    (select private.has_app_role('night_shift', array['editor','admin']::text[]))
    and member_id = (select private.current_member_id())
  );
alter policy night_shift_editor_update_own on public.night_shifts
  using (
    (select private.has_app_role('night_shift', array['editor','admin']::text[]))
    and member_id = (select private.current_member_id())
  )
  with check (
    (select private.has_app_role('night_shift', array['editor','admin']::text[]))
    and member_id = (select private.current_member_id())
  );

alter policy department_roster_read_duty_types on public.duty_types
  using ((select private.has_app_role('department_roster', array['viewer','editor','admin']::text[])));
alter policy department_roster_admin_insert_duty_types on public.duty_types
  with check ((select private.has_app_role('department_roster', array['admin']::text[])));
alter policy department_roster_admin_update_duty_types on public.duty_types
  using ((select private.has_app_role('department_roster', array['admin']::text[])))
  with check ((select private.has_app_role('department_roster', array['admin']::text[])));
alter policy department_roster_admin_delete_duty_types on public.duty_types
  using ((select private.has_app_role('department_roster', array['admin']::text[])));

alter policy department_roster_read_staff on public.staff
  using ((select private.has_app_role('department_roster', array['viewer','editor','admin']::text[])));
alter policy department_roster_admin_insert_staff on public.staff
  with check ((select private.has_app_role('department_roster', array['admin']::text[])));
alter policy department_roster_admin_update_staff on public.staff
  using ((select private.has_app_role('department_roster', array['admin']::text[])))
  with check ((select private.has_app_role('department_roster', array['admin']::text[])));
alter policy department_roster_admin_delete_staff on public.staff
  using ((select private.has_app_role('department_roster', array['admin']::text[])));

alter policy department_roster_read_schedule on public.schedule_assignments
  using ((select private.has_app_role('department_roster', array['viewer','editor','admin']::text[])));
alter policy department_roster_admin_insert_schedule on public.schedule_assignments
  with check ((select private.has_app_role('department_roster', array['admin']::text[])));
alter policy department_roster_admin_update_schedule on public.schedule_assignments
  using ((select private.has_app_role('department_roster', array['admin']::text[])))
  with check ((select private.has_app_role('department_roster', array['admin']::text[])));
alter policy department_roster_admin_delete_schedule on public.schedule_assignments
  using ((select private.has_app_role('department_roster', array['admin']::text[])));

alter policy dinner_groups_member_select on public.dinner_groups
  using (private.is_dinner_group_member(id));
alter policy dinner_group_members_member_select on public.dinner_group_members
  using (private.is_dinner_group_member(group_id));

alter policy dinner_candidates_member_select on public.dinner_candidates
  using (private.is_dinner_group_member(group_id));
alter policy dinner_candidates_member_insert on public.dinner_candidates
  with check (private.is_dinner_group_member(group_id) and created_by = (select auth.uid()));
alter policy dinner_candidates_member_update on public.dinner_candidates
  using (private.is_dinner_group_member(group_id))
  with check (private.is_dinner_group_member(group_id));
alter policy dinner_candidates_member_delete on public.dinner_candidates
  using (private.is_dinner_group_member(group_id));

alter policy dinner_history_member_select on public.dinner_history
  using (private.is_dinner_group_member(group_id));
alter policy dinner_history_member_insert on public.dinner_history
  with check (private.is_dinner_group_member(group_id) and created_by = (select auth.uid()));
alter policy dinner_history_member_update on public.dinner_history
  using (private.is_dinner_group_member(group_id))
  with check (private.is_dinner_group_member(group_id));
alter policy dinner_history_member_delete on public.dinner_history
  using (private.is_dinner_group_member(group_id));

alter policy dinner_group_state_member_select on public.dinner_group_state
  using (private.is_dinner_group_member(group_id));
alter policy dinner_group_state_member_insert on public.dinner_group_state
  with check (private.is_dinner_group_member(group_id) and updated_by = (select auth.uid()));
alter policy dinner_group_state_member_update on public.dinner_group_state
  using (private.is_dinner_group_member(group_id))
  with check (private.is_dinner_group_member(group_id) and updated_by = (select auth.uid()));

drop function if exists public.can_access_department_roster();
drop function if exists public.can_access_night_shift();
drop function if exists public.is_admin();
drop function if exists public.current_member_id();
drop function if exists public.is_dinner_group_admin(uuid);
drop function if exists public.is_dinner_group_member(uuid);
drop function if exists public.has_app_role(text,text[]);

alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
