-- REVIEW DRAFT ONLY: DO NOT APPLY TO LIVE SUPABASE WITHOUT EXPLICIT APPROVAL.
-- Separate story progress + workshop sandbox. This is NOT a currency source
-- for the authoritative normal-mode economy and cannot award normal coins.
BEGIN;

CREATE TABLE IF NOT EXISTS public.merge_story_pairs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision>=0),
  pair jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (pair IS NULL OR (
    pg_catalog.jsonb_typeof(pair)='object' AND
    pair ? 'progress' AND pair ? 'workshop' AND
    pg_catalog.octet_length(pair::text)<=1200000))
);
CREATE TABLE IF NOT EXISTS public.merge_story_operations (
  user_id uuid NOT NULL REFERENCES public.merge_story_pairs(user_id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  revision bigint NOT NULL CHECK (revision>=1),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,operation_id)
);
CREATE INDEX IF NOT EXISTS merge_story_operations_time_idx
  ON public.merge_story_operations(created_at);

ALTER TABLE public.merge_story_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merge_story_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.merge_story_pairs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.merge_story_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE ON public.merge_story_pairs TO service_role;
GRANT SELECT,INSERT ON public.merge_story_operations TO service_role;

-- Four-account allowlist is a REQUIRED prior migration. A missing allowlist
-- table causes the RPC to fail; never accept another Auth account.
CREATE OR REPLACE FUNCTION public.merge_story_read(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.merge_story_pairs%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.merge_cloud_allowlist AS a
      WHERE a.user_id=p_user_id
  ) THEN RAISE EXCEPTION 'not an approved story account'; END IF;
  SELECT * INTO r FROM public.merge_story_pairs WHERE user_id=p_user_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok',true,'status','empty','revision',0,'pair',NULL);
  END IF;
  RETURN pg_catalog.jsonb_build_object('ok',true,'status','ok',
    'revision',r.revision,'pair',r.pair);
END;
$$;

CREATE OR REPLACE FUNCTION public.merge_story_commit(
  p_user_id uuid,p_operation_id uuid,p_expected_revision bigint,
  p_pair jsonb,p_payload_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.merge_story_pairs%ROWTYPE;
        old_hash text;
BEGIN
  IF p_user_id IS NULL OR p_operation_id IS NULL OR
    p_expected_revision IS NULL OR p_expected_revision<0 OR
    p_payload_hash IS NULL OR p_payload_hash !~ '^[0-9a-f]{64}$' OR
    p_pair IS NULL OR pg_catalog.jsonb_typeof(p_pair)<>'object' OR
    pg_catalog.octet_length(p_pair::text)>1200000 OR
    NOT (p_pair ? 'progress' AND p_pair ? 'workshop') THEN
    RAISE EXCEPTION 'invalid story envelope'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.merge_cloud_allowlist AS a
                 WHERE a.user_id=p_user_id) THEN
    RAISE EXCEPTION 'not an approved story account'; END IF;
  INSERT INTO public.merge_story_pairs(user_id,revision,pair)
    VALUES(p_user_id,0,NULL) ON CONFLICT(user_id) DO NOTHING;
  SELECT * INTO STRICT r FROM public.merge_story_pairs
    WHERE user_id=p_user_id FOR UPDATE;
  SELECT payload_hash INTO old_hash FROM public.merge_story_operations
    WHERE user_id=p_user_id AND operation_id=p_operation_id;
  IF FOUND THEN
    IF old_hash<>p_payload_hash THEN
      RETURN pg_catalog.jsonb_build_object('ok',false,'status','rejected',
        'code','OPERATION_ID_REUSE','revision',r.revision,'pair',r.pair);
    END IF;
    RETURN pg_catalog.jsonb_build_object('ok',true,'status','replayed',
      'revision',r.revision,'pair',r.pair);
  END IF;
  IF r.revision<>p_expected_revision THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'status','conflict',
      'code','REVISION_CONFLICT','revision',r.revision,'pair',r.pair);
  END IF;
  -- A normal commit cannot roll back either story component. Recovery from
  -- older backups requires a separate reviewed restoration protocol.
  IF r.pair IS NOT NULL AND (
    (p_pair->'progress'->>'revision')::bigint <
      (r.pair->'progress'->>'revision')::bigint OR
    (p_pair->'workshop'->>'revision')::bigint <
      (r.pair->'workshop'->>'revision')::bigint
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'status','rejected',
      'code','STORY_ROLLBACK_FORBIDDEN','revision',r.revision,'pair',r.pair);
  END IF;
  UPDATE public.merge_story_pairs SET revision=r.revision+1,
    pair=p_pair,updated_at=now() WHERE user_id=p_user_id;
  INSERT INTO public.merge_story_operations(user_id,operation_id,payload_hash,revision)
    VALUES(p_user_id,p_operation_id,p_payload_hash,r.revision+1);
  RETURN pg_catalog.jsonb_build_object('ok',true,'status','applied',
    'revision',r.revision+1,'pair',p_pair);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_story_read(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.merge_story_commit(uuid,uuid,bigint,jsonb,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.merge_story_read(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.merge_story_commit(uuid,uuid,bigint,jsonb,text)
  TO service_role;
COMMIT;

-- Pre-deployment gate: verify Auth UID mappings and RLS/ACL; test SQL
-- transaction retries, duplicate IDs, 409 CAS and restore rollback in a
-- disposable PostgreSQL instance. Never apply with live player data present.
