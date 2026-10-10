import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const html=readFileSync(new URL('../blackjack/index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../blackjack/app.js',import.meta.url),'utf8');
const edge=readFileSync(new URL('../supabase/functions/blackjack-game/index.ts',import.meta.url),'utf8');
const css=readFileSync(new URL('../blackjack/style.css',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20261006160940_blackjack_v14_casino.sql',import.meta.url),'utf8');

test('blackjack V1.4 exposes casino betting and advanced rule controls',()=>{
  assert.doesNotThrow(()=>new Function(app));
  for(const id of [
    'bettingDock','chipRack','confirmBetBtn','insuranceDock',
    'doubleBtn','splitBtn','surrenderBtn','activeBet'
  ]) assert.match(html,new RegExp(`id="${id}"`));
  assert.match(html,/黑杰克 3:2/);
  assert.match(html,/庄家软 17 停牌/);
  assert.match(html,/延迟投降/);
});

test('blackjack V1.4 keeps chips match-local and server authoritative',()=>{
  assert.match(sql,/initial_stack numeric\(10,1\) not null default 1000/);
  assert.match(sql,/stack numeric\(10,1\) not null default 1000/);
  assert.match(sql,/create table if not exists private\.blackjack_hands/);
  assert.match(sql,/revoke all on private\.blackjack_hands from public,anon,authenticated/);
  assert.match(sql,/blackjack_bet_service/);
  assert.match(sql,/set stack=stack-p_amount/);
});

test('blackjack V1.4 supports Double Split Insurance and Late Surrender',()=>{
  assert.match(sql,/p_action not in \('hit','stand','double','split','surrender'\)/);
  assert.match(sql,/v_hand\.bet\*2/);
  assert.match(sql,/最多只能分成 4 手牌/);
  assert.match(sql,/insurance_bet\*3/);
  assert.match(sql,/status='surrender'/);
  assert.match(sql,/split_aces/);
});

test('blackjack V1.4 natural blackjack pays 3 to 2 and split blackjack does not',()=>{
  assert.match(sql,/v_hand\.status='blackjack' and not v_hand\.from_split/);
  assert.match(sql,/v_return:=v_hand\.bet\*2\.5/);
  assert.match(sql,/v_return:=v_hand\.bet\*2/);
});

test('blackjack V1.4 uses per-hand rotating action tokens and device control',()=>{
  assert.match(sql,/action_token uuid/);
  assert.match(sql,/blackjack_activate_player_hand/);
  assert.match(sql,/blackjack_casino_action_gateway_service/);
  assert.match(sql,/blackjack_assert_device/);
  assert.match(edge,/p_hand_id: handId/);
  assert.match(edge,/p_device_id: cleanDeviceId\(body\.device_id\)/);
});

test('blackjack V1.4 frontend composes bets locally and confirms once',()=>{
  // Inspect the chip-click handler rather than matching one implementation line
  // or accidentally matching a remote call elsewhere in the application.
  const chipHandler = app.match(
    /\$\('chipRack'\)\.addEventListener\(\s*'click'\s*,\s*\(event\)\s*=>\s*\{([\s\S]*?)^\s*\}\);/m
  )?.[1];
  assert.ok(chipHandler, 'chip-click handler must exist');
  assert.match(chipHandler,/setPendingBet\s*\(\s*pendingBet\s*\+\s*chip\s*,\s*false\s*\)/);
  assert.doesNotMatch(chipHandler,/\b(?:api|mutate)\s*\(/,
    'chip selection must not make a server request');
  assert.match(app,/mutate\(\s*'bet'\s*,\s*\{\s*amount\s*,\s*action_id\s*:\s*makeId\(\)\s*\}\s*\)/);
  assert.match(app,/mine\.bet_locked/);
});

test('blackjack V1.4 visuals use compositor-friendly animations and mobile degradation',()=>{
  assert.match(css,/@keyframes cardDealV14/);
  assert.match(css,/translate3d/);
  assert.match(css,/backdrop-filter:none!important/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(css,/contain:layout paint/);
  const motion=css.slice(css.indexOf('@keyframes cardDealV14'));
  assert.doesNotMatch(motion,/filter:blur\(/);
});

test('blackjack V1.4 public state exposes only dealer up-card before settlement',()=>{
  assert.match(sql,/jsonb_build_array\(v_room\.dealer_up_card,'BACK'\)/);
  assert.match(sql,/v_revealed:=v_room\.phase in \('settlement','finished'\)/);
});

test('blackjack V1.4 dashboard derives chip outcomes from private history',()=>{
  assert.match(sql,/'net_chips'/);
  assert.match(sql,/'doubles'/);
  assert.match(sql,/'split_hands'/);
  assert.match(sql,/'surrenders'/);
  assert.doesNotMatch(sql,/create table if not exists public\.blackjack/i);
});


test('blackjack V1.4 polish restores streak stats and keeps chip flight compositor-only',()=>{
  const polish=readFileSync(new URL('../supabase/migrations/20261006161905_blackjack_v14_stats_polish.sql',import.meta.url),'utf8');
  assert.match(polish,/blackjack_longest_win_streak/);
  assert.match(polish,/'longest_win_streak'/);
  assert.match(app,/function animateChipFlight\(button\)/);
  assert.match(app,/translate3d/);
  assert.match(css,/\.chip-flight/);
  assert.match(css,/will-change:transform,opacity/);
});


test('blackjack player-facing V1.4 casino copy is fully localized to Simplified Chinese',()=>{
  for(const legacy of [
    'PLACE YOUR BETS','TABLE CLOSED','CASINO TABLE','PLAYER ACTION','PAYOUT',
    'INSURANCE?','NO INSURANCE','DOUBLE DOWN…','BLACKJACK PAYS 3:2',
    '>DOUBLE<','>SPLIT<','>SURRENDER<','<small>BET</small>'
  ]) {
    assert.equal(html.includes(legacy) || app.includes(legacy) || css.includes(legacy),false,`player-facing English remains: ${legacy}`);
  }
  assert.match(html,/每场独立筹码/);
  assert.match(html,/是否购买保险？/);
  assert.match(html,/>加倍</);
  assert.match(html,/>分牌</);
  assert.match(html,/>投降</);
  assert.match(app,/betting:'请下注'/);
  assert.match(app,/insurance:'保险选择'/);
  assert.match(app,/player_action:'玩家操作'/);
  assert.match(app,/settlement:'本局结算'/);
  assert.match(css,/黑杰克赔付 3:2/);
});

test('blackjack V1.6.1 releases lobby controls after joining or creating a room',()=>{
  assert.match(app,/finally \{\s*busy = false;\s*if \(state\?\.room\.status === 'lobby'\) renderRoom\(\);\s*updateActions\(\);/);
  assert.match(app,/\$\('createBtn'\)\.disabled = false;\s*if \(state\?\.room\.status === 'lobby'\) renderRoom\(\);/);
  assert.match(app,/\$\('readyBtn'\)\.disabled = busy \|\| !mine/);
  assert.match(app,/void Promise\.allSettled\(\[claim,realtimeConnect\]\)/);
});

test('blackjack V1.6.1 gives explicit pending, success and uncertain-error feedback',()=>{
  assert.match(app,/正在准备…/);
  assert.match(app,/正在取消准备…/);
  assert.match(app,/正在开始游戏…/);
  assert.match(app,/准备成功，等待房主开始/);
  assert.match(app,/游戏已开始，正在发牌…/);
  assert.match(app,/操作状态未确认，正在重新同步/);
  assert.match(app,/requestState\(0,true\)/);
  assert.match(html,/id="lobbyHint" role="status" aria-live="polite"/);
  assert.match(html,/app\.js\?v=20261010-v173/);
});
