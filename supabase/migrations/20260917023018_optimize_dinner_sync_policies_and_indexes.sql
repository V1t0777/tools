create index if not exists dinner_group_members_user_idx on public.dinner_group_members(user_id);
create index if not exists dinner_candidates_created_by_idx on public.dinner_candidates(created_by);
create index if not exists dinner_history_candidate_idx on public.dinner_history(candidate_id);
create index if not exists dinner_history_created_by_idx on public.dinner_history(created_by);
create index if not exists dinner_group_state_updated_by_idx on public.dinner_group_state(updated_by);
create index if not exists dinner_groups_created_by_idx on public.dinner_groups(created_by);

drop policy if exists dinner_candidates_member_insert on public.dinner_candidates;
create policy dinner_candidates_member_insert
on public.dinner_candidates for insert to authenticated
with check (
  public.is_dinner_group_member(group_id)
  and created_by = (select auth.uid())
);

drop policy if exists dinner_group_state_member_insert on public.dinner_group_state;
create policy dinner_group_state_member_insert
on public.dinner_group_state for insert to authenticated
with check (
  public.is_dinner_group_member(group_id)
  and updated_by = (select auth.uid())
);

drop policy if exists dinner_group_state_member_update on public.dinner_group_state;
create policy dinner_group_state_member_update
on public.dinner_group_state for update to authenticated
using (public.is_dinner_group_member(group_id))
with check (
  public.is_dinner_group_member(group_id)
  and updated_by = (select auth.uid())
);

drop policy if exists dinner_history_member_insert on public.dinner_history;
create policy dinner_history_member_insert
on public.dinner_history for insert to authenticated
with check (
  public.is_dinner_group_member(group_id)
  and created_by = (select auth.uid())
);