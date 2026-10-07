begin;

create or replace function public.pictionary_emit_event_service(
  p_room_id uuid,
  p_event text,
  p_payload jsonb
)
returns void
language plpgsql
security invoker
set search_path=''
as $$
begin
  if p_event <> 'state_sync' then
    raise exception 'unsupported pictionary realtime event';
  end if;
  if p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or octet_length(p_payload::text) > 65536 then
    raise exception 'pictionary realtime payload invalid';
  end if;
  perform realtime.send(
    p_payload,
    p_event,
    'pictionary:'||p_room_id::text,
    true
  );
end;
$$;

revoke all on function public.pictionary_emit_event_service(uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.pictionary_emit_event_service(uuid,text,jsonb)
  to service_role;

drop policy if exists "pictionary members send realtime" on realtime.messages;
create policy "pictionary members send realtime"
on realtime.messages
for insert
to authenticated
with check (
  private.is_pictionary_topic_member((select realtime.topic()))
  and (
    extension = 'presence'
    or (
      extension = 'broadcast'
      and (
        event = any(array[
          'state_changed'::text,
          'sync_request'::text,
          'ping'::text,
          'pong'::text,
          'guess_pending'::text
        ])
        or (
          event = any(array['stroke'::text,'clear'::text,'undo'::text,'snapshot'::text])
          and private.is_pictionary_topic_drawer((select realtime.topic()))
        )
      )
    )
  )
);

commit;
