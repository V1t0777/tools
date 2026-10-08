begin;

create or replace function private.is_pictionary_guess_sender(
  p_topic text,
  p_payload jsonb
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select
    private.has_active_session()
    and jsonb_typeof(p_payload)='object'
    and char_length(trim(coalesce(p_payload->>'text',''))) between 1 and 40
    and char_length(coalesce(p_payload->>'client_id','')) between 1 and 100
    and exists(
      select 1
      from public.pictionary_rooms pr
      join public.pictionary_players pp
        on pp.room_id=pr.id
       and pp.user_id=(select auth.uid())
       and pp.active
      join public.members m
        on m.user_id=pp.user_id
      join public.pictionary_rounds rd
        on rd.room_id=pr.id
       and rd.round_no=pr.current_round_no
      where pr.status='playing'
        and pr.current_drawer_user_id<>(select auth.uid())
        and p_topic='pictionary:'||pr.id::text
        and m.id::text=p_payload->>'member_id'
        and rd.id::text=p_payload->>'round_id'
    );
$$;

revoke all on function private.is_pictionary_guess_sender(text,jsonb)
  from public,anon;
grant execute on function private.is_pictionary_guess_sender(text,jsonb)
  to authenticated;

drop policy if exists "pictionary members send realtime" on realtime.messages;
create policy "pictionary members send realtime"
on realtime.messages
for insert
to authenticated
with check (
  private.is_pictionary_topic_member((select realtime.topic()))
  and (
    extension='presence'
    or (
      extension='broadcast'
      and (
        event = any(array[
          'state_changed'::text,
          'sync_request'::text,
          'ping'::text,
          'pong'::text
        ])
        or (
          event='guess_pending'
          and private.is_pictionary_guess_sender(
            (select realtime.topic()),
            payload
          )
        )
        or (
          event = any(array['stroke'::text,'clear'::text,'undo'::text,'snapshot'::text])
          and private.is_pictionary_topic_drawer((select realtime.topic()))
        )
      )
    )
  )
);

commit;
