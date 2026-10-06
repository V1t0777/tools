import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const html=readFileSync(new URL('../blackjack/index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../blackjack/app.js',import.meta.url),'utf8');
const edge=readFileSync(new URL('../supabase/functions/blackjack-game/index.ts',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20261006201500_blackjack_history_cleanup.sql',import.meta.url),'utf8');

test('blackjack home exposes recent match history without unsafe HTML rendering',()=>{
  assert.match(html,/id="historyPanel"/);
  assert.match(html,/id="historyList"/);
  assert.match(html,/对局记录保留 180 天/);
  assert.match(app,/api\('dashboard',\{limit:12\}\)/);
  assert.match(app,/function renderHistory\(records\)/);
  assert.doesNotMatch(app,/innerHTML\s*=/);
});

test('blackjack history is private and queried only through server RPC',()=>{
  assert.match(sql,/create table if not exists private\.blackjack_match_history/);
  assert.match(sql,/revoke all on private\.blackjack_match_history from public,anon,authenticated/);
  assert.match(sql,/public\.blackjack_history_service/);
  assert.match(sql,/grant execute on function public\.blackjack_history_service\(uuid,integer\) to service_role/);
  assert.match(edge,/blackjack_history_service/);
  assert.match(edge,/history: 30/);
});

test('blackjack records each settled round and finalizes completed matches',()=>{
  assert.match(sql,/blackjack_record_round_locked/);
  assert.match(sql,/perform private\.blackjack_record_round_locked\(p_room_id\)/);
  assert.match(sql,/perform private\.blackjack_finalize_match\(p_room_id,'finished'\)/);
  assert.match(sql,/add column if not exists match_id uuid/);
});

test('blackjack cleanup keeps summaries longer than transient rooms',()=>{
  assert.match(sql,/interval '24 hours'/);
  assert.match(sql,/interval '180 days'/);
  assert.match(sql,/create or replace function private\.blackjack_cleanup\(\)/);
  assert.match(sql,/cron\.schedule\([\s\S]*'blackjack-daily-cleanup'[\s\S]*'30 18 \* \* \*'/);
  assert.match(sql,/cron\.job_run_details/);
});

test('interrupted games are finalized by the Edge Function',()=>{
  assert.match(edge,/blackjack_finalize_match_service/);
  assert.match(edge,/p_status: "abandoned"/);
  assert.match(edge,/p_status: room\.status === "playing" \? "closed" : "finished"/);
});
