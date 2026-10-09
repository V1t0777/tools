import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const app=readFileSync(new URL('../pictionary/app.js',import.meta.url),'utf8');
const edge=readFileSync(new URL('../supabase/functions/pictionary-game/index.ts',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20261009144652_pictionary_authoritative_state_v3.sql',import.meta.url),'utf8');
test('one service-only RPC replaces scattered full-state reads',()=>{
 assert.match(edge,/pictionary_state_snapshot_v3/);
 assert.match(edge,/pictionary_identity_v3/);
 assert.doesNotMatch(edge,/client\.rpc\("toolbox_session_status"\)/);
 assert.match(sql,/security invoker/i);
 assert.match(sql,/revoke all on function public\.pictionary_state_snapshot_v3\(uuid,uuid\) from public,anon,authenticated/i);
 assert.match(sql,/grant execute on function public\.pictionary_state_snapshot_v3\(uuid,uuid\) to service_role/i);
 assert.match(sql,/where p\.room_id=p_room_id and p\.user_id=p_user_id and p\.active/i);
});
test('the server alone can reveal correct answers and drive summary transitions',()=>{
 assert.match(sql,/new\.status='summary'/);
 assert.match(sql,/'room_transition'/);
 assert.match(sql,/'revealed_answer',v_answer/);
 assert.match(sql,/v_room\.status in \('summary','finished'\)/);
 assert.match(edge,/p_event:"state_sync"/);
});
test('client reconciles a versioned state, not every 3s',()=>{
 assert.match(app,/setStatePoll\(healthy\?18000:1800\)/);
 assert.match(app,/receiveRoomTransition/);
 assert.match(app,/state_revision/);
 assert.doesNotMatch(app,/setStatePoll\(3000\)/);
});
