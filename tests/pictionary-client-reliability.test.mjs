import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const app=readFileSync(new URL('../pictionary/app.js',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20261009143619_pictionary_no_unverified_guesses.sql',import.meta.url),'utf8');

test('private Realtime cannot publish unverified plaintext guesses',()=>{
  assert.doesNotMatch(app,/guess_pending|receiveGuessPending/);
  assert.doesNotMatch(sql,/event\s*=\s*'guess_pending'/);
  assert.match(sql,/drop policy if exists "pictionary members send realtime"/);
  assert.match(sql,/private\.is_pictionary_topic_drawer/);
  assert.match(sql,/realtime_token=gen_random_uuid\(\)/);
});

test('ordinary state refresh never resizes unchanged canvas or double-redraws',()=>{
  assert.match(app,/if\(canvas\.width===width&&canvas\.height===height\)return false;/);
  assert.match(app,/requestAnimationFrame\(\(\)=>resizeCanvas\(\)\)/);
  assert.doesNotMatch(app,/requestAnimationFrame\(\(\)=>\{resizeCanvas\(\);redraw\(\);\}\)/);
});
test('deltas have a bounded reorder window before authoritative repair',()=>{
  assert.match(app,/CANVAS_REORDER_WAIT_MS=140/);
  assert.match(app,/pendingCanvasDeltas\.size>=32/);
  assert.match(app,/queueCanvasDelta\('stroke',p\)/);
  assert.match(app,/snapshotBroadcastTimer/);
  assert.doesNotMatch(app,/if\(!replace\)sendSnapshot\(\)/);
});
test('connection and canvas health are separate, reconnect does not idle for 8 seconds',()=>{
  assert.match(app,/return isRealtimeHealthy\(\)&&drawStatus==='SUBSCRIBED'&&!canvasNeedsSync;/);
  assert.doesNotMatch(app,/scheduleReconnect\(8000\)/);
});
