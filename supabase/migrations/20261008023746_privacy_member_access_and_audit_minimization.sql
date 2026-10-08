-- Minimize member-table client data while preserving roster/shift UI.
REVOKE SELECT ON TABLE public.members FROM authenticated;
GRANT SELECT (id, nickname, color) ON TABLE public.members TO authenticated;

-- Audit only necessary authorization columns; never serialize complete row JSON.
CREATE OR REPLACE FUNCTION private.log_access_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_old jsonb; v_new jsonb; v_target uuid; v_app_code text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old := jsonb_strip_nulls(jsonb_build_object(
      'user_id',to_jsonb(OLD)->>'user_id',
      'app_code',to_jsonb(OLD)->>'app_code',
      'role',to_jsonb(OLD)->>'role'));
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new := jsonb_strip_nulls(jsonb_build_object(
      'user_id',to_jsonb(NEW)->>'user_id',
      'app_code',to_jsonb(NEW)->>'app_code',
      'role',to_jsonb(NEW)->>'role'));
  END IF;
  v_target := nullif(coalesce(v_new->>'user_id',v_old->>'user_id'),'')::uuid;
  v_app_code := coalesce(v_new->>'app_code',v_old->>'app_code');
  INSERT INTO private.access_audit_log(
    actor_user_id,request_role,object_name,operation,target_user_id,app_code,old_data,new_data
  ) VALUES ((SELECT auth.uid()),current_setting('role',true),
    TG_TABLE_SCHEMA||'.'||TG_TABLE_NAME,TG_OP,
    v_target,v_app_code,v_old,v_new);
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.log_access_change() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION private.log_access_change() IS
  'Authorization audit stores only user_id, app_code, role; never full changed records.';

-- Prune only authorization audit data after 180 days. Preserve clinical roster and app history.
SELECT cron.schedule('toolbox-privacy-access-audit-retention','45 19 * * *',
  $$DELETE FROM private.access_audit_log WHERE changed_at < now() - interval '180 days'$$);
