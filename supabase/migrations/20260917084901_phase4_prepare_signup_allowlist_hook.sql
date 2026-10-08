create table if not exists private.auth_signup_allowlist (
  email text primary key,
  created_at timestamptz not null default now(),
  constraint auth_signup_allowlist_email_normalized check (email = lower(btrim(email)) and email <> '')
);

alter table private.auth_signup_allowlist enable row level security;

insert into private.auth_signup_allowlist(email)
select distinct lower(btrim(email))
from auth.users
where email is not null
  and btrim(email) <> ''
  and deleted_at is null
on conflict (email) do nothing;

revoke all on table private.auth_signup_allowlist from public, anon, authenticated;
grant usage on schema private to supabase_auth_admin;
grant select on table private.auth_signup_allowlist to supabase_auth_admin;

drop policy if exists auth_admin_reads_signup_allowlist on private.auth_signup_allowlist;
create policy auth_admin_reads_signup_allowlist
on private.auth_signup_allowlist
for select
to supabase_auth_admin
using (true);

create or replace function public.hook_allow_preapproved_users(event jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  requested_email text;
begin
  requested_email := lower(btrim(coalesce(event->'user'->>'email', '')));

  if requested_email <> '' and exists (
    select 1
    from private.auth_signup_allowlist a
    where a.email = requested_email
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'Registration is invite-only.'
    )
  );
end;
$$;

revoke all on function public.hook_allow_preapproved_users(jsonb) from public, anon, authenticated;
grant execute on function public.hook_allow_preapproved_users(jsonb) to supabase_auth_admin;
comment on function public.hook_allow_preapproved_users(jsonb) is 'Before User Created auth hook: only emails in private.auth_signup_allowlist may create users.';