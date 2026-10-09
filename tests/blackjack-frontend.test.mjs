import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const app=readFileSync(new URL('../blackjack/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../blackjack/index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../blackjack/style.css',import.meta.url),'utf8');

test('blackjack frontend source parses as JavaScript',()=>{
  assert.doesNotThrow(()=>new Function(app));
});

test('blackjack frontend uses private realtime snapshots with database fallback',()=>{
  assert.match(app,/channel\(topic,/);
  assert.match(app,/const topic = nonce \?/);
  assert.match(app,/blackjack:\$\{roomId\}:\$\{nonce\}/);
  assert.match(app,/private:\s*true/);
  assert.match(app,/event:\s*'state_snapshot'/);

  // Check bounded polling behavior, not the exact whitespace or one tuning value.
  const healthyPoll = app.match(/^\s*const\s+HEALTHY_POLL_MS\s*=\s*(\d+)\s*;/m);
  assert.ok(healthyPoll, 'healthy polling interval must be defined');
  const healthyInterval = Number(healthyPoll[1]);
  assert.ok(healthyInterval >= 12000 && healthyInterval <= 30000,
    'healthy polling must remain infrequent without eliminating recovery');

  const degradedPoll = app.match(/^\s*const\s+DEGRADED_POLL_STEPS\s*=\s*(\[\s*\[[^;\r\n]+\]\s*\])\s*;/m);
  assert.ok(degradedPoll, 'degraded polling schedule must be defined');
  const stages = JSON.parse(degradedPoll[1].replace(/\bInfinity\b/g,'null'));
  assert.deepEqual(stages.map(([threshold])=>threshold),[5000,15000,null],
    'degraded stages must progress from short reconnects to an unbounded fallback');
  assert.ok(stages.every(([,ms])=>Number.isInteger(ms) && ms >= 1000 && ms <= 5000),
    'degraded polling must remain bounded to 1–5 seconds');

  assert.match(app,/heartbeatIntervalMs\s*:\s*15000\b/);
  assert.match(app,/worker\s*:\s*true\b/);
});

test('blackjack hot table avoids full DOM rebuilds and uses adaptive clock ticks',()=>{
  assert.match(app,/playerSeatNodes = new Map\(\)/);
  assert.match(app,/current\?\.dataset\.code === desired\[i\]/);
  assert.match(app,/scheduleClockTick\(Math\.min\(decisionMs,summaryMs\) <= 3000 \? 250 : 1000\)/);
  assert.doesNotMatch(app,/playerTable'\)\.replaceChildren\(\);\n    for \(const player of state\.players\)/);
});

test('blackjack V1.6 keeps immersive presentation client-only and non-blocking',()=>{
  assert.match(html,/id="cardShoe"/);
  assert.match(html,/aria-label="半环形玩家座位"/);
  assert.match(app,/function seatSlot\(player\)/);
  assert.match(app,/seat-slot-self/);
  assert.match(app,/seat-slot-left/);
  assert.match(app,/seat-slot-right/);
  assert.match(app,/current\?\.dataset\.code === 'BACK'.*'flipped'/);
  assert.match(app,/animateChipTransfer\(fromRect,toRect,amount/);
  assert.match(app,/events\.push\(\{type:'stand'/);
  assert.match(app,/events\.push\(\{type:'bet'/);
  assert.match(css,/@keyframes cardDealV16/);
  assert.match(css,/@keyframes cardFlipV16/);
  assert.match(css,/\.seat-slot-self/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(css,/\.low-power \.card\.dealt/);
  assert.doesNotMatch(app,/await enqueuePresentation/,
    'presentation queue must never block authoritative state adoption or controls');
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
