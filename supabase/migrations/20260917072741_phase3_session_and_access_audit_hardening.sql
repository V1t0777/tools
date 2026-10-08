begin;

-- 1) Session-aware authorization: a valid JWT must also belong to a live Auth session.
create or replace function private.has_active_session()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.sessions s
    where s.id::text = (select auth.jwt() ->> 'session_id')
      and s.user_id = (select auth.uid())
      and (s.not_after is null or s.not_after > now())
  );
$$;

revoke all on function private.has_active_session() from public;
revoke all on function private.has_active_session() from anon;
grant execute on function private.has_active_session() to authenticated;

create or replace function private.current_member_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
  from public.members m
  where private.has_active_session()
    and m.user_id = (select auth.uid())
  limit 1;
$$;

create or replace function private.has_app_role(p_app_code text, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_active_session()
     and exists (
       select 1
       from private.app_access aa
       where aa.user_id = (select auth.uid())
         and aa.app_code = p_app_code
         and aa.role = any(p_roles)
     );
$$;

create or replace function private.is_dinner_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_active_session()
     and exists (
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
  select private.has_active_session()
     and exists (
       select 1
       from public.dinner_group_members gm
       where gm.group_id = p_group_id
         and gm.user_id = (select auth.uid())
         and gm.role = 'admin'
     );
$$;

-- Keep helper functions callable only by signed-in clients; they remain outside exposed schemas.
revoke all on function private.current_member_id() from public;
revoke all on function private.has_app_role(text,text[]) from public;
revoke all on function private.is_dinner_group_member(uuid) from public;
revoke all on function private.is_dinner_group_admin(uuid) from public;
grant execute on function private.current_member_id() to authenticated;
grant execute on function private.has_app_role(text,text[]) to authenticated;
grant execute on function private.is_dinner_group_member(uuid) to authenticated;
grant execute on function private.is_dinner_group_admin(uuid) to authenticated;

-- 2) Least privilege: current Dinner UI deletes history but does not edit historical rows.
drop policy if exists dinner_history_member_update on public.dinner_history;
revoke update on public.dinner_history from authenticated;

-- 3) Durable access-control audit trail for authorization changes.
create table if not exists private.access_audit_log (
  id bigint generated always as identity primary key,
  changed_at timestamptz not null default now(),
  actor_user_id uuid null,
  request_role text null,
  object_name text not null,
  operation text not null check (operation in ('INSERT','UPDATE','DELETE')),
  target_user_id uuid null,
  app_code text null,
  old_data jsonb null,
  new_data jsonb null
);

alter table private.access_audit_log enable row level security;
drop policy if exists access_audit_log_no_client_access on private.access_audit_log;
create policy access_audit_log_no_client_access
on private.access_audit_log
as restrictive
for all
to public
using (false)
with check (false);

revoke all on table private.access_audit_log from public, anon, authenticated;
revoke all on sequence private.access_audit_log_id_seq from public, anon, authenticated;

create or replace function private.log_access_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_target uuid;
  v_app_code text;
begin
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;

  v_target := nullif(coalesce(v_new ->> 'user_id', v_old ->> 'user_id'), '')::uuid;
  v_app_code := coalesce(v_new ->> 'app_code', v_old ->> 'app_code');

  insert into private.access_audit_log(
    actor_user_id, request_role, object_name, operation,
    target_user_id, app_code, old_data, new_data
  ) values (
    (select auth.uid()), current_setting('role', true),
    tg_table_schema || '.' || tg_table_name, tg_op,
    v_target, v_app_code, v_old, v_new
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Create triggers while the migration owner has EXECUTE, then remove direct client execution.
drop trigger if exists audit_app_access_changes on private.app_access;
create trigger audit_app_access_changes
after insert or update or delete on private.app_access
for each row execute function private.log_access_change();

drop trigger if exists audit_admin_users_changes on private.admin_users;
create trigger audit_admin_users_changes
after insert or update or delete on private.admin_users
for each row execute function private.log_access_change();

drop trigger if exists audit_dinner_group_members_changes on public.dinner_group_members;
create trigger audit_dinner_group_members_changes
after insert or update or delete on public.dinner_group_members
for each row execute function private.log_access_change();

revoke all on function private.log_access_change() from public, anon, authenticated;

commit;