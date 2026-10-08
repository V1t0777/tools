-- SCHEMA-ONLY RECOVERY INPUT (not a Supabase migration). No data or user identities.
-- Snapshot origin: production catalog, 2026-10-08.
-- Run ONLY against a fresh, isolated Supabase environment BEFORE the 42 historical migrations.
-- These 12 tables were created outside the recorded migration-history DDL.
-- Private admin_users/app_access are NOT included: the historical migrations move them between schemas.
-- Final constraints, policies, and indexes require the post-migration reconciliation script.

CREATE TABLE IF NOT EXISTS public."members" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "nickname" text NOT NULL,
  "color" text DEFAULT '#FFD98A'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "exclude_from_leaderboard" boolean DEFAULT false NOT NULL,
  CONSTRAINT "members_pkey" PRIMARY KEY (id)
);
ALTER TABLE public."members" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."night_shifts" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "member_id" uuid NOT NULL,
  "shift_date" date NOT NULL,
  "shift_type" text DEFAULT '夜班'::text NOT NULL,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "night_shifts_pkey" PRIMARY KEY (id)
);
ALTER TABLE public."night_shifts" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."pictionary_rooms" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "room_code" text NOT NULL,
  "host_user_id" uuid NOT NULL,
  "status" text DEFAULT 'lobby'::text NOT NULL,
  "current_round_no" integer DEFAULT 0 NOT NULL,
  "total_rounds" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  "rounds_per_player" smallint DEFAULT 2 NOT NULL,
  "current_drawer_user_id" uuid,
  "ends_at" timestamp with time zone,
  "summary_until" timestamp with time zone,
  "last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
  "closed_reason" text,
  "score_revision" bigint DEFAULT 0 NOT NULL,
  CONSTRAINT "pictionary_rooms_pkey" PRIMARY KEY (id)
);
ALTER TABLE public."pictionary_rooms" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."pictionary_words" (
  "id" bigint NOT NULL,
  "word" text NOT NULL,
  "category" text NOT NULL,
  "difficulty" smallint DEFAULT 1 NOT NULL,
  "use_count" integer DEFAULT 0 NOT NULL,
  "last_used_at" timestamp with time zone,
  "active" boolean DEFAULT true NOT NULL,
  CONSTRAINT "pictionary_words_pkey" PRIMARY KEY (id)
);
ALTER TABLE public."pictionary_words" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."pictionary_players" (
  "room_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "display_name" text NOT NULL,
  "seat" integer NOT NULL,
  "score" integer DEFAULT 0 NOT NULL,
  "ready" boolean DEFAULT false NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "joined_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pictionary_players_pkey" PRIMARY KEY (room_id, user_id)
);
ALTER TABLE public."pictionary_players" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."pictionary_rounds" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "room_id" uuid NOT NULL,
  "round_no" integer NOT NULL,
  "drawer_user_id" uuid NOT NULL,
  "status" text DEFAULT 'choosing'::text NOT NULL,
  "option_word_ids" bigint[] DEFAULT '{}'::bigint[] NOT NULL,
  "word_id" bigint,
  "answer" text,
  "category" text,
  "difficulty" smallint,
  "word_length" integer,
  "started_at" timestamp with time zone,
  "ends_at" timestamp with time zone,
  "ended_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "hint" text,
  "canvas_state" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "canvas_version" bigint DEFAULT 0 NOT NULL,
  "canvas_updated_at" timestamp with time zone,
  CONSTRAINT "pictionary_rounds_pkey" PRIMARY KEY (id)
);
ALTER TABLE public."pictionary_rounds" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."pictionary_round_results" (
  "round_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "guessed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "rank" integer NOT NULL,
  "points" integer NOT NULL,
  CONSTRAINT "pictionary_round_results_pkey" PRIMARY KEY (round_id, user_id)
);
ALTER TABLE public."pictionary_round_results" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."bead_groups" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "bead_groups_pkey" PRIMARY KEY (id)
);
ALTER TABLE public."bead_groups" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."bead_group_members" (
  "group_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "display_name" text NOT NULL,
  "role" text DEFAULT 'editor'::text NOT NULL,
  "joined_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "bead_group_members_pkey" PRIMARY KEY (group_id, user_id)
);
ALTER TABLE public."bead_group_members" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."bead_inventory" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "owner_user_id" uuid,
  "group_id" uuid,
  "palette_name" text DEFAULT '自定义'::text NOT NULL,
  "color_code" text NOT NULL,
  "color_name" text DEFAULT ''::text NOT NULL,
  "color_hex" text NOT NULL,
  "quantity" integer DEFAULT 0 NOT NULL,
  "updated_by" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "bead_inventory_pkey" PRIMARY KEY (id)
);
ALTER TABLE public."bead_inventory" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."bead_projects" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "owner_user_id" uuid NOT NULL,
  "group_id" uuid,
  "title" text NOT NULL,
  "palette_name" text DEFAULT '自动聚类'::text NOT NULL,
  "source_mode" text DEFAULT 'grid'::text NOT NULL,
  "grid_width" integer NOT NULL,
  "grid_height" integer NOT NULL,
  "total_cells" integer NOT NULL,
  "blank_cells" integer DEFAULT 0 NOT NULL,
  "total_beads" integer NOT NULL,
  "low_confidence_cells" integer DEFAULT 0 NOT NULL,
  "items" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "analysis_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "bead_projects_pkey" PRIMARY KEY (id)
);
ALTER TABLE public."bead_projects" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."bead_inventory_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "owner_user_id" uuid,
  "group_id" uuid,
  "palette_name" text NOT NULL,
  "color_code" text NOT NULL,
  "delta" integer NOT NULL,
  "resulting_quantity" integer NOT NULL,
  "reason" text DEFAULT 'manual'::text NOT NULL,
  "project_id" uuid,
  "changed_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "bead_inventory_events_pkey" PRIMARY KEY (id)
);
ALTER TABLE public."bead_inventory_events" ENABLE ROW LEVEL SECURITY;


-- Preexisting event-trigger function is altered by historical migration 20260916134550.
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
DO $ensure_rls$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_event_trigger WHERE evtname='ensure_rls') THEN
    CREATE EVENT TRIGGER ensure_rls ON ddl_command_end EXECUTE FUNCTION public.rls_auto_enable();
  END IF;
END;
$ensure_rls$;
