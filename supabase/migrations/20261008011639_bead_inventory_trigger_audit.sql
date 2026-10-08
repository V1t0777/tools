-- The inventory RPC stays SECURITY INVOKER. The audit trigger alone owns privileged event inserts.
CREATE OR REPLACE FUNCTION public.bead_set_inventory(p_scope text, p_group_id uuid, p_palette_name text, p_color_code text, p_color_name text, p_color_hex text, p_quantity integer, p_reason text DEFAULT 'manual'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_old integer := 0;
  v_new integer;
begin
  if not private.has_active_session() or v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_quantity < 0 or p_quantity > 10000000 then
    raise exception 'INVALID_QUANTITY';
  end if;
  if p_color_hex !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'INVALID_COLOR';
  end if;
  if char_length(trim(p_palette_name)) not between 1 and 80
     or char_length(trim(p_color_code)) not between 1 and 40 then
    raise exception 'INVALID_COLOR_KEY';
  end if;

  perform pg_catalog.set_config('app.bead_event_reason',left(coalesce(nullif(trim(p_reason),''),'manual'),120),true);

  if p_scope = 'personal' then
    select quantity into v_old
    from public.bead_inventory
    where owner_user_id = v_uid
      and group_id is null
      and palette_name = trim(p_palette_name)
      and color_code = trim(p_color_code)
    for update;
    v_old := coalesce(v_old,0);

    insert into public.bead_inventory(owner_user_id,group_id,palette_name,color_code,color_name,color_hex,quantity,updated_by,updated_at)
    values(v_uid,null,trim(p_palette_name),trim(p_color_code),left(coalesce(p_color_name,''),80),upper(p_color_hex),p_quantity,v_uid,now())
    on conflict (owner_user_id,palette_name,color_code) where group_id is null
    do update set color_name=excluded.color_name,color_hex=excluded.color_hex,quantity=excluded.quantity,updated_by=v_uid,updated_at=now();

    v_new := p_quantity;
    return v_new;
  elsif p_scope = 'group' then
    if p_group_id is null or not private.can_edit_bead_group(p_group_id) then
      raise exception 'FORBIDDEN';
    end if;

    select quantity into v_old
    from public.bead_inventory
    where owner_user_id is null
      and group_id = p_group_id
      and palette_name = trim(p_palette_name)
      and color_code = trim(p_color_code)
    for update;
    v_old := coalesce(v_old,0);

    insert into public.bead_inventory(owner_user_id,group_id,palette_name,color_code,color_name,color_hex,quantity,updated_by,updated_at)
    values(null,p_group_id,trim(p_palette_name),trim(p_color_code),left(coalesce(p_color_name,''),80),upper(p_color_hex),p_quantity,v_uid,now())
    on conflict (group_id,palette_name,color_code) where owner_user_id is null
    do update set color_name=excluded.color_name,color_hex=excluded.color_hex,quantity=excluded.quantity,updated_by=v_uid,updated_at=now();

    v_new := p_quantity;
    return v_new;
  else
    raise exception 'INVALID_SCOPE';
  end if;
end;
$function$;
ALTER FUNCTION public.bead_set_inventory(text,uuid,text,text,text,text,integer,text) SECURITY INVOKER;
GRANT INSERT, UPDATE, DELETE ON TABLE public.bead_inventory TO authenticated;
CREATE OR REPLACE FUNCTION private.audit_bead_inventory_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $audit$
DECLARE
  v_reason text := left(coalesce(nullif(trim(current_setting('app.bead_event_reason',true)),''),'manual'),120);
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.bead_inventory_events(
      owner_user_id,group_id,palette_name,color_code,delta,resulting_quantity,reason,changed_by
    ) VALUES (
      OLD.owner_user_id,OLD.group_id,OLD.palette_name,OLD.color_code,
      -OLD.quantity,0,'delete',coalesce(auth.uid(),OLD.updated_by)
    );
    RETURN OLD;
  END IF;
  INSERT INTO public.bead_inventory_events(
    owner_user_id,group_id,palette_name,color_code,delta,resulting_quantity,reason,changed_by
  ) VALUES (
    NEW.owner_user_id,NEW.group_id,NEW.palette_name,NEW.color_code,
    NEW.quantity - CASE WHEN TG_OP = 'INSERT' THEN 0 ELSE OLD.quantity END,
    NEW.quantity,v_reason,coalesce(auth.uid(),NEW.updated_by)
  );
  RETURN NEW;
END;
$audit$;

REVOKE ALL ON FUNCTION private.audit_bead_inventory_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER audit_bead_inventory_changes
AFTER INSERT OR UPDATE OR DELETE ON public.bead_inventory
FOR EACH ROW EXECUTE FUNCTION private.audit_bead_inventory_change();
