-- Applied to production via Supabase migration API at 2026-11-12 02:44 UTC.
-- Strictly private user allowlist, no public Data API access.
-- REVIEW DRAFT ONLY / NOT APPLIED: four approved cloud-save accounts.
-- Requires a privileged, explicitly authorized schema review and independent
-- deployment approval. Never run against production as part of normal CI.
-- Identity is pinned to Auth user_id ONCE; nicknames are provisioning labels,
-- not runtime authorization claims or a browser-controlled trust boundary.


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


-- Deployment checklist: review all four Auth UID mappings privately;
-- verify anon/authenticated cannot SELECT/INSERT/UPDATE/DELETE;
-- test revoked/unverified/unknown accounts and cross-account isolation;
-- test that missing table/query errors return 503, never cloud access.

-- REVIEW DRAFT ONLY: DO NOT APPLY TO ANY LIVE PROJECT WITHOUT EXPLICIT APPROVAL.
-- P3 server-side CAS protocol (PostgreSQL 17 / Supabase). Engine V3 requires schemaVersion=3.
-- API RPC functions remain PUBLIC-schema but EXECUTE is strictly service_role-only.
-- The trusted Edge Function validates JWT and derives p_user_id from auth.getUser(jwt).


CREATE TABLE IF NOT EXISTS public.merge_saves (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state->>'revision')::bigint = revision),
  CHECK (octet_length(state::text) <= 640000)
);
CREATE TABLE IF NOT EXISTS public.merge_operations (
  user_id uuid NOT NULL REFERENCES public.merge_saves(user_id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('applied','rejected')),
  code text NOT NULL,
  response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  revision bigint NOT NULL CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, operation_id)
);
CREATE INDEX IF NOT EXISTS merge_operations_created_at_idx ON public.merge_operations (created_at);
ALTER TABLE public.merge_saves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merge_operations ENABLE ROW LEVEL SECURITY;
-- No browser SELECT or writes to either table. Service-only read/write via dedicated Edge Function.
REVOKE ALL ON public.merge_saves FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.merge_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.merge_saves TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.merge_operations TO service_role;

CREATE OR REPLACE FUNCTION public.merge_open_save(p_user_id uuid, p_seed jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row public.merge_saves%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR p_seed IS NULL OR
     p_seed->>'schemaVersion' IS DISTINCT FROM '3' OR
     p_seed->>'revision' IS DISTINCT FROM '0' OR
     (p_seed->>'coins')::bigint IS DISTINCT FROM 0 OR
     (p_seed->>'xp')::bigint IS DISTINCT FROM 0 OR
     pg_catalog.octet_length(p_seed::text) > 640000 THEN
    RAISE EXCEPTION 'invalid trusted initial state';
  END IF;
  INSERT INTO public.merge_saves(user_id, revision, state)
    VALUES (p_user_id, 0, p_seed) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO STRICT v_row FROM public.merge_saves WHERE user_id = p_user_id;
  RETURN pg_catalog.jsonb_build_object('status','ok','revision',v_row.revision,'state',v_row.state);
END;
$$;

CREATE OR REPLACE FUNCTION public.merge_commit_operation(
  p_user_id uuid, p_operation_id uuid, p_expected_revision bigint,
  p_request_hash text, p_next_state jsonb, p_response jsonb,
  p_status text, p_code text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row public.merge_saves%ROWTYPE;
        v_previous public.merge_operations%ROWTYPE;
        v_increment integer;
BEGIN
  IF p_user_id IS NULL OR p_operation_id IS NULL OR p_expected_revision < 0 OR
     p_request_hash !~ '^[0-9a-f]{64}$' OR
     p_status NOT IN ('applied','rejected') OR
     p_code IS NULL OR pg_catalog.length(p_code) > 40 OR
     pg_catalog.jsonb_typeof(p_next_state) IS DISTINCT FROM 'object' OR
     pg_catalog.jsonb_typeof(p_response) IS DISTINCT FROM 'object' OR
     pg_catalog.octet_length(p_next_state::text) > 640000 THEN
    RAISE EXCEPTION 'invalid operation envelope';
  END IF;
  -- Serialize per-player commits and duplicate-operation checks in one DB transaction.
  SELECT * INTO STRICT v_row FROM public.merge_saves WHERE user_id=p_user_id FOR UPDATE;
  SELECT * INTO v_previous FROM public.merge_operations
    WHERE user_id=p_user_id AND operation_id=p_operation_id;
  IF FOUND THEN
    IF v_previous.request_hash <> p_request_hash THEN
      RETURN pg_catalog.jsonb_build_object('status','rejected','code','OPERATION_ID_REUSE',
        'revision',v_row.revision,'state',v_row.state);
    END IF;
    RETURN pg_catalog.jsonb_build_object('status','replayed','code',v_previous.code,
      'ok',v_previous.status='applied','revision',v_row.revision,
      'state',v_row.state,'original',v_previous.response);
  END IF;
  IF v_row.revision <> p_expected_revision THEN
    RETURN pg_catalog.jsonb_build_object('status','conflict','code','REVISION_CONFLICT',
      'revision',v_row.revision,'state',v_row.state);
  END IF;
  v_increment := CASE WHEN p_status='applied' THEN 1 ELSE 0 END;
  IF (p_next_state->>'revision')::bigint IS DISTINCT FROM p_expected_revision+v_increment OR
     (p_next_state->>'schemaVersion')::int IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'invalid state revision transition';
  END IF;
  UPDATE public.merge_saves SET state=p_next_state, revision=p_expected_revision+v_increment,
    updated_at=now() WHERE user_id=p_user_id;
  INSERT INTO public.merge_operations(user_id,operation_id,request_hash,status,code,response,revision)
    VALUES (p_user_id,p_operation_id,p_request_hash,p_status,p_code,p_response,p_expected_revision+v_increment);
  RETURN pg_catalog.jsonb_build_object('status',p_status,'code',p_code,
    'ok',p_status='applied','revision',p_expected_revision+v_increment,
    'state',p_next_state,'original',p_response);
END;
$$;

-- SECURITY DEFINER is intentionally limited to the service_role; never GRANT authenticated.
REVOKE ALL ON FUNCTION public.merge_open_save(uuid,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_commit_operation(uuid,uuid,bigint,text,jsonb,jsonb,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_open_save(uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.merge_commit_operation(uuid,uuid,bigint,text,jsonb,jsonb,text,text) TO service_role;


-- Before deploying: verify function grants with has_function_privilege, validate RLS / Data API exposure,
-- add operation retention & quota policy, negative tests, and transaction-level concurrent tests.
-- P3.16 DRAFT ONLY / NOT APPLIED. Do not execute without separate user authorization.
-- Requires authenticated Edge JWT; only service_role may run this atomic quota gate.
-- Query route deliberately fails closed while this SQL is not deployed.


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


-- BEFORE ANY deployment: disposable-DB concurrent calls (>= 40),
-- assert authenticated/anon cannot select/execute, verify per-account isolation,
-- schema/RLS grants, grants on DEFAULT function EXECUTE, fault injection,
-- and verify quotas are not bypassed across separate Edge instances.

-- REVIEW DRAFT ONLY: DO NOT APPLY TO LIVE SUPABASE WITHOUT EXPLICIT APPROVAL.
-- Separate story progress + workshop sandbox. This is NOT a currency source
-- for the authoritative normal-mode economy and cannot award normal coins.


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


-- Pre-deployment gate: verify Auth UID mappings and RLS/ACL; test SQL
-- transaction retries, duplicate IDs, 409 CAS and restore rollback in a
-- disposable PostgreSQL instance. Never apply with live player data present.
