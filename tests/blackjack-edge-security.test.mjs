import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../supabase/functions/blackjack-game/index.ts',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20260929160000_blackjack_v1.sql',import.meta.url),'utf8');
const perf=readFileSync(new URL('../supabase/migrations/20261005220000_blackjack_performance_v11.sql',import.meta.url),'utf8');
const hardening=readFileSync(new URL('../supabase/migrations/20261005221500_blackjack_session_context_hardening.sql',import.meta.url),'utf8');

test('blackjack deck generation is server side and cryptographically sourced',()=>{
  assert.match(source,/function shuffledDeck\(\)/);
  assert.match(source,/crypto\.getRandomValues/);
  assert.doesNotMatch(source,/Math\.random\(\).*deck/);
});

test('blackjack edge uses one session context lookup and a rate-limited hot-path gateway',()=>{
  assert.match(source,/blackjack_session_context/);
  assert.doesNotMatch(source,/toolbox_session_status/);
  assert.match(source,/blackjack_casino_action_gateway_service/);
  assert.match(source,/\["hit", "stand", "double", "split", "surrender"\]/);
  assert.match(perf,/flappy_rate_limit_check/);
  assert.match(perf,/blackjack:\'\|\|p_action/);
});

test('blackjack hidden deck is private and browser roles have no table access',()=>{
  assert.match(sql,/create table if not exists private\.blackjack_secrets/);
  assert.match(sql,/alter table public\.blackjack_rooms enable row level security/);
  assert.match(sql,/revoke all on public\.blackjack_rooms from anon, authenticated/);
  assert.match(sql,/revoke all on private\.blackjack_secrets from public, anon, authenticated/);
});

test('blackjack authoritative snapshot is server broadcast and cannot be client-sent',()=>{
  assert.match(sql,/realtime\.send\(v_payload,'state_snapshot','blackjack:'/);
  const policy=sql.slice(sql.indexOf('create policy "blackjack members send realtime"'));
  assert.match(policy,/event in \('state_changed','ping','pong','emoji'\)/);
  assert.doesNotMatch(policy,/event in \([^)]*state_snapshot/);
});

test('blackjack session context keeps public RPC invoker-only',()=>{
  assert.match(hardening,/private\.blackjack_current_member_context\(\)/);
  assert.match(hardening,/security definer/);
  assert.match(hardening,/public\.blackjack_session_context\(\)[\s\S]*security invoker/);
  assert.match(hardening,/grant execute on function public\.blackjack_session_context\(\) to authenticated/);
});

test('blackjack V1.1 narrows action locks and keeps gateway server-only',()=>{
  assert.match(perf,/Lock only the acting player's row first/);
  assert.match(perf,/from private\.blackjack_secrets[\s\S]*for update/);
  assert.match(perf,/where id=p_room_id and status='playing' and phase='player_action'/);
  assert.match(perf,/revoke all on function public\.blackjack_action_gateway_service/);
  assert.match(perf,/grant execute on function public\.blackjack_action_gateway_service[\s\S]*service_role/);
});

test('blackjack actions use rotating token and service RPC is server-only',()=>{
  assert.match(sql,/action_token uuid/);
  assert.match(sql,/action_token=case when v_value<21 then gen_random_uuid\(\) else null end/);
  assert.match(sql,/v_player\.action_token is distinct from p_expected_token/);
  assert.match(sql,/revoke all on function public\.blackjack_action_service\(uuid,uuid,text,uuid,uuid\) from public,anon,authenticated/);
});
