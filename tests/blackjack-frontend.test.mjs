import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const app=readFileSync(new URL('../blackjack/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../blackjack/index.html',import.meta.url),'utf8');

test('blackjack frontend source parses as JavaScript',()=>{
  assert.doesNotThrow(()=>new Function(app));
});

test('blackjack frontend uses private realtime snapshots with database fallback',()=>{
  assert.match(app,/channel\(`blackjack:\$\{roomId\}`/);
  assert.match(app,/private:true/);
  assert.match(app,/event:'state_snapshot'/);
  assert.match(app,/HEALTHY_POLL_MS = 12000/);
  assert.match(app,/DEGRADED_POLL_MS = 1200/);
  assert.match(app,/PING_MS = 6000/);
});

test('blackjack hot table avoids full DOM rebuilds and uses adaptive clock ticks',()=>{
  assert.match(app,/playerSeatNodes = new Map\(\)/);
  assert.match(app,/current\?\.dataset\.code === desired\[i\]/);
  assert.match(app,/scheduleClockTick\(Math\.min\(decisionMs,summaryMs\) <= 3000 \? 250 : 1000\)/);
  assert.doesNotMatch(app,/playerTable'\)\.replaceChildren\(\);\n    for \(const player of state\.players\)/);
});

test('blackjack player actions use per-hand one-time token rather than global room version',()=>{
  assert.match(app,/expected_token:hand\.action_token/);
  assert.match(app,/hand_id:hand\.id/);
  assert.doesNotMatch(app,/expected_version/);
  assert.match(app,/action_id:makeId\(\)/);
});

test('blackjack renders untrusted values through DOM text APIs',()=>{
  assert.doesNotMatch(app,/innerHTML\s*=/);
  assert.match(app,/textContent/);
  assert.match(app,/replaceChildren/);
});

test('blackjack return links leave the secure mirror for the public games page',()=>{
  const target='https://v1t0777.github.io/tools/games/';
  assert.equal(html.split(target).length-1,2);
  assert.doesNotMatch(html,/href="\.\.\/games\/"/);
});
test('blackjack secure page uses local scripts and constrained CSP',()=>{
  assert.match(html,/\.\.\/shared\/toolbox-auth\.js/);
  assert.match(app,/\.\.\/shared\/vendor\/supabase-2\.57\.4\.min\.js/);
  assert.doesNotMatch(html,/shared\/vendor\/supabase-2\.57\.4\.min\.js/);
  assert.match(html,/Content-Security-Policy/);
  assert.match(html,/connect-src 'self' https:\/\/tmxpueakxibsaakdyusn\.supabase\.co wss:\/\/tmxpueakxibsaakdyusn\.supabase\.co/);
});
