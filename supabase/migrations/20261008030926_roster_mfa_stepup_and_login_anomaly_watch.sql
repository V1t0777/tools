
-- TOTP step-up for department roster admins, with compatible pre-enrollment rollout.
CREATE OR REPLACE FUNCTION private.roster_recent_mfa_stepup()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $body$
 SELECT private.has_app_role('department_roster',ARRAY['admin']::text[])
 AND (
  NOT EXISTS(SELECT 1 FROM auth.mfa_factors f WHERE f.user_id=(SELECT auth.uid()) AND f.factor_type::text='totp' AND f.status::text='verified')
  OR (
    (SELECT auth.jwt()->>'aal')='aal2'
    AND EXISTS (
      SELECT 1 FROM auth.sessions s
      JOIN auth.mfa_factors f ON f.id=s.factor_id AND f.user_id=s.user_id
      JOIN auth.mfa_challenges c ON c.factor_id=s.factor_id
      WHERE s.id::text=(SELECT auth.jwt()->>'session_id')
        AND s.user_id=(SELECT auth.uid()) AND s.aal::text='aal2'
        AND f.status::text='verified'
        AND c.verified_at>=now()-interval '5 minutes'
    )
  )
 );
$body$;
REVOKE ALL ON FUNCTION private.roster_recent_mfa_stepup() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.roster_recent_mfa_stepup() TO authenticated;
ALTER POLICY "department_roster_admin_insert_schedule" ON public.schedule_assignments WITH CHECK ((SELECT private.roster_recent_mfa_stepup()));
ALTER POLICY "department_roster_admin_update_schedule" ON public.schedule_assignments USING ((SELECT private.roster_recent_mfa_stepup())) WITH CHECK ((SELECT private.roster_recent_mfa_stepup()));
ALTER POLICY "department_roster_admin_delete_schedule" ON public.schedule_assignments USING ((SELECT private.roster_recent_mfa_stepup()));
ALTER POLICY "department_roster_admin_insert_staff" ON public.staff WITH CHECK ((SELECT private.roster_recent_mfa_stepup()));
ALTER POLICY "department_roster_admin_update_staff" ON public.staff USING ((SELECT private.roster_recent_mfa_stepup())) WITH CHECK ((SELECT private.roster_recent_mfa_stepup()));
ALTER POLICY "department_roster_admin_delete_staff" ON public.staff USING ((SELECT private.roster_recent_mfa_stepup()));
ALTER POLICY "department_roster_admin_insert_duty_types" ON public.duty_types WITH CHECK ((SELECT private.roster_recent_mfa_stepup()));
ALTER POLICY "department_roster_admin_update_duty_types" ON public.duty_types USING ((SELECT private.roster_recent_mfa_stepup())) WITH CHECK ((SELECT private.roster_recent_mfa_stepup()));
ALTER POLICY "department_roster_admin_delete_duty_types" ON public.duty_types USING ((SELECT private.roster_recent_mfa_stepup()));
CREATE OR REPLACE FUNCTION public.replace_day_schedule(p_date date, p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if NOT private.roster_recent_mfa_stepup() THEN
    RAISE EXCEPTION 'MFA verification required' USING ERRCODE='P0001';
  END IF;
  if p_date is null then
    raise exception 'date is required';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be a JSON array';
  end if;

  delete from public.schedule_assignments
  where work_date = p_date;

  insert into public.schedule_assignments(
    work_date,
    duty_type_id,
    staff_id,
    time_slot,
    note
  )
  select
    p_date,
    (item->>'duty_type_id')::bigint,
    (item->>'staff_id')::uuid,
    coalesce(nullif(item->>'time_slot',''), '未标注'),
    nullif(item->>'note','')
  from jsonb_array_elements(p_items) as item;
end;
$function$
;

-- Retain only anomaly category and session reference, never IP or user-agent.
CREATE TABLE private.login_security_events(
 session_id uuid NOT NULL,user_id uuid NOT NULL,
 event_type text NOT NULL CHECK(event_type IN ('NEW_NETWORK','NEW_BROWSER')),
 detected_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(session_id,event_type)
);
ALTER TABLE private.login_security_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.login_security_events FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION private.detect_new_login_environments()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $body$
BEGIN
 INSERT INTO private.login_security_events(session_id,user_id,event_type)
 SELECT s.id,s.user_id,'NEW_NETWORK'
 FROM auth.sessions s
 WHERE s.created_at>=now()-interval '2 hours' AND s.ip IS NOT NULL
 AND EXISTS(SELECT 1 FROM auth.sessions older WHERE older.user_id=s.user_id AND older.id<>s.id AND older.created_at<s.created_at AND older.created_at>=s.created_at-interval '30 days' AND older.ip IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM auth.sessions older WHERE older.user_id=s.user_id AND older.id<>s.id AND older.created_at<s.created_at AND older.created_at>=s.created_at-interval '30 days' AND older.ip=s.ip)
 ON CONFLICT DO NOTHING;
 INSERT INTO private.login_security_events(session_id,user_id,event_type)
 SELECT s.id,s.user_id,'NEW_BROWSER'
 FROM auth.sessions s
 WHERE s.created_at>=now()-interval '2 hours' AND s.user_agent IS NOT NULL
 AND EXISTS(SELECT 1 FROM auth.sessions older WHERE older.user_id=s.user_id AND older.id<>s.id AND older.created_at<s.created_at AND older.created_at>=s.created_at-interval '30 days' AND older.user_agent IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM auth.sessions older WHERE older.user_id=s.user_id AND older.id<>s.id AND older.created_at<s.created_at AND older.created_at>=s.created_at-interval '30 days' AND older.user_agent=s.user_agent)
 ON CONFLICT DO NOTHING;
 DELETE FROM private.login_security_events WHERE detected_at<now()-interval '90 days';
END;
$body$;
REVOKE ALL ON FUNCTION private.detect_new_login_environments() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.toolbox_login_security_alerts()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $body$
 SELECT COALESCE((
 SELECT jsonb_agg(jsonb_build_object('type',e.event_type,'at',e.detected_at) ORDER BY e.detected_at DESC)
 FROM(SELECT event_type,detected_at FROM private.login_security_events
 WHERE user_id=(SELECT auth.uid()) AND detected_at>now()-interval '7 days'
 ORDER BY detected_at DESC LIMIT 10)e
 ),'[]'::jsonb)
 WHERE private.has_active_session();
$body$;
REVOKE ALL ON FUNCTION public.toolbox_login_security_alerts() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.toolbox_login_security_alerts() TO authenticated;
SELECT cron.schedule('toolbox-auth-login-environment-watch','*/15 * * * *',$$SELECT private.detect_new_login_environments()$$);
