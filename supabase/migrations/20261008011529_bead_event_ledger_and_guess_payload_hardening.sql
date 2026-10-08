-- Recorded from the production hardening migration 20261008011529.
-- Replaced by trigger-backed invoker hardening in the immediately following migration.
ALTER FUNCTION public.bead_set_inventory(text,uuid,text,text,text,text,integer,text) SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.bead_set_inventory(text,uuid,text,text,text,text,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bead_set_inventory(text,uuid,text,text,text,text,integer,text) TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.bead_inventory FROM PUBLIC, anon, authenticated;
REVOKE INSERT ON TABLE public.bead_inventory_events FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS bead_inventory_events_insert ON public.bead_inventory_events;

CREATE OR REPLACE FUNCTION private.is_pictionary_guess_sender(p_topic text, p_payload jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    private.has_active_session()
    and jsonb_typeof(p_payload)='object'
    and char_length(trim(coalesce(p_payload->>'text',''))) between 1 and 40
    and char_length(coalesce(p_payload->>'client_id','')) between 1 and 100
    and octet_length(p_payload::text) <= 2048
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
$function$;
