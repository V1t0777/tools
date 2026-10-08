-- Phase 1: explicit least-privilege grants for browser-facing business tables.

-- Prevent future tables created by postgres in public from inheriting nonessential
-- TRUNCATE / REFERENCES / TRIGGER / MAINTAIN privileges for browser roles.
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables from anon, authenticated;

-- Start from a known baseline: no direct table privileges for unauthenticated users,
-- and rebuild authenticated privileges explicitly below.
revoke all privileges on table
  public.members,
  public.night_shifts,
  public.staff,
  public.duty_types,
  public.schedule_assignments,
  public.app_access,
  public.admin_users,
  public.dinner_groups,
  public.dinner_group_members,
  public.dinner_candidates,
  public.dinner_history,
  public.dinner_group_state
from anon;

revoke all privileges on table
  public.members,
  public.night_shifts,
  public.staff,
  public.duty_types,
  public.schedule_assignments,
  public.app_access,
  public.admin_users,
  public.dinner_groups,
  public.dinner_group_members,
  public.dinner_candidates,
  public.dinner_history,
  public.dinner_group_state
from authenticated;

-- Shared identity lookup used by the authorized night-shift / roster pages.
grant select on table public.members to authenticated;

-- Night-shift page: authorized members can read all shared night shifts and,
-- subject to RLS, insert/update/delete only their own rows.
grant select, insert, update, delete on table public.night_shifts to authenticated;

-- Department roster page currently reads staff/type dictionaries.
grant select on table public.staff to authenticated;
grant select on table public.duty_types to authenticated;

-- Roster editor uses the security-invoker replace_day_schedule RPC (delete + insert).
-- UPDATE is retained because an admin-only RLS policy already exists for it.
grant select, insert, update, delete on table public.schedule_assignments to authenticated;

-- app_access and admin_users intentionally receive no browser table grants.

-- Dinner shared mode.
grant select on table public.dinner_groups to authenticated;
grant select on table public.dinner_group_members to authenticated;
grant select, insert, update, delete on table public.dinner_candidates to authenticated;
grant select, insert, update, delete on table public.dinner_history to authenticated;
grant select, insert, update on table public.dinner_group_state to authenticated;

-- Trigger helper does not need to be callable as an RPC by browser roles.
revoke execute on function public.set_dinner_updated_at() from public, anon, authenticated;