create table if not exists public.dinner_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 60),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.dinner_group_members (
  group_id uuid not null references public.dinner_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  role text not null default 'member' check (role in ('member','admin')),
  joined_at timestamptz not null default now(),
  primary key (group_id,user_id)
);

create table if not exists public.dinner_candidates (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.dinner_groups(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  emoji text not null default '🍽️' check (char_length(emoji) between 1 and 16),
  enabled boolean not null default true,
  base_weight numeric(6,3) not null default 1.000 check (base_weight > 0 and base_weight <= 100),
  price_level smallint null check (price_level between 1 and 4),
  spicy_level smallint null check (spicy_level between 0 and 3),
  tags text[] not null default '{}',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists dinner_candidates_group_name_uidx
  on public.dinner_candidates(group_id, lower(name));
create index if not exists dinner_candidates_group_enabled_idx
  on public.dinner_candidates(group_id,enabled);

create table if not exists public.dinner_history (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.dinner_groups(id) on delete cascade,
  candidate_id uuid null references public.dinner_candidates(id) on delete set null,
  candidate_name_snapshot text not null check (char_length(candidate_name_snapshot) between 1 and 60),
  emoji_snapshot text not null default '🍽️' check (char_length(emoji_snapshot) between 1 and 16),
  meal_date date not null,
  meal_period text not null default '晚餐' check (meal_period in ('早餐','午餐','晚餐','夜宵','其他')),
  note text not null default '' check (char_length(note) <= 500),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dinner_history_group_date_idx
  on public.dinner_history(group_id,meal_date desc,created_at desc);
create index if not exists dinner_history_group_candidate_idx
  on public.dinner_history(group_id,candidate_id,meal_date desc);

create table if not exists public.dinner_group_state (
  group_id uuid primary key references public.dinner_groups(id) on delete cascade,
  random_mode text not null default 'fair' check (random_mode in ('fair','smart')),
  filters jsonb not null default '{}'::jsonb,
  updated_by uuid null references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create or replace function public.set_dinner_updated_at()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists dinner_candidates_set_updated_at on public.dinner_candidates;
create trigger dinner_candidates_set_updated_at
before update on public.dinner_candidates
for each row execute function public.set_dinner_updated_at();

drop trigger if exists dinner_history_set_updated_at on public.dinner_history;
create trigger dinner_history_set_updated_at
before update on public.dinner_history
for each row execute function public.set_dinner_updated_at();

drop trigger if exists dinner_group_state_set_updated_at on public.dinner_group_state;
create trigger dinner_group_state_set_updated_at
before update on public.dinner_group_state
for each row execute function public.set_dinner_updated_at();

create or replace function public.is_dinner_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
    from public.dinner_group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = auth.uid()
  );
$$;

revoke all on function public.is_dinner_group_member(uuid) from public;
revoke all on function public.is_dinner_group_member(uuid) from anon;
grant execute on function public.is_dinner_group_member(uuid) to authenticated;

create or replace function public.is_dinner_group_admin(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
    from public.dinner_group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = auth.uid()
      and gm.role = 'admin'
  );
$$;

revoke all on function public.is_dinner_group_admin(uuid) from public;
revoke all on function public.is_dinner_group_admin(uuid) from anon;
grant execute on function public.is_dinner_group_admin(uuid) to authenticated;

alter table public.dinner_groups enable row level security;
alter table public.dinner_group_members enable row level security;
alter table public.dinner_candidates enable row level security;
alter table public.dinner_history enable row level security;
alter table public.dinner_group_state enable row level security;

revoke all on public.dinner_groups from anon;
revoke all on public.dinner_group_members from anon;
revoke all on public.dinner_candidates from anon;
revoke all on public.dinner_history from anon;
revoke all on public.dinner_group_state from anon;

grant select on public.dinner_groups to authenticated;
grant select on public.dinner_group_members to authenticated;
grant select,insert,update,delete on public.dinner_candidates to authenticated;
grant select,insert,update,delete on public.dinner_history to authenticated;
grant select,insert,update on public.dinner_group_state to authenticated;

drop policy if exists dinner_groups_member_select on public.dinner_groups;
create policy dinner_groups_member_select
on public.dinner_groups for select to authenticated
using (public.is_dinner_group_member(id));

drop policy if exists dinner_group_members_member_select on public.dinner_group_members;
create policy dinner_group_members_member_select
on public.dinner_group_members for select to authenticated
using (public.is_dinner_group_member(group_id));

drop policy if exists dinner_candidates_member_select on public.dinner_candidates;
create policy dinner_candidates_member_select
on public.dinner_candidates for select to authenticated
using (public.is_dinner_group_member(group_id));

drop policy if exists dinner_candidates_member_insert on public.dinner_candidates;
create policy dinner_candidates_member_insert
on public.dinner_candidates for insert to authenticated
with check (public.is_dinner_group_member(group_id) and created_by = auth.uid());

drop policy if exists dinner_candidates_member_update on public.dinner_candidates;
create policy dinner_candidates_member_update
on public.dinner_candidates for update to authenticated
using (public.is_dinner_group_member(group_id))
with check (public.is_dinner_group_member(group_id));

drop policy if exists dinner_candidates_member_delete on public.dinner_candidates;
create policy dinner_candidates_member_delete
on public.dinner_candidates for delete to authenticated
using (public.is_dinner_group_member(group_id));

drop policy if exists dinner_history_member_select on public.dinner_history;
create policy dinner_history_member_select
on public.dinner_history for select to authenticated
using (public.is_dinner_group_member(group_id));

drop policy if exists dinner_history_member_insert on public.dinner_history;
create policy dinner_history_member_insert
on public.dinner_history for insert to authenticated
with check (public.is_dinner_group_member(group_id) and created_by = auth.uid());

drop policy if exists dinner_history_member_update on public.dinner_history;
create policy dinner_history_member_update
on public.dinner_history for update to authenticated
using (public.is_dinner_group_member(group_id))
with check (public.is_dinner_group_member(group_id));

drop policy if exists dinner_history_member_delete on public.dinner_history;
create policy dinner_history_member_delete
on public.dinner_history for delete to authenticated
using (public.is_dinner_group_member(group_id));

drop policy if exists dinner_group_state_member_select on public.dinner_group_state;
create policy dinner_group_state_member_select
on public.dinner_group_state for select to authenticated
using (public.is_dinner_group_member(group_id));

drop policy if exists dinner_group_state_member_insert on public.dinner_group_state;
create policy dinner_group_state_member_insert
on public.dinner_group_state for insert to authenticated
with check (public.is_dinner_group_member(group_id) and updated_by = auth.uid());

drop policy if exists dinner_group_state_member_update on public.dinner_group_state;
create policy dinner_group_state_member_update
on public.dinner_group_state for update to authenticated
using (public.is_dinner_group_member(group_id))
with check (public.is_dinner_group_member(group_id) and updated_by = auth.uid());

alter table public.dinner_candidates replica identity full;
alter table public.dinner_history replica identity full;
alter table public.dinner_group_state replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='dinner_candidates'
  ) then
    alter publication supabase_realtime add table public.dinner_candidates;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='dinner_history'
  ) then
    alter publication supabase_realtime add table public.dinner_history;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='dinner_group_state'
  ) then
    alter publication supabase_realtime add table public.dinner_group_state;
  end if;
end $$;