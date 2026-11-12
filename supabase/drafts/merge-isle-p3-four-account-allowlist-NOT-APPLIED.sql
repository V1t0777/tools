-- REVIEW DRAFT ONLY / NOT APPLIED: four approved cloud-save accounts.
-- Requires a privileged, explicitly authorized schema review and independent
-- deployment approval. Never run against production as part of normal CI.
-- Identity is pinned to Auth user_id ONCE; nicknames are provisioning labels,
-- not runtime authorization claims or a browser-controlled trust boundary.
BEGIN;

CREATE TABLE IF NOT EXISTS public.merge_cloud_allowlist (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  account_label text NOT NULL UNIQUE
    CHECK (account_label IN ('迪','晨','钊','test')),
  granted_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
ALTER TABLE public.merge_cloud_allowlist ENABLE ROW LEVEL SECURITY;
-- No browser Data API reads/writes; the JWT-verified Edge Function performs
-- an exact-user-id lookup through service_role only.
REVOKE ALL ON TABLE public.merge_cloud_allowlist FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.merge_cloud_allowlist TO service_role;

DO $$
DECLARE v_count integer;
        v_distinct integer;
        v_linked integer;
        v_verified integer;
BEGIN
  -- Fail closed unless the four already-approved member records each map to
  -- a UNIQUE Supabase Auth user with a confirmed email. If any nickname has
  -- been changed/reassigned since review, STOP and verify identities manually.
  SELECT count(*),count(DISTINCT m.nickname),count(u.id),
         count(u.email_confirmed_at)
    INTO v_count,v_distinct,v_linked,v_verified
    FROM public.members AS m
    LEFT JOIN auth.users AS u ON u.id=m.user_id
    WHERE m.nickname IN ('迪','晨','钊','test');
  IF v_count<>4 OR v_distinct<>4 OR v_linked<>4 OR v_verified<>4 THEN
    RAISE EXCEPTION 'Four approved, unique, verified Auth members required';
  END IF;

  -- Never authorize any fifth account, and never overwrite a prior mapping.
  INSERT INTO public.merge_cloud_allowlist(user_id,account_label)
    SELECT m.user_id,m.nickname FROM public.members AS m
    JOIN auth.users AS u ON u.id=m.user_id
    WHERE m.nickname IN ('迪','晨','钊','test')
      AND u.email_confirmed_at IS NOT NULL
    ON CONFLICT (user_id) DO NOTHING;

  IF (SELECT count(*) FROM public.merge_cloud_allowlist)<>4 OR EXISTS (
    SELECT 1 FROM public.merge_cloud_allowlist AS a
    LEFT JOIN public.members AS m ON m.user_id=a.user_id
    LEFT JOIN auth.users AS u ON u.id=a.user_id
    WHERE m.nickname IS DISTINCT FROM a.account_label
       OR u.email_confirmed_at IS NULL
       OR a.account_label NOT IN ('迪','晨','钊','test')
  ) THEN
    RAISE EXCEPTION 'Cloud allowlist mismatch: abort without granting access';
  END IF;
END $$;
COMMIT;

-- Deployment checklist: review all four Auth UID mappings privately;
-- verify anon/authenticated cannot SELECT/INSERT/UPDATE/DELETE;
-- test revoked/unverified/unknown accounts and cross-account isolation;
-- test that missing table/query errors return 503, never cloud access.
