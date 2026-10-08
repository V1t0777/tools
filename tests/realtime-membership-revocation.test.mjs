import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const sql=readFileSync(new URL('../supabase/migrations/20261008013653_realtime_membership_channel_rotation.sql',import.meta.url),'utf8');
const pic=readFileSync(new URL('../pictionary/app.js',import.meta.url),'utf8');
const bj=readFileSync(new URL('../blackjack/app.js',import.meta.url),'utf8');
const picEdge=readFileSync(new URL('../supabase/functions/pictionary-game/index.ts',import.meta.url),'utf8');

test('room channels require fresh random tokens',()=>{
  for(const game of ['pictionary','blackjack']){
    assert.ok(sql.includes('ALTER TABLE public.'+game+'_rooms ADD COLUMN realtime_token uuid NOT NULL DEFAULT gen_random_uuid()'));
    assert.ok(sql.includes('ALTER TABLE public.'+game+'_rooms ADD COLUMN realtime_generation bigint NOT NULL DEFAULT 0'));
  }
  assert.match(sql,/CREATE OR REPLACE FUNCTION private\.is_pictionary_topic_drawer/);
  assert.match(sql,/CREATE OR REPLACE FUNCTION private\.is_pictionary_guess_sender/);
  assert.match(sql,/CREATE OR REPLACE FUNCTION public\.pictionary_emit_event_service/);
  assert.match(sql,/v_room\.realtime_token/);
  assert.match(sql,/v_room\.realtime_generation/);
  assert.doesNotMatch(sql,/GRANT EXECUTE.*rotate_room_realtime_topic.*authenticated/i);
});

test('membership and session revocations rekey all affected rooms',()=>{
  assert.match(sql,/AFTER UPDATE OF active OR DELETE ON public\.pictionary_players/);
  assert.match(sql,/AFTER UPDATE OF active OR DELETE ON public\.blackjack_players/);
  assert.match(sql,/BEFORE DELETE ON public\.members/);
  assert.match(sql,/AFTER DELETE ON auth\.sessions/);
  assert.match(sql,/realtime_generation=realtime_generation\+1/g);
  assert.match(sql,/realtime_token=gen_random_uuid\(\)/g);
  assert.match(sql,/realtime\.send\([\s\S]+?'channel_rotated'[\s\S]+?true/);
  assert.match(sql,/EXCEPTION WHEN OTHERS THEN[\s\S]+?RAISE WARNING/);
  assert.match(sql,/REVOKE ALL ON FUNCTION private\.rotate_room_realtime_topic/);
});

test('clients rebind using an authorized state snapshot, not a broadcast token',()=>{
  assert.match(picEdge,/realtime_token:r\.realtime_token,realtime_generation:r\.realtime_generation/);
  for(const src of [pic,bj]){
    assert.match(src,/realtime_token/);
    assert.match(src,/realtime_generation/);
    assert.match(src,/channel_rotated/);
    assert.match(src,/leaveRealtime\(false\)/);
    assert.match(src,/requestState\(0/);
  }
  assert.match(pic,/const topic=nonce\?/);
  assert.match(bj,/const topic = nonce \?/);
  assert.doesNotMatch(pic,/channel_rotated[^;]*new_token/);
  assert.doesNotMatch(bj,/channel_rotated[^;]*new_token/);
});

test('every authoritative game broadcast leaves legacy topics behind',()=>{
  for(const fn of [
    'private.blackjack_broadcast_state',
    'private.blackjack_emit_event',
    'public.pictionary_submit_guess_service',
    'public.pictionary_submit_guess_v2',
    'public.pictionary_emit_event_service'
  ]){
    const signature='CREATE OR REPLACE FUNCTION '+fn+'(';
    assert.ok(sql.includes(signature),'missing nonce migration of '+fn);
  }
  assert.match(sql,/state_snapshot','blackjack:'[\s\S]{0,160}realtime_token::text/);
  assert.match(sql,/game_event','blackjack:'[\s\S]{0,160}realtime_token::text/);
  assert.match(sql,/guess_result'[\s\S]{0,180}realtime_token::text/);
});

test('blackjack fences delayed connections after an access epoch changes',()=>{
  assert.match(bj,/let realtimeConnectEpoch = 0/);
  assert.match(bj,/generation !== realtimeConnectEpoch/);
  assert.match(bj,/function leaveRealtime\(stopPoll = true\) \{\s*realtimeConnectEpoch\+\+/);
});
