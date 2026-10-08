create policy app_access_no_direct_client_access
on private.app_access
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

create policy admin_users_no_direct_client_access
on private.admin_users
as restrictive
for all
to anon, authenticated
using (false)
with check (false);
