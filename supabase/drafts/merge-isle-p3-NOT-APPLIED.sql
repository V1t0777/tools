-- REVIEW DRAFT ONLY: DO NOT APPLY TO ANY LIVE PROJECT WITHOUT EXPLICIT APPROVAL.
-- P3 server-side CAS protocol (PostgreSQL 17 / Supabase). P2 JSON save remains schemaVersion=2.
-- API RPC functions remain PUBLIC-schema but EXECUTE is strictly service_role-only.
-- The trusted Edge Function validates JWT and derives p_user_id from auth.getUser(jwt).
BEGIN;

CREATE TABLE IF NOT EXISTS public.merge_saves (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state->>'revision')::bigint = revision),
  CHECK (octet_length(state::text) <= 65536)
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
     p_seed->>'schemaVersion' IS DISTINCT FROM '2' OR
     p_seed->>'revision' IS DISTINCT FROM '0' OR
     (p_seed->>'coins')::bigint IS DISTINCT FROM 0 OR
     (p_seed->>'xp')::bigint IS DISTINCT FROM 0 OR
     pg_catalog.octet_length(p_seed::text) > 65536 THEN
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
     pg_catalog.octet_length(p_next_state::text) > 65536 THEN
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
     (p_next_state->>'schemaVersion')::int IS DISTINCT FROM 2 THEN
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
COMMIT;

-- Before deploying: verify function grants with has_function_privilege, validate RLS / Data API exposure,
-- add operation retention & quota policy, negative tests, and transaction-level concurrent tests.