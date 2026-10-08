import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const initial=readFileSync(new URL('../supabase/migrations/20261008011529_bead_event_ledger_and_guess_payload_hardening.sql',import.meta.url),'utf8');
const final=readFileSync(new URL('../supabase/migrations/20261008011639_bead_inventory_trigger_audit.sql',import.meta.url),'utf8');
const client=readFileSync(new URL('../beads/app.js',import.meta.url),'utf8');

test('inventory history is trigger-generated and browser event inserts remain forbidden',()=>{
  assert.match(initial,/REVOKE INSERT ON TABLE public\.bead_inventory_events FROM PUBLIC, anon, authenticated/i);
  assert.match(initial,/DROP POLICY IF EXISTS bead_inventory_events_insert/);
  assert.match(final,/CREATE TRIGGER audit_bead_inventory_changes[\s\S]*?AFTER INSERT OR UPDATE OR DELETE ON public\.bead_inventory/i);
  assert.match(final,/REVOKE ALL ON FUNCTION private\.audit_bead_inventory_change\(\) FROM PUBLIC, anon, authenticated/i);
  assert.match(final,/SECURITY DEFINER[\s\S]*?SET search_path TO ''[\s\S]*?INSERT INTO public\.bead_inventory_events/);
  assert.match(final,/NEW\.quantity - CASE WHEN TG_OP = 'INSERT' THEN 0 ELSE OLD\.quantity END/);
  assert.match(final,/OLD\.quantity,0,'delete'/);
});

test('inventory RPC uses caller identity and RLS, not a public definer function',()=>{
  assert.match(final,/ALTER FUNCTION public\.bead_set_inventory\([^;]+\) SECURITY INVOKER;/);
  const rpc=final.match(/CREATE OR REPLACE FUNCTION public\.bead_set_inventory[\s\S]*?\$function\$;/)?.[0];
  assert.ok(rpc,'invoker RPC must be included in migration');
  assert.match(rpc,/private\.has_active_session\(\)/);
  assert.match(rpc,/private\.can_edit_bead_group\(p_group_id\)/);
  assert.match(rpc,/auth\.uid\(\)/);
  assert.match(rpc,/pg_catalog\.set_config\('app\.bead_event_reason'/);
  assert.doesNotMatch(rpc,/insert into public\.bead_inventory_events/i);
  assert.match(client,/db\.rpc\('bead_set_inventory',payload\)/);
  assert.match(final,/GRANT INSERT, UPDATE, DELETE ON TABLE public\.bead_inventory TO authenticated;/);
});

test('realtime optimistic guess broadcasts are bounded without restricting drawing',()=>{
  assert.match(initial,/CREATE OR REPLACE FUNCTION private\.is_pictionary_guess_sender/);
  assert.match(initial,/char_length\(trim\(coalesce\(p_payload->>'text',''\)\)\) between 1 and 40/);
  assert.match(initial,/octet_length\(p_payload::text\) <= 2048/);
  assert.doesNotMatch(final,/CREATE OR REPLACE FUNCTION private\.is_pictionary_guess_sender/);
});
