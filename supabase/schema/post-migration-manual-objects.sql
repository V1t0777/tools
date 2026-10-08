-- DATA-FREE RECOVERY COMPANION, NOT AN APPLIED MIGRATION.
-- Use only on an isolated fresh Supabase project AFTER the 42 historical migrations.
-- Defines missing schema details: checks, FKs, indexes, RLS policies and grants.
SET search_path TO public, private;

CREATE OR REPLACE FUNCTION private.can_edit_bead_group(p_group_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.has_active_session()
     and exists (
       select 1
       from public.bead_group_members m
       where m.group_id = p_group_id
         and m.user_id = auth.uid()
         and m.role in ('editor','admin')
     );
$function$;
REVOKE ALL ON FUNCTION private."can_edit_bead_group"(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private."can_edit_bead_group"(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.is_bead_group_member(p_group_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.has_active_session()
     and exists (
       select 1
       from public.bead_group_members m
       where m.group_id = p_group_id
         and m.user_id = auth.uid()
     );
$function$;
REVOKE ALL ON FUNCTION private."is_bead_group_member"(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private."is_bead_group_member"(uuid) TO authenticated;

DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_group_members'::regclass AND conname='bead_group_members_display_name_check') THEN
    ALTER TABLE public."bead_group_members" ADD CONSTRAINT "bead_group_members_display_name_check" CHECK (char_length(display_name) >= 1 AND char_length(display_name) <= 40);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_group_members'::regclass AND conname='bead_group_members_group_id_fkey') THEN
    ALTER TABLE public."bead_group_members" ADD CONSTRAINT "bead_group_members_group_id_fkey" FOREIGN KEY (group_id) REFERENCES bead_groups(id) ON DELETE CASCADE;
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_group_members'::regclass AND conname='bead_group_members_role_check') THEN
    ALTER TABLE public."bead_group_members" ADD CONSTRAINT "bead_group_members_role_check" CHECK (role = ANY (ARRAY['viewer'::text, 'editor'::text, 'admin'::text]));
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_group_members'::regclass AND conname='bead_group_members_user_id_fkey') THEN
    ALTER TABLE public."bead_group_members" ADD CONSTRAINT "bead_group_members_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_groups'::regclass AND conname='bead_groups_created_by_fkey') THEN
    ALTER TABLE public."bead_groups" ADD CONSTRAINT "bead_groups_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_groups'::regclass AND conname='bead_groups_name_check') THEN
    ALTER TABLE public."bead_groups" ADD CONSTRAINT "bead_groups_name_check" CHECK (char_length(name) >= 1 AND char_length(name) <= 60);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_groups'::regclass AND conname='bead_groups_name_key') THEN
    ALTER TABLE public."bead_groups" ADD CONSTRAINT "bead_groups_name_key" UNIQUE (name);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_inventory'::regclass AND conname='bead_inventory_check') THEN
    ALTER TABLE public."bead_inventory" ADD CONSTRAINT "bead_inventory_check" CHECK (((owner_user_id IS NOT NULL)::integer + (group_id IS NOT NULL)::integer) = 1);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_inventory'::regclass AND conname='bead_inventory_color_code_check') THEN
    ALTER TABLE public."bead_inventory" ADD CONSTRAINT "bead_inventory_color_code_check" CHECK (char_length(color_code) >= 1 AND char_length(color_code) <= 40);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_inventory'::regclass AND conname='bead_inventory_color_hex_check') THEN
    ALTER TABLE public."bead_inventory" ADD CONSTRAINT "bead_inventory_color_hex_check" CHECK (color_hex ~ '^#[0-9A-Fa-f]{6}$'::text);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_inventory'::regclass AND conname='bead_inventory_color_name_check') THEN
    ALTER TABLE public."bead_inventory" ADD CONSTRAINT "bead_inventory_color_name_check" CHECK (char_length(color_name) <= 80);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_inventory'::regclass AND conname='bead_inventory_group_id_fkey') THEN
    ALTER TABLE public."bead_inventory" ADD CONSTRAINT "bead_inventory_group_id_fkey" FOREIGN KEY (group_id) REFERENCES bead_groups(id) ON DELETE CASCADE;
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_inventory'::regclass AND conname='bead_inventory_owner_user_id_fkey') THEN
    ALTER TABLE public."bead_inventory" ADD CONSTRAINT "bead_inventory_owner_user_id_fkey" FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_inventory'::regclass AND conname='bead_inventory_palette_name_check') THEN
    ALTER TABLE public."bead_inventory" ADD CONSTRAINT "bead_inventory_palette_name_check" CHECK (char_length(palette_name) >= 1 AND char_length(palette_name) <= 80);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_inventory'::regclass AND conname='bead_inventory_quantity_check') THEN
    ALTER TABLE public."bead_inventory" ADD CONSTRAINT "bead_inventory_quantity_check" CHECK (quantity >= 0 AND quantity <= 10000000);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_inventory'::regclass AND conname='bead_inventory_updated_by_fkey') THEN
    ALTER TABLE public."bead_inventory" ADD CONSTRAINT "bead_inventory_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_inventory_events'::regclass AND conname='bead_inventory_events_changed_by_fkey') THEN
    ALTER TABLE public."bead_inventory_events" ADD CONSTRAINT "bead_inventory_events_changed_by_fkey" FOREIGN KEY (changed_by) REFERENCES auth.users(id);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_inventory_events'::regclass AND conname='bead_inventory_events_check') THEN
    ALTER TABLE public."bead_inventory_events" ADD CONSTRAINT "bead_inventory_events_check" CHECK (((owner_user_id IS NOT NULL)::integer + (group_id IS NOT NULL)::integer) = 1);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_inventory_events'::regclass AND conname='bead_inventory_events_group_id_fkey') THEN
    ALTER TABLE public."bead_inventory_events" ADD CONSTRAINT "bead_inventory_events_group_id_fkey" FOREIGN KEY (group_id) REFERENCES bead_groups(id) ON DELETE CASCADE;
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_inventory_events'::regclass AND conname='bead_inventory_events_owner_user_id_fkey') THEN
    ALTER TABLE public."bead_inventory_events" ADD CONSTRAINT "bead_inventory_events_owner_user_id_fkey" FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_inventory_events'::regclass AND conname='bead_inventory_events_project_id_fkey') THEN
    ALTER TABLE public."bead_inventory_events" ADD CONSTRAINT "bead_inventory_events_project_id_fkey" FOREIGN KEY (project_id) REFERENCES bead_projects(id) ON DELETE SET NULL;
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_inventory_events'::regclass AND conname='bead_inventory_events_reason_check') THEN
    ALTER TABLE public."bead_inventory_events" ADD CONSTRAINT "bead_inventory_events_reason_check" CHECK (char_length(reason) >= 1 AND char_length(reason) <= 120);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_inventory_events'::regclass AND conname='bead_inventory_events_resulting_quantity_check') THEN
    ALTER TABLE public."bead_inventory_events" ADD CONSTRAINT "bead_inventory_events_resulting_quantity_check" CHECK (resulting_quantity >= 0);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_projects'::regclass AND conname='bead_projects_blank_cells_check') THEN
    ALTER TABLE public."bead_projects" ADD CONSTRAINT "bead_projects_blank_cells_check" CHECK (blank_cells >= 0);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_projects'::regclass AND conname='bead_projects_grid_height_check') THEN
    ALTER TABLE public."bead_projects" ADD CONSTRAINT "bead_projects_grid_height_check" CHECK (grid_height >= 1 AND grid_height <= 300);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_projects'::regclass AND conname='bead_projects_grid_width_check') THEN
    ALTER TABLE public."bead_projects" ADD CONSTRAINT "bead_projects_grid_width_check" CHECK (grid_width >= 1 AND grid_width <= 300);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_projects'::regclass AND conname='bead_projects_group_id_fkey') THEN
    ALTER TABLE public."bead_projects" ADD CONSTRAINT "bead_projects_group_id_fkey" FOREIGN KEY (group_id) REFERENCES bead_groups(id) ON DELETE CASCADE;
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_projects'::regclass AND conname='bead_projects_low_confidence_cells_check') THEN
    ALTER TABLE public."bead_projects" ADD CONSTRAINT "bead_projects_low_confidence_cells_check" CHECK (low_confidence_cells >= 0);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_projects'::regclass AND conname='bead_projects_owner_user_id_fkey') THEN
    ALTER TABLE public."bead_projects" ADD CONSTRAINT "bead_projects_owner_user_id_fkey" FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_projects'::regclass AND conname='bead_projects_palette_name_check') THEN
    ALTER TABLE public."bead_projects" ADD CONSTRAINT "bead_projects_palette_name_check" CHECK (char_length(palette_name) >= 1 AND char_length(palette_name) <= 80);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_projects'::regclass AND conname='bead_projects_source_mode_check') THEN
    ALTER TABLE public."bead_projects" ADD CONSTRAINT "bead_projects_source_mode_check" CHECK (source_mode = ANY (ARRAY['grid'::text, 'photo'::text]));
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_projects'::regclass AND conname='bead_projects_title_check') THEN
    ALTER TABLE public."bead_projects" ADD CONSTRAINT "bead_projects_title_check" CHECK (char_length(title) >= 1 AND char_length(title) <= 100);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_projects'::regclass AND conname='bead_projects_total_beads_check') THEN
    ALTER TABLE public."bead_projects" ADD CONSTRAINT "bead_projects_total_beads_check" CHECK (total_beads >= 0);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bead_projects'::regclass AND conname='bead_projects_total_cells_check') THEN
    ALTER TABLE public."bead_projects" ADD CONSTRAINT "bead_projects_total_cells_check" CHECK (total_cells >= 1);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.members'::regclass AND conname='members_color_check') THEN
    ALTER TABLE public."members" ADD CONSTRAINT "members_color_check" CHECK (color ~ '^#[0-9A-Fa-f]{6}$'::text);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.members'::regclass AND conname='members_nickname_check') THEN
    ALTER TABLE public."members" ADD CONSTRAINT "members_nickname_check" CHECK (char_length(nickname) >= 1 AND char_length(nickname) <= 20);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.members'::regclass AND conname='members_user_id_fkey') THEN
    ALTER TABLE public."members" ADD CONSTRAINT "members_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.members'::regclass AND conname='members_user_id_key') THEN
    ALTER TABLE public."members" ADD CONSTRAINT "members_user_id_key" UNIQUE (user_id);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.night_shifts'::regclass AND conname='night_shifts_member_id_fkey') THEN
    ALTER TABLE public."night_shifts" ADD CONSTRAINT "night_shifts_member_id_fkey" FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.night_shifts'::regclass AND conname='night_shifts_member_id_shift_date_shift_type_key') THEN
    ALTER TABLE public."night_shifts" ADD CONSTRAINT "night_shifts_member_id_shift_date_shift_type_key" UNIQUE (member_id, shift_date, shift_type);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.night_shifts'::regclass AND conname='night_shifts_note_check') THEN
    ALTER TABLE public."night_shifts" ADD CONSTRAINT "night_shifts_note_check" CHECK (note IS NULL OR char_length(note) <= 100);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.night_shifts'::regclass AND conname='night_shifts_shift_type_check') THEN
    ALTER TABLE public."night_shifts" ADD CONSTRAINT "night_shifts_shift_type_check" CHECK (shift_type = ANY (ARRAY['夜班'::text, '小夜'::text, '大夜'::text, '二线'::text, '备班'::text]));
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pictionary_players'::regclass AND conname='pictionary_players_display_name_check') THEN
    ALTER TABLE public."pictionary_players" ADD CONSTRAINT "pictionary_players_display_name_check" CHECK (char_length(display_name) >= 1 AND char_length(display_name) <= 40);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pictionary_players'::regclass AND conname='pictionary_players_room_id_fkey') THEN
    ALTER TABLE public."pictionary_players" ADD CONSTRAINT "pictionary_players_room_id_fkey" FOREIGN KEY (room_id) REFERENCES pictionary_rooms(id) ON DELETE CASCADE;
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pictionary_players'::regclass AND conname='pictionary_players_room_id_seat_key') THEN
    ALTER TABLE public."pictionary_players" ADD CONSTRAINT "pictionary_players_room_id_seat_key" UNIQUE (room_id, seat);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pictionary_players'::regclass AND conname='pictionary_players_score_check') THEN
    ALTER TABLE public."pictionary_players" ADD CONSTRAINT "pictionary_players_score_check" CHECK (score >= 0);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pictionary_players'::regclass AND conname='pictionary_players_seat_check') THEN
    ALTER TABLE public."pictionary_players" ADD CONSTRAINT "pictionary_players_seat_check" CHECK (seat >= 1 AND seat <= 8);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pictionary_players'::regclass AND conname='pictionary_players_user_id_fkey') THEN
    ALTER TABLE public."pictionary_players" ADD CONSTRAINT "pictionary_players_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pictionary_rooms'::regclass AND conname='pictionary_rooms_current_drawer_user_id_fkey') THEN
    ALTER TABLE public."pictionary_rooms" ADD CONSTRAINT "pictionary_rooms_current_drawer_user_id_fkey" FOREIGN KEY (current_drawer_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pictionary_rooms'::regclass AND conname='pictionary_rooms_current_round_no_check') THEN
    ALTER TABLE public."pictionary_rooms" ADD CONSTRAINT "pictionary_rooms_current_round_no_check" CHECK (current_round_no >= 0);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pictionary_rooms'::regclass AND conname='pictionary_rooms_host_user_id_fkey') THEN
    ALTER TABLE public."pictionary_rooms" ADD CONSTRAINT "pictionary_rooms_host_user_id_fkey" FOREIGN KEY (host_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pictionary_rooms'::regclass AND conname='pictionary_rooms_room_code_check') THEN
    ALTER TABLE public."pictionary_rooms" ADD CONSTRAINT "pictionary_rooms_room_code_check" CHECK (room_code ~ '^[A-Z2-9]{6}$'::text);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pictionary_rooms'::regclass AND conname='pictionary_rooms_room_code_key') THEN
    ALTER TABLE public."pictionary_rooms" ADD CONSTRAINT "pictionary_rooms_room_code_key" UNIQUE (room_code);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pictionary_rooms'::regclass AND conname='pictionary_rooms_rounds_per_player_check') THEN
    ALTER TABLE public."pictionary_rooms" ADD CONSTRAINT "pictionary_rooms_rounds_per_player_check" CHECK (rounds_per_player >= 1 AND rounds_per_player <= 4);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pictionary_rooms'::regclass AND conname='pictionary_rooms_status_check') THEN
    ALTER TABLE public."pictionary_rooms" ADD CONSTRAINT "pictionary_rooms_status_check" CHECK (status = ANY (ARRAY['lobby'::text, 'choosing'::text, 'playing'::text, 'summary'::text, 'finished'::text, 'closed'::text, 'abandoned'::text]));
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pictionary_rooms'::regclass AND conname='pictionary_rooms_total_rounds_check') THEN
    ALTER TABLE public."pictionary_rooms" ADD CONSTRAINT "pictionary_rooms_total_rounds_check" CHECK (total_rounds >= 0);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pictionary_round_results'::regclass AND conname='pictionary_round_results_points_check') THEN
    ALTER TABLE public."pictionary_round_results" ADD CONSTRAINT "pictionary_round_results_points_check" CHECK (points >= 0);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pictionary_round_results'::regclass AND conname='pictionary_round_results_rank_check') THEN
    ALTER TABLE public."pictionary_round_results" ADD CONSTRAINT "pictionary_round_results_rank_check" CHECK (rank > 0);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pictionary_round_results'::regclass AND conname='pictionary_round_results_round_id_fkey') THEN
    ALTER TABLE public."pictionary_round_results" ADD CONSTRAINT "pictionary_round_results_round_id_fkey" FOREIGN KEY (round_id) REFERENCES pictionary_rounds(id) ON DELETE CASCADE;
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pictionary_round_results'::regclass AND conname='pictionary_round_results_user_id_fkey') THEN
    ALTER TABLE public."pictionary_round_results" ADD CONSTRAINT "pictionary_round_results_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pictionary_rounds'::regclass AND conname='pictionary_rounds_difficulty_check') THEN
    ALTER TABLE public."pictionary_rounds" ADD CONSTRAINT "pictionary_rounds_difficulty_check" CHECK (difficulty >= 1 AND difficulty <= 3);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pictionary_rounds'::regclass AND conname='pictionary_rounds_drawer_user_id_fkey') THEN
    ALTER TABLE public."pictionary_rounds" ADD CONSTRAINT "pictionary_rounds_drawer_user_id_fkey" FOREIGN KEY (drawer_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pictionary_rounds'::regclass AND conname='pictionary_rounds_room_id_fkey') THEN
    ALTER TABLE public."pictionary_rounds" ADD CONSTRAINT "pictionary_rounds_room_id_fkey" FOREIGN KEY (room_id) REFERENCES pictionary_rooms(id) ON DELETE CASCADE;
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pictionary_rounds'::regclass AND conname='pictionary_rounds_room_id_round_no_key') THEN
    ALTER TABLE public."pictionary_rounds" ADD CONSTRAINT "pictionary_rounds_room_id_round_no_key" UNIQUE (room_id, round_no);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pictionary_rounds'::regclass AND conname='pictionary_rounds_round_no_check') THEN
    ALTER TABLE public."pictionary_rounds" ADD CONSTRAINT "pictionary_rounds_round_no_check" CHECK (round_no > 0);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pictionary_rounds'::regclass AND conname='pictionary_rounds_status_check') THEN
    ALTER TABLE public."pictionary_rounds" ADD CONSTRAINT "pictionary_rounds_status_check" CHECK (status = ANY (ARRAY['choosing'::text, 'drawing'::text, 'ended'::text]));
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pictionary_rounds'::regclass AND conname='pictionary_rounds_word_id_fkey') THEN
    ALTER TABLE public."pictionary_rounds" ADD CONSTRAINT "pictionary_rounds_word_id_fkey" FOREIGN KEY (word_id) REFERENCES pictionary_words(id);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pictionary_rounds'::regclass AND conname='pictionary_rounds_word_length_check') THEN
    ALTER TABLE public."pictionary_rounds" ADD CONSTRAINT "pictionary_rounds_word_length_check" CHECK (word_length >= 1 AND word_length <= 20);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pictionary_words'::regclass AND conname='pictionary_words_category_check') THEN
    ALTER TABLE public."pictionary_words" ADD CONSTRAINT "pictionary_words_category_check" CHECK (char_length(category) >= 1 AND char_length(category) <= 20);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pictionary_words'::regclass AND conname='pictionary_words_difficulty_check') THEN
    ALTER TABLE public."pictionary_words" ADD CONSTRAINT "pictionary_words_difficulty_check" CHECK (difficulty >= 1 AND difficulty <= 3);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pictionary_words'::regclass AND conname='pictionary_words_use_count_check') THEN
    ALTER TABLE public."pictionary_words" ADD CONSTRAINT "pictionary_words_use_count_check" CHECK (use_count >= 0);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pictionary_words'::regclass AND conname='pictionary_words_word_check') THEN
    ALTER TABLE public."pictionary_words" ADD CONSTRAINT "pictionary_words_word_check" CHECK (char_length(word) >= 1 AND char_length(word) <= 20);
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pictionary_words'::regclass AND conname='pictionary_words_word_key') THEN
    ALTER TABLE public."pictionary_words" ADD CONSTRAINT "pictionary_words_word_key" UNIQUE (word);
  END IF;
END;
$reconcile$;
CREATE INDEX IF NOT EXISTS bead_inventory_group_idx ON public.bead_inventory USING btree (group_id);
CREATE UNIQUE INDEX IF NOT EXISTS bead_inventory_group_uniq ON public.bead_inventory USING btree (group_id, palette_name, color_code) WHERE (owner_user_id IS NULL);
CREATE INDEX IF NOT EXISTS bead_inventory_owner_idx ON public.bead_inventory USING btree (owner_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS bead_inventory_personal_uniq ON public.bead_inventory USING btree (owner_user_id, palette_name, color_code) WHERE (group_id IS NULL);
CREATE INDEX IF NOT EXISTS bead_inventory_events_group_idx ON public.bead_inventory_events USING btree (group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bead_inventory_events_owner_idx ON public.bead_inventory_events USING btree (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bead_projects_group_idx ON public.bead_projects USING btree (group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bead_projects_owner_idx ON public.bead_projects USING btree (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS night_shifts_date_idx ON public.night_shifts USING btree (shift_date);
CREATE INDEX IF NOT EXISTS night_shifts_member_idx ON public.night_shifts USING btree (member_id);
CREATE INDEX IF NOT EXISTS pictionary_players_user_idx ON public.pictionary_players USING btree (user_id);
CREATE INDEX IF NOT EXISTS pictionary_players_user_room_idx ON public.pictionary_players USING btree (user_id, room_id) WHERE active;
CREATE INDEX IF NOT EXISTS pictionary_rooms_code_idx ON public.pictionary_rooms USING btree (room_code);
CREATE INDEX IF NOT EXISTS pictionary_rooms_drawer_idx ON public.pictionary_rooms USING btree (current_drawer_user_id);
CREATE INDEX IF NOT EXISTS pictionary_rooms_host_idx ON public.pictionary_rooms USING btree (host_user_id);
CREATE INDEX IF NOT EXISTS pictionary_rooms_lifecycle_idx ON public.pictionary_rooms USING btree (status, last_activity_at);
CREATE INDEX IF NOT EXISTS pictionary_round_results_round_idx ON public.pictionary_round_results USING btree (round_id);
CREATE INDEX IF NOT EXISTS pictionary_round_results_user_idx ON public.pictionary_round_results USING btree (user_id);
CREATE INDEX IF NOT EXISTS pictionary_rounds_drawer_idx ON public.pictionary_rounds USING btree (drawer_user_id);
CREATE INDEX IF NOT EXISTS pictionary_rounds_room_idx ON public.pictionary_rounds USING btree (room_id, round_no);
CREATE INDEX IF NOT EXISTS pictionary_rounds_word_idx ON public.pictionary_rounds USING btree (word_id);
CREATE INDEX IF NOT EXISTS pictionary_words_usage_idx ON public.pictionary_words USING btree (active, last_used_at, use_count);
DROP POLICY IF EXISTS "bead_group_members_select_member" ON public."bead_group_members";
CREATE POLICY "bead_group_members_select_member" ON public."bead_group_members" AS PERMISSIVE FOR SELECT TO "authenticated" USING (private.is_bead_group_member(group_id));
DROP POLICY IF EXISTS "bead_groups_select_member" ON public."bead_groups";
CREATE POLICY "bead_groups_select_member" ON public."bead_groups" AS PERMISSIVE FOR SELECT TO "authenticated" USING (private.is_bead_group_member(id));
DROP POLICY IF EXISTS "bead_inventory_delete" ON public."bead_inventory";
CREATE POLICY "bead_inventory_delete" ON public."bead_inventory" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((private.has_active_session() AND ((owner_user_id = ( SELECT auth.uid() AS uid)) OR ((group_id IS NOT NULL) AND private.can_edit_bead_group(group_id)))));
DROP POLICY IF EXISTS "bead_inventory_insert" ON public."bead_inventory";
CREATE POLICY "bead_inventory_insert" ON public."bead_inventory" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((private.has_active_session() AND (updated_by = ( SELECT auth.uid() AS uid)) AND (((owner_user_id = ( SELECT auth.uid() AS uid)) AND (group_id IS NULL)) OR ((owner_user_id IS NULL) AND (group_id IS NOT NULL) AND private.can_edit_bead_group(group_id)))));
DROP POLICY IF EXISTS "bead_inventory_select" ON public."bead_inventory";
CREATE POLICY "bead_inventory_select" ON public."bead_inventory" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((private.has_active_session() AND ((owner_user_id = ( SELECT auth.uid() AS uid)) OR ((group_id IS NOT NULL) AND private.is_bead_group_member(group_id)))));
DROP POLICY IF EXISTS "bead_inventory_update" ON public."bead_inventory";
CREATE POLICY "bead_inventory_update" ON public."bead_inventory" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((private.has_active_session() AND ((owner_user_id = ( SELECT auth.uid() AS uid)) OR ((group_id IS NOT NULL) AND private.can_edit_bead_group(group_id))))) WITH CHECK ((private.has_active_session() AND (updated_by = ( SELECT auth.uid() AS uid)) AND (((owner_user_id = ( SELECT auth.uid() AS uid)) AND (group_id IS NULL)) OR ((owner_user_id IS NULL) AND (group_id IS NOT NULL) AND private.can_edit_bead_group(group_id)))));
DROP POLICY IF EXISTS "bead_inventory_events_select" ON public."bead_inventory_events";
CREATE POLICY "bead_inventory_events_select" ON public."bead_inventory_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((private.has_active_session() AND ((owner_user_id = ( SELECT auth.uid() AS uid)) OR ((group_id IS NOT NULL) AND private.is_bead_group_member(group_id)))));
DROP POLICY IF EXISTS "bead_projects_delete" ON public."bead_projects";
CREATE POLICY "bead_projects_delete" ON public."bead_projects" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((private.has_active_session() AND ((owner_user_id = ( SELECT auth.uid() AS uid)) OR ((group_id IS NOT NULL) AND private.can_edit_bead_group(group_id)))));
DROP POLICY IF EXISTS "bead_projects_insert" ON public."bead_projects";
CREATE POLICY "bead_projects_insert" ON public."bead_projects" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((private.has_active_session() AND (owner_user_id = ( SELECT auth.uid() AS uid)) AND ((group_id IS NULL) OR private.can_edit_bead_group(group_id))));
DROP POLICY IF EXISTS "bead_projects_select" ON public."bead_projects";
CREATE POLICY "bead_projects_select" ON public."bead_projects" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((private.has_active_session() AND ((owner_user_id = ( SELECT auth.uid() AS uid)) OR ((group_id IS NOT NULL) AND private.is_bead_group_member(group_id)))));
DROP POLICY IF EXISTS "bead_projects_update" ON public."bead_projects";
CREATE POLICY "bead_projects_update" ON public."bead_projects" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((private.has_active_session() AND ((owner_user_id = ( SELECT auth.uid() AS uid)) OR ((group_id IS NOT NULL) AND private.can_edit_bead_group(group_id))))) WITH CHECK ((private.has_active_session() AND (owner_user_id = ( SELECT auth.uid() AS uid)) AND ((group_id IS NULL) OR private.can_edit_bead_group(group_id))));
DROP POLICY IF EXISTS "members_can_read_members" ON public."members";
CREATE POLICY "members_can_read_members" ON public."members" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((( SELECT private.has_app_role('night_shift'::text, ARRAY['viewer'::text, 'editor'::text, 'admin'::text]) AS has_app_role) OR ( SELECT private.has_app_role('department_roster'::text, ARRAY['viewer'::text, 'editor'::text, 'admin'::text]) AS has_app_role)));
DROP POLICY IF EXISTS "night_shift_authorized_read" ON public."night_shifts";
CREATE POLICY "night_shift_authorized_read" ON public."night_shifts" AS PERMISSIVE FOR SELECT TO "authenticated" USING (( SELECT private.has_app_role('night_shift'::text, ARRAY['viewer'::text, 'editor'::text, 'admin'::text]) AS has_app_role));
DROP POLICY IF EXISTS "night_shift_editor_delete_own" ON public."night_shifts";
CREATE POLICY "night_shift_editor_delete_own" ON public."night_shifts" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((( SELECT private.has_app_role('night_shift'::text, ARRAY['editor'::text, 'admin'::text]) AS has_app_role) AND (member_id = ( SELECT private.current_member_id() AS current_member_id))));
DROP POLICY IF EXISTS "night_shift_editor_insert_own" ON public."night_shifts";
CREATE POLICY "night_shift_editor_insert_own" ON public."night_shifts" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((( SELECT private.has_app_role('night_shift'::text, ARRAY['editor'::text, 'admin'::text]) AS has_app_role) AND (member_id = ( SELECT private.current_member_id() AS current_member_id))));
DROP POLICY IF EXISTS "night_shift_editor_update_own" ON public."night_shifts";
CREATE POLICY "night_shift_editor_update_own" ON public."night_shifts" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((( SELECT private.has_app_role('night_shift'::text, ARRAY['editor'::text, 'admin'::text]) AS has_app_role) AND (member_id = ( SELECT private.current_member_id() AS current_member_id)))) WITH CHECK ((( SELECT private.has_app_role('night_shift'::text, ARRAY['editor'::text, 'admin'::text]) AS has_app_role) AND (member_id = ( SELECT private.current_member_id() AS current_member_id))));
DROP POLICY IF EXISTS "pictionary players can read own membership" ON public."pictionary_players";
CREATE POLICY "pictionary players can read own membership" ON public."pictionary_players" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((( SELECT auth.uid() AS uid) = user_id));
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.bead_inventory'::regclass AND tgname='audit_bead_inventory_changes' AND NOT tgisinternal) THEN
    CREATE TRIGGER audit_bead_inventory_changes AFTER INSERT OR DELETE OR UPDATE ON bead_inventory FOR EACH ROW EXECUTE FUNCTION private.audit_bead_inventory_change();
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.members'::regclass AND tgname='members_rekey_on_revoke' AND NOT tgisinternal) THEN
    CREATE TRIGGER members_rekey_on_revoke BEFORE DELETE ON members FOR EACH ROW EXECUTE FUNCTION private.rekey_rooms_on_member_revocation();
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.pictionary_players'::regclass AND tgname='pictionary_rekey_removed_player' AND NOT tgisinternal) THEN
    CREATE TRIGGER pictionary_rekey_removed_player AFTER DELETE OR UPDATE OF active ON pictionary_players FOR EACH ROW EXECUTE FUNCTION private.rekey_game_player_revocation('pictionary');
  END IF;
END;
$reconcile$;
DO $reconcile$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.pictionary_players'::regclass AND tgname='pictionary_score_revision' AND NOT tgisinternal) THEN
    CREATE TRIGGER pictionary_score_revision AFTER UPDATE OF score ON pictionary_players FOR EACH ROW WHEN (old.score IS DISTINCT FROM new.score) EXECUTE FUNCTION private.pictionary_score_changed();
  END IF;
END;
$reconcile$;
ALTER TABLE public."members" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."members" FROM anon, authenticated;
GRANT SELECT ON TABLE public."members" TO authenticated;
ALTER TABLE public."night_shifts" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."night_shifts" FROM anon, authenticated;
GRANT DELETE,INSERT,SELECT,UPDATE ON TABLE public."night_shifts" TO authenticated;
ALTER TABLE public."pictionary_rooms" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."pictionary_rooms" FROM anon, authenticated;
ALTER TABLE public."pictionary_words" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."pictionary_words" FROM anon, authenticated;
ALTER TABLE public."pictionary_players" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."pictionary_players" FROM anon, authenticated;
ALTER TABLE public."pictionary_rounds" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."pictionary_rounds" FROM anon, authenticated;
ALTER TABLE public."pictionary_round_results" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."pictionary_round_results" FROM anon, authenticated;
ALTER TABLE public."bead_groups" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."bead_groups" FROM anon, authenticated;
GRANT SELECT ON TABLE public."bead_groups" TO authenticated;
ALTER TABLE public."bead_group_members" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."bead_group_members" FROM anon, authenticated;
GRANT SELECT ON TABLE public."bead_group_members" TO authenticated;
ALTER TABLE public."bead_inventory" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."bead_inventory" FROM anon, authenticated;
GRANT DELETE,INSERT,SELECT,UPDATE ON TABLE public."bead_inventory" TO authenticated;
ALTER TABLE public."bead_projects" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."bead_projects" FROM anon, authenticated;
GRANT DELETE,INSERT,SELECT,UPDATE ON TABLE public."bead_projects" TO authenticated;
ALTER TABLE public."bead_inventory_events" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."bead_inventory_events" FROM anon, authenticated;
GRANT SELECT ON TABLE public."bead_inventory_events" TO authenticated;
