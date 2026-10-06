import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const html=readFileSync(new URL('../blackjack/index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../blackjack/app.js',import.meta.url),'utf8');
const edge=readFileSync(new URL('../supabase/functions/blackjack-game/index.ts',import.meta.url),'utf8');
const css=readFileSync(new URL('../blackjack/style.css',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20261007003000_blackjack_v14_casino.sql',import.meta.url),'utf8');

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
  assert.match(app,/pendingBet \+= chip/);
  assert.match(app,/mutate\('bet',\{amount,action_id:makeId\(\)\}\)/);
  assert.match(app,/mine\.bet_locked/);
  assert.doesNotMatch(app,/api\('bet'.*data-chip/s);
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
  const polish=readFileSync(new URL('../supabase/migrations/20261007005500_blackjack_v14_stats_polish.sql',import.meta.url),'utf8');
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
