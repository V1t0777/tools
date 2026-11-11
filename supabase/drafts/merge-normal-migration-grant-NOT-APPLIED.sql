-- REVIEW DRAFT ONLY. DO NOT APPLY TO PRODUCTION WITHOUT SEPARATE APPROVAL.
-- Optional one-time ADMIN-reviewed migration from an existing local V3 save.
-- Neither the browser nor the cloud Edge handler can submit a wallet snapshot.
-- A trusted administrator must manually inspect and provision this grant
-- through a service-role-only provisioning workflow in a disposable DB first.
BEGIN;

CREATE TABLE IF NOT EXISTS public.merge_normal_migration_grants (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  approved_state jsonb NOT NULL CHECK (
    pg_catalog.jsonb_typeof(approved_state)='object' AND
    approved_state->>'schemaVersion'='3' AND
    (approved_state->>'revision')::bigint>=1 AND
    pg_catalog.octet_length(approved_state::text)<=640000),
  approved_by uuid NOT NULL REFERENCES auth.users(id),
  approved_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  consumed_at timestamptz,
  CHECK (consumed_at IS NULL OR consumed_at>=approved_at)
);
ALTER TABLE public.merge_normal_migration_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.merge_normal_migration_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE ON public.merge_normal_migration_grants TO service_role;

CREATE OR REPLACE FUNCTION public.merge_claim_approved_normal_save(
  p_user_id uuid,p_source_sha256 text,p_confirmed boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_grant public.merge_normal_migration_grants%ROWTYPE;
        v_save public.merge_saves%ROWTYPE;
        v_inserted integer := 0;
        v_revision bigint;
BEGIN
  IF p_user_id IS NULL OR p_confirmed IS DISTINCT FROM TRUE OR
    p_source_sha256 IS NULL OR p_source_sha256 !~ '^[0-9a-f]{64}
    RETURN pg_catalog.jsonb_build_object(
      'ok',false,'status','rejected','code','INVALID_MIGRATION_CLAIM');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.merge_cloud_allowlist AS a
                 WHERE a.user_id=p_user_id) THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok',false,'status','rejected','code','CLOUD_ACCESS_DENIED');
  END IF;
  SELECT * INTO v_grant FROM public.merge_normal_migration_grants
    WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok',false,'status','rejected','code','NO_APPROVED_MIGRATION');
  END IF;
  IF v_grant.source_sha256<>p_source_sha256 THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok',false,'status','rejected','code','MIGRATION_SOURCE_MISMATCH');
  END IF;
  IF v_grant.consumed_at IS NOT NULL THEN
    SELECT * INTO v_save FROM public.merge_saves
      WHERE user_id=p_user_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'consumed migration without authoritative save';
    END IF;
    RETURN pg_catalog.jsonb_build_object('ok',true,'status','replayed',
      'revision',v_save.revision,'state',v_save.state);
  END IF;
  v_revision:=(v_grant.approved_state->>'revision')::bigint;
  IF v_revision<1 OR (v_grant.approved_state->>'schemaVersion')::int<>3
     OR pg_catalog.octet_length(v_grant.approved_state::text)>640000 THEN
    RAISE EXCEPTION 'invalid administrative migration state';
  END IF;
  -- If there is no cloud save yet, initialize directly from the explicitly
  -- approved server-side snapshot. A concurrently created new-game save is
  -- handled via row locking and the safe-unplayed check below.
  INSERT INTO public.merge_saves(user_id,revision,state)
    VALUES(p_user_id,v_revision,v_grant.approved_state)
    ON CONFLICT(user_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted=ROW_COUNT;
  SELECT * INTO STRICT v_save FROM public.merge_saves
    WHERE user_id=p_user_id FOR UPDATE;
  IF v_inserted=0 THEN
    IF v_save.revision<>0 OR
       (v_save.state->>'coins')::bigint<>0 OR
       (v_save.state->>'xp')::bigint<>0 OR
       EXISTS(SELECT 1 FROM public.merge_operations
              WHERE user_id=p_user_id) THEN
      RETURN pg_catalog.jsonb_build_object(
        'ok',false,'status','rejected','code','CLOUD_ALREADY_PLAYED',
        'revision',v_save.revision);
    END IF;
    UPDATE public.merge_saves
      SET state=v_grant.approved_state,revision=v_revision,
          updated_at=pg_catalog.now()
      WHERE user_id=p_user_id;
  END IF;
  UPDATE public.merge_normal_migration_grants
    SET consumed_at=pg_catalog.now()
    WHERE user_id=p_user_id AND consumed_at IS NULL;
  RETURN pg_catalog.jsonb_build_object('ok',true,'status','applied',
    'revision',v_revision,'state',v_grant.approved_state);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_claim_approved_normal_save(uuid,text,boolean)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.merge_claim_approved_normal_save(uuid,text,boolean)
  TO service_role;
COMMIT;

-- Manual production approval procedure: match a PRIVATE, independently
-- validated source-file SHA256 with the player, verify game-state semantics,
-- confirm the admin UID and obtain explicit owner release approval. Never
-- add a browser-accessible grant INSERT endpoint. Never overwrite an existing
-- consumed grant. Test all failures against isolated Postgres first.
 THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok',false,'status','rejected','code','INVALID_MIGRATION_CLAIM');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.merge_cloud_allowlist AS a
                 WHERE a.user_id=p_user_id) THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok',false,'status','rejected','code','CLOUD_ACCESS_DENIED');
  END IF;
  SELECT * INTO v_grant FROM public.merge_normal_migration_grants
    WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok',false,'status','rejected','code','NO_APPROVED_MIGRATION');
  END IF;
  IF v_grant.source_sha256<>p_source_sha256 THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok',false,'status','rejected','code','MIGRATION_SOURCE_MISMATCH');
  END IF;
  IF v_grant.consumed_at IS NOT NULL THEN
    SELECT * INTO v_save FROM public.merge_saves
      WHERE user_id=p_user_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'consumed migration without authoritative save';
    END IF;
    RETURN pg_catalog.jsonb_build_object('ok',true,'status','replayed',
      'revision',v_save.revision,'state',v_save.state);
  END IF;
  v_revision:=(v_grant.approved_state->>'revision')::bigint;
  IF v_revision<1 OR (v_grant.approved_state->>'schemaVersion')::int<>3
     OR pg_catalog.octet_length(v_grant.approved_state::text)>640000 THEN
    RAISE EXCEPTION 'invalid administrative migration state';
  END IF;
  -- If there is no cloud save yet, initialize directly from the explicitly
  -- approved server-side snapshot. A concurrently created new-game save is
  -- handled via row locking and the safe-unplayed check below.
  INSERT INTO public.merge_saves(user_id,revision,state)
    VALUES(p_user_id,v_revision,v_grant.approved_state)
    ON CONFLICT(user_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted=ROW_COUNT;
  SELECT * INTO STRICT v_save FROM public.merge_saves
    WHERE user_id=p_user_id FOR UPDATE;
  IF v_inserted=0 THEN
    IF v_save.revision<>0 OR
       (v_save.state->>'coins')::bigint<>0 OR
       (v_save.state->>'xp')::bigint<>0 OR
       EXISTS(SELECT 1 FROM public.merge_operations
              WHERE user_id=p_user_id) THEN
      RETURN pg_catalog.jsonb_build_object(
        'ok',false,'status','rejected','code','CLOUD_ALREADY_PLAYED',
        'revision',v_save.revision);
    END IF;
    UPDATE public.merge_saves
      SET state=v_grant.approved_state,revision=v_revision,
          updated_at=pg_catalog.now()
      WHERE user_id=p_user_id;
  END IF;
  UPDATE public.merge_normal_migration_grants
    SET consumed_at=pg_catalog.now()
    WHERE user_id=p_user_id AND consumed_at IS NULL;
  RETURN pg_catalog.jsonb_build_object('ok',true,'status','applied',
    'revision',v_revision,'state',v_grant.approved_state);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_claim_approved_normal_save(uuid,text,boolean)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.merge_claim_approved_normal_save(uuid,text,boolean)
  TO service_role;
COMMIT;

-- Manual production approval procedure: match a PRIVATE, independently
-- validated source-file SHA256 with the player, verify game-state semantics,
-- confirm the admin UID and obtain explicit owner release approval. Never
-- add a browser-accessible grant INSERT endpoint. Never overwrite an existing
-- consumed grant. Test all failures against isolated Postgres first.
