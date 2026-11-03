-- P3.16 DRAFT ONLY / NOT APPLIED. Do not execute without separate user authorization.
-- Requires authenticated Edge JWT; only service_role may run this atomic quota gate.
-- Query route deliberately fails closed while this SQL is not deployed.
BEGIN;

CREATE TABLE IF NOT EXISTS public.merge_receipt_quotas (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 13)
);
ALTER TABLE public.merge_receipt_quotas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.merge_receipt_quotas FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.merge_receipt_quotas TO service_role;

CREATE OR REPLACE FUNCTION public.merge_consume_receipt_quota(p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated user required';
  END IF;

  -- Atomic upsert serializes concurrent calls for the SAME account. Fixed
  -- 60-second window, maximum 12 requests. Count saturates at 13 while
  -- denied; no bypass when a second Edge instance receives the same account.
  INSERT INTO public.merge_receipt_quotas(user_id,window_started_at,attempts)
    VALUES (p_user_id,pg_catalog.now(),1)
  ON CONFLICT (user_id) DO UPDATE SET
    attempts = CASE
      WHEN public.merge_receipt_quotas.window_started_at <= pg_catalog.now()-INTERVAL '60 seconds'
        THEN 1
      ELSE CASE WHEN public.merge_receipt_quotas.attempts >= 13 THEN 13
                ELSE public.merge_receipt_quotas.attempts+1 END
    END,
    window_started_at = CASE
      WHEN public.merge_receipt_quotas.window_started_at <= pg_catalog.now()-INTERVAL '60 seconds'
        THEN pg_catalog.now()
      ELSE public.merge_receipt_quotas.window_started_at
    END
  RETURNING attempts INTO v_count;
  RETURN v_count <= 12;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_consume_receipt_quota(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_consume_receipt_quota(uuid) TO service_role;
COMMIT;

-- BEFORE ANY deployment: disposable-DB concurrent calls (>= 40),
-- assert authenticated/anon cannot select/execute, verify per-account isolation,
-- schema/RLS grants, grants on DEFAULT function EXECUTE, fault injection,
-- and verify quotas are not bypassed across separate Edge instances.
