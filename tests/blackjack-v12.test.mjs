import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const app=readFileSync(new URL('../blackjack/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../blackjack/index.html',import.meta.url),'utf8');
const edge=readFileSync(new URL('../supabase/functions/blackjack-game/index.ts',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20261006230000_blackjack_v12.sql',import.meta.url),'utf8');
const base=readFileSync(new URL('../supabase/migrations/20260929160000_blackjack_v1.sql',import.meta.url),'utf8');

test('blackjack V1.2 client parses and listens for authoritative game events',()=>{
  assert.doesNotThrow(()=>new Function(app));
  assert.match(app,/event:'game_event'/);
  assert.match(app,/function applyGameEvent\(event\)/);
  assert.match(app,/fromVersion !== currentVersion/);
  assert.match(app,/requestState\(0,true\)/);
});

test('blackjack V1.2 state refresh is single-flight',()=>{
  assert.match(app,/stateRefreshPromise/);
  assert.match(app,/refreshQueued = true/);
  assert.match(app,/stateRefreshPromise = \(async \(\) =>/);
});

test('blackjack V1.2 protects active play with device control',()=>{
  assert.match(html,/id="takeoverBtn"/);
  assert.match(app,/DEVICE_KEY = 'toolbox_blackjack_device_v12'/);
  assert.match(app,/api\('claim_device'/);
  assert.match(app,/deviceControl === 'PASSIVE'/);
  assert.match(edge,/claim_device: 30/);
  assert.match(edge,/p_device_id: cleanDeviceId\(body\.device_id\)/);
});

test('blackjack V1.2 stores events and leases only in private schema',()=>{
  assert.match(sql,/create table if not exists private\.blackjack_events/);
  assert.match(sql,/create table if not exists private\.blackjack_device_leases/);
  assert.match(sql,/revoke all on private\.blackjack_events from public,anon,authenticated/);
  assert.match(sql,/revoke all on private\.blackjack_device_leases from public,anon,authenticated/);
});

test('blackjack V1.2 events carry version ranges and are server broadcast only',()=>{
  assert.match(sql,/from_version/);
  assert.match(sql,/private\.blackjack_emit_event/);
  assert.match(sql,/realtime\.send\(v_payload,'game_event','blackjack:'/);
  const clientPolicy=base.slice(base.indexOf('create policy "blackjack members send realtime"'));
  assert.match(clientPolicy,/event in \('state_changed','ping','pong','emoji'\)/);
  assert.doesNotMatch(clientPolicy,/event in \([^)]*game_event/);
});

test('blackjack V1.2 gateway requires a device lease for hit and stand',()=>{
  assert.match(sql,/private\.blackjack_assert_device/);
  assert.match(sql,/errcode='P4091'/);
  assert.match(sql,/interval '75 seconds'/);
  assert.match(sql,/blackjack_action_gateway_service\([\s\S]*p_device_id uuid/);
  assert.match(sql,/perform private\.blackjack_assert_device\(p_room_id,p_user_id,p_device_id\)/);
});

test('blackjack V1.2 deal animation stays presentation-only',()=>{
  assert.match(app,/card\.classList\.add\('dealt'\)/);
  assert.match(app,/pendingGameAction === 'hit'/);
  assert.doesNotMatch(app,/optimistic.*hand_cards/i);
});
