begin;

-- A guess is shown optimistically on the sender's own device only.
-- Clients cannot publish the text before the authoritative scoring RPC
-- replaces correct guesses with a non-revealing result.
drop policy if exists "pictionary members send realtime" on realtime.messages;
create policy "pictionary members send realtime"
on realtime.messages
for insert to authenticated
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
          event = any(array[
            'stroke'::text,
            'clear'::text,
            'undo'::text,
            'snapshot'::text
          ])
          and private.is_pictionary_topic_drawer((select realtime.topic()))
        )
      )
    )
  )
);

revoke execute on function private.is_pictionary_guess_sender(text,jsonb) from authenticated;

-- Existing subscribed clients may cache an older Realtime authorization.
-- Rotate any currently active room topics so new subscriptions use this policy.
update public.pictionary_rooms
set realtime_token=gen_random_uuid(),
    realtime_generation=realtime_generation+1
where status in ('lobby','choosing','playing','summary');

commit;
