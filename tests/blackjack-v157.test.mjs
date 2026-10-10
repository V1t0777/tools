import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const app=readFileSync(new URL('../blackjack/app.js',import.meta.url),'utf8');
const edge=readFileSync(new URL('../supabase/functions/blackjack-game/index.ts',import.meta.url),'utf8');
const html=readFileSync(new URL('../blackjack/index.html',import.meta.url),'utf8');

test('V1.5.7 pins database-heavy Edge calls to Singapore',()=>{
  assert.match(app,/forceFunctionRegion=ap-southeast-1/);
  assert.match(edge,/Access-Control-Max-Age": "86400"/);
});

test('V1.5.7 uses worker heartbeats and measures server RTT',()=>{
  assert.match(app,/worker:true/);
  assert.match(app,/heartbeatIntervalMs:15000/);
  assert.match(app,/status === 'sent'/);
  assert.match(app,/performance\.now\(\)-heartbeatSentAt/);
  assert.doesNotMatch(app,/event:'ping'/);
  assert.doesNotMatch(app,/event:'pong'/);
});

test('V1.5.7 reconnects softly before rebuilding the Realtime client',()=>{
  assert.match(app,/const RECONNECT_GRACE_MS = 5000/);
  assert.match(app,/realtime\.realtime\.connect\(\)/);
  assert.match(app,/reconnectAttempt === 0/);
  assert.match(app,/scheduleReconnect\(3500\)/);
  assert.match(app,/\['closed','abandoned'\]\.includes\(state\.room\.status\)/);
});

test('V1.5.7 preserves BFCache and resyncs on return',()=>{
  assert.match(app,/pagehide.*event\.persisted/s);
  assert.match(app,/pageshow.*event\.persisted/s);
  assert.match(app,/if \(!event\.persisted\) leaveRealtime\(\)/);
});

test('V1.5.7 backs off degraded polling and labels latency sources',()=>{
  assert.match(app,/DEGRADED_POLL_STEPS = \[\[5000,1500\],\[15000,2500\],\[Infinity,4000\]\]/);
  assert.match(app,/const network = Number\.isFinite\(realtimeRtt\) \? `实时 \$\{Math\.round\(realtimeRtt\)\}ms`/);
  assert.match(app,/const action = Number\.isFinite\(lastActionRtt\) \? `操作 \$\{lastActionRtt\}ms`/);
  assert.match(html,/app\.js\?v=20261010-v161/);
});
