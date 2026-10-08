
create table if not exists public.app_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  app_code text not null,
  role text not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (user_id, app_code),
  constraint app_access_app_code_check
    check (app_code in ('night_shift','department_roster')),
  constraint app_access_role_check
    check (role in ('viewer','editor','admin'))
);

alter table public.app_access enable row level security;

revoke all on table public.app_access from public;
revoke all on table public.app_access from anon;
revoke all on table public.app_access from authenticated;

create or replace function public.has_app_role(
  p_app_code text,
  p_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_access aa
    where aa.user_id = auth.uid()
      and aa.app_code = p_app_code
      and aa.role = any(p_roles)
  );
$$;

revoke all on function public.has_app_role(text,text[]) from public;
revoke all on function public.has_app_role(text,text[]) from anon;
grant execute on function public.has_app_role(text,text[]) to authenticated;

create or replace function public.can_access_night_shift()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_app_role(
    'night_shift',
    array['viewer','editor','admin']::text[]
  );
$$;

revoke all on function public.can_access_night_shift() from public;
revoke all on function public.can_access_night_shift() from anon;
grant execute on function public.can_access_night_shift() to authenticated;

create or replace function public.can_access_department_roster()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_app_role(
    'department_roster',
    array['viewer','editor','admin']::text[]
  );
$$;

revoke all on function public.can_access_department_roster() from public;
revoke all on function public.can_access_department_roster() from anon;
grant execute on function public.can_access_department_roster() to authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_app_role(
    'department_roster',
    array['admin']::text[]
  );
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.is_admin() from anon;
grant execute on function public.is_admin() to authenticated;

drop policy if exists members_can_read_members on public.members;
create policy members_can_read_members
on public.members
for select
to authenticated
using (
  public.has_app_role('night_shift', array['viewer','editor','admin']::text[])
  or
  public.has_app_role('department_roster', array['viewer','editor','admin']::text[])
);

drop policy if exists members_can_read_all_shifts on public.night_shifts;
drop policy if exists members_can_insert_own_shifts on public.night_shifts;
drop policy if exists members_can_update_own_shifts on public.night_shifts;
drop policy if exists members_can_delete_own_shifts on public.night_shifts;

create policy night_shift_authorized_read
on public.night_shifts
for select
to authenticated
using (
  public.has_app_role('night_shift', array['viewer','editor','admin']::text[])
);

create policy night_shift_editor_insert_own
on public.night_shifts
for insert
to authenticated
with check (
  public.has_app_role('night_shift', array['editor','admin']::text[])
  and member_id = public.current_member_id()
);

create policy night_shift_editor_update_own
on public.night_shifts
for update
to authenticated
using (
  public.has_app_role('night_shift', array['editor','admin']::text[])
  and member_id = public.current_member_id()
)
with check (
  public.has_app_role('night_shift', array['editor','admin']::text[])
  and member_id = public.current_member_id()
);

create policy night_shift_editor_delete_own
on public.night_shifts
for delete
to authenticated
using (
  public.has_app_role('night_shift', array['editor','admin']::text[])
  and member_id = public.current_member_id()
);

drop policy if exists authorized_read_staff on public.staff;
drop policy if exists admin_write_staff_insert on public.staff;
drop policy if exists admin_write_staff_update on public.staff;
drop policy if exists admin_write_staff_delete on public.staff;

create policy department_roster_read_staff
on public.staff
for select
to authenticated
using (
  public.has_app_role('department_roster', array['viewer','editor','admin']::text[])
);

create policy department_roster_admin_insert_staff
on public.staff
for insert
to authenticated
with check (
  public.has_app_role('department_roster', array['admin']::text[])
);

create policy department_roster_admin_update_staff
on public.staff
for update
to authenticated
using (
  public.has_app_role('department_roster', array['admin']::text[])
)
with check (
  public.has_app_role('department_roster', array['admin']::text[])
);

create policy department_roster_admin_delete_staff
on public.staff
for delete
to authenticated
using (
  public.has_app_role('department_roster', array['admin']::text[])
);

drop policy if exists authorized_read_duty_types on public.duty_types;
drop policy if exists admin_write_duty_types_insert on public.duty_types;
drop policy if exists admin_write_duty_types_update on public.duty_types;
drop policy if exists admin_write_duty_types_delete on public.duty_types;

create policy department_roster_read_duty_types
on public.duty_types
for select
to authenticated
using (
  public.has_app_role('department_roster', array['viewer','editor','admin']::text[])
);

create policy department_roster_admin_insert_duty_types
on public.duty_types
for insert
to authenticated
with check (
  public.has_app_role('department_roster', array['admin']::text[])
);

create policy department_roster_admin_update_duty_types
on public.duty_types
for update
to authenticated
using (
  public.has_app_role('department_roster', array['admin']::text[])
)
with check (
  public.has_app_role('department_roster', array['admin']::text[])
);

create policy department_roster_admin_delete_duty_types
on public.duty_types
for delete
to authenticated
using (
  public.has_app_role('department_roster', array['admin']::text[])
);

drop policy if exists authorized_read_schedule on public.schedule_assignments;
drop policy if exists admin_write_schedule_insert on public.schedule_assignments;
drop policy if exists admin_write_schedule_update on public.schedule_assignments;
drop policy if exists admin_write_schedule_delete on public.schedule_assignments;

create policy department_roster_read_schedule
on public.schedule_assignments
for select
to authenticated
using (
  public.has_app_role('department_roster', array['viewer','editor','admin']::text[])
);

create policy department_roster_admin_insert_schedule
on public.schedule_assignments
for insert
to authenticated
with check (
  public.has_app_role('department_roster', array['admin']::text[])
);

create policy department_roster_admin_update_schedule
on public.schedule_assignments
for update
to authenticated
using (
  public.has_app_role('department_roster', array['admin']::text[])
)
with check (
  public.has_app_role('department_roster', array['admin']::text[])
);

create policy department_roster_admin_delete_schedule
on public.schedule_assignments
for delete
to authenticated
using (
  public.has_app_role('department_roster', array['admin']::text[])
);
