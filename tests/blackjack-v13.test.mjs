import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const html=readFileSync(new URL('../blackjack/index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../blackjack/app.js',import.meta.url),'utf8');
const edge=readFileSync(new URL('../supabase/functions/blackjack-game/index.ts',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20261006233500_blackjack_v13_stats.sql',import.meta.url),'utf8');

test('blackjack V1.3 client parses and exposes personal statistics',()=>{
  assert.doesNotThrow(()=>new Function(app));
  for(const id of [
    'statsPanel','statMatches','statRounds','statWinRate','statBlackjacks',
    'statBustRate','statAvgStand','statStreak','statBestScore','recentForm'
  ]) assert.match(html,new RegExp(`id="${id}"`));
  assert.match(app,/api\('dashboard',\{limit:12\}\)/);
  assert.match(app,/function renderStats\(stats\)/);
  assert.doesNotMatch(app,/innerHTML\s*=/);
});

test('blackjack V1.3 dashboard is private and service-role only',()=>{
  assert.match(sql,/create or replace function private\.blackjack_dashboard/);
  assert.match(sql,/create or replace function public\.blackjack_dashboard_service/);
  assert.match(sql,/security invoker/);
  assert.match(sql,/revoke all on function public\.blackjack_dashboard_service\(uuid,integer\) from public,anon,authenticated/);
  assert.match(sql,/grant execute on function public\.blackjack_dashboard_service\(uuid,integer\) to service_role/);
});

test('blackjack V1.3 statistics stay inside the retained history window',()=>{
  assert.match(sql,/participant_user_ids @> array\[p_user_id\]/);
  assert.match(sql,/expires_at>now\(\)/);
  assert.match(sql,/'completed_matches'/);
  assert.match(sql,/'win_rate_pct'/);
  assert.match(sql,/'blackjacks'/);
  assert.match(sql,/'bust_rate_pct'/);
  assert.match(sql,/'avg_stand_value'/);
  assert.match(sql,/'best_match_score'/);
});

test('blackjack V1.3 computes streak and recent form without a new public table',()=>{
  assert.match(sql,/v_longest:=greatest\(v_longest,v_current\)/);
  assert.match(sql,/limit 10/);
  assert.match(sql,/'recent_rounds'/);
  assert.doesNotMatch(sql,/create table/i);
});

test('blackjack V1.3 Edge Function returns dashboard in one request',()=>{
  assert.match(edge,/dashboard: 30/);
  assert.match(edge,/action === "dashboard"/);
  assert.match(edge,/blackjack_dashboard_service/);
  assert.match(edge,/history: Array\.isArray\(dashboard\?\.history\)/);
  assert.match(edge,/stats: dashboard\?\.stats/);
});

test('blackjack V1.3 UI presents trends as non-competitive personal feedback',()=>{
  assert.match(html,/近 180 天 · 仅你本人可见/);
  assert.match(html,/轻量统计/);
  assert.match(app,/完成一局后，这里会显示最近表现/);
  assert.match(app,/胜 .*和 .*负 .*净积分/);
});
