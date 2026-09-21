begin;

-- The Edge Function only needs these public profile fields. Keep the grant
-- column-scoped instead of opening the full members table to service_role.
grant select (id,user_id,nickname,color) on public.members to service_role;

create or replace function private.is_pictionary_topic_drawer(p_topic text)
returns boolean language sql stable security definer set search_path=''
as $$
  select private.has_active_session() and exists(
    select 1
    from public.pictionary_rooms pr
    where pr.current_drawer_user_id=(select auth.uid())
      and pr.status='playing'
      and p_topic='pictionary:'||pr.id::text
  );
$$;
revoke all on function private.is_pictionary_topic_drawer(text) from public,anon;
grant execute on function private.is_pictionary_topic_drawer(text) to authenticated;

drop policy if exists "pictionary members send realtime" on realtime.messages;
create policy "pictionary members send realtime" on realtime.messages
  for insert to authenticated with check(
    private.is_pictionary_topic_member((select realtime.topic()))
    and (
      extension='presence'
      or (
        extension='broadcast'
        and (
          event in ('state_changed','sync_request')
          or (
            event in ('stroke','clear','undo','snapshot')
            and private.is_pictionary_topic_drawer((select realtime.topic()))
          )
        )
      )
    )
  );

create index if not exists pictionary_guesses_room_idx
  on public.pictionary_guesses(room_id);
create index if not exists pictionary_guesses_user_idx
  on public.pictionary_guesses(user_id);
create index if not exists pictionary_rooms_host_idx
  on public.pictionary_rooms(host_user_id);
create index if not exists pictionary_rooms_drawer_idx
  on public.pictionary_rooms(current_drawer_user_id);
create index if not exists pictionary_round_results_user_idx
  on public.pictionary_round_results(user_id);
create index if not exists pictionary_rounds_drawer_idx
  on public.pictionary_rounds(drawer_user_id);
create index if not exists pictionary_rounds_word_idx
  on public.pictionary_rounds(word_id);

commit;
