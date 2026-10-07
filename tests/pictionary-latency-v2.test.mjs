import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const app=readFileSync(new URL('../pictionary/app.js',import.meta.url),'utf8');
const edge=readFileSync(new URL('../supabase/functions/pictionary-game/index.ts',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/20261007214000_pictionary_latency_v2.sql',import.meta.url),'utf8');

test('pictionary v2 keeps high-frequency paths realtime and bounded',()=>{
  assert.match(app,/setTimeout\(\(\)=>flushStroke\(false\),14\)/);
  assert.match(app,/guess_pending/);
  assert.match(app,/setTimeout\(\(\)=>\{[\s\S]*optimistic&&current\.pending[\s\S]*\},2500\)/);
  assert.match(app,/attemptTransition\('finish_round'\)/);
  assert.match(app,/attemptTransition\('next_round'\)/);
});

test('round transitions use server authoritative state sync and warmup',()=>{
  assert.match(edge,/pictionary_emit_event_service/);
  assert.match(edge,/p_event:"state_sync"/);
  assert.match(edge,/EdgeRuntime/);
  assert.match(edge,/makeRound\(r,ps,Number\(r\.current_round_no\)\+1\)/);
  assert.match(edge,/Date\.now\(\)\+3200/);
  assert.match(edge,/makeRound\(updated,ps,next\)/);
});

test('authenticated peers can send optimistic guesses but cannot send state_sync',()=>{
  assert.match(migration,/'guess_pending'::text/);
  assert.doesNotMatch(migration,/event = any\([^)]*state_sync/s);
  assert.match(migration,/p_event <> 'state_sync'/);
  assert.match(migration,/grant execute[\s\S]*to service_role/);
});
