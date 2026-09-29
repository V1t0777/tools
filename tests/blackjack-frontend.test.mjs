import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const app=readFileSync(new URL('../blackjack/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../blackjack/index.html',import.meta.url),'utf8');

test('blackjack frontend uses private realtime snapshots with database fallback',()=>{
  assert.match(app,/channel\(`blackjack:\$\{roomId\}`/);
  assert.match(app,/private:true/);
  assert.match(app,/event:'state_snapshot'/);
  assert.match(app,/setPollInterval\(isRealtimeHealthy\(\) \? 3500 : 1200\)/);
});

test('blackjack player actions use per-player one-time token rather than global room version',()=>{
  assert.match(app,/expected_token:myPlayer\(\)\?\.action_token/);
  assert.doesNotMatch(app,/expected_version/);
  assert.match(app,/action_id:makeId\(\)/);
});

test('blackjack renders untrusted values through DOM text APIs',()=>{
  assert.doesNotMatch(app,/innerHTML\s*=/);
  assert.match(app,/textContent/);
  assert.match(app,/replaceChildren/);
});

test('blackjack secure page uses local scripts and constrained CSP',()=>{
  assert.match(html,/\.\.\/shared\/toolbox-auth\.js/);
  assert.match(html,/\.\.\/shared\/vendor\/supabase-2\.57\.4\.min\.js/);
  assert.match(html,/Content-Security-Policy/);
  assert.match(html,/connect-src 'self' https:\/\/tmxpueakxibsaakdyusn\.supabase\.co wss:\/\/tmxpueakxibsaakdyusn\.supabase\.co/);
});
