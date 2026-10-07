import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const html=readFileSync(new URL('../blackjack/index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../blackjack/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../blackjack/style.css',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20261007003000_blackjack_v14_casino.sql',import.meta.url),'utf8');

test('V1.5.1 quick bets stay client-side until one confirmed wager',()=>{
  assert.match(html,/id="repeatBetBtn"/);
  assert.match(html,/id="halfBetBtn"/);
  assert.match(html,/id="doubleBetBtn"/);
  assert.match(app,/lastConfirmedBet/);
  assert.match(app,/setPendingBet\(pendingBet\/2\)/);
  assert.match(app,/setPendingBet\(pendingBet\*2\)/);
  assert.match(app,/mutate\('bet',\{amount,action_id:makeId\(\)\}\)/);
  assert.doesNotMatch(app,/api\(['"]bet['"].*repeatBetBtn/s);
});

test('V1.5.2 presentation queue never delays authoritative state adoption',()=>{
  const adopt=app.slice(app.indexOf('function adoptState'),app.indexOf('async function initialize'));
  assert.match(adopt,/const presentation = derivePresentation\(previous,next\)/);
  assert.ok(adopt.indexOf('state = next') < adopt.indexOf('enqueuePresentation(presentation)'));
  assert.match(app,/const PRESENTATION_MAX = 8/);
  assert.match(app,/cancelPresentation\(\)/);
  assert.match(app,/if \(suspended\) cancelPresentation\(\)/);
  assert.match(app,/requestState\(0,true\)/);
});

test('V1.5.3 sound and haptics are local-only and user controllable',()=>{
  assert.match(html,/id="soundBtn"/);
  assert.match(app,/toolbox_blackjack_sound_v15/);
  assert.match(app,/AudioContext \|\| window\.webkitAudioContext/);
  assert.match(app,/navigator\.vibrate/);
  assert.match(app,/localStorage\.setItem\(SOUND_KEY/);
  assert.doesNotMatch(html,/<audio\b/i);
  assert.doesNotMatch(app,/fetch\([^)]*\.(mp3|wav|ogg)/i);
});

test('V1.5.4 table reactions reuse Realtime Broadcast without database writes',()=>{
  assert.match(app,/channel\.on\('broadcast',\{event:'emoji'\}/);
  assert.match(app,/sendEvent\('emoji'/);
  assert.match(app,/showReaction\(emoji,memberId\)/);
  assert.match(app,/now-lastReactionAt < 650/);
  assert.doesNotMatch(app,/api\(['"]emoji['"]/);
  assert.match(css,/\.table-reaction/);
});

test('V1.5.5 equal money is the existing insurance decision for natural blackjack',()=>{
  assert.match(app,/candidate\.status === 'blackjack' && !candidate\.from_split/);
  assert.match(app,/锁定等额收益/);
  assert.match(app,/继续等待 3:2/);
  assert.match(app,/mutate\('insurance',\{take:true,action_id:makeId\(\)\}\)/);
  assert.match(sql,/v_hand\.status='blackjack' and not v_hand\.from_split/);
  assert.match(sql,/v_return:=v_hand\.bet\*2\.5/);
  assert.match(sql,/insurance_bet\*3/);

  const bet=100;
  const insurance=bet/2;
  const noDealerBlackjack=-bet-insurance+bet*2.5;
  const dealerBlackjack=-bet-insurance+bet+insurance*3;
  assert.equal(noDealerBlackjack,bet);
  assert.equal(dealerBlackjack,bet);
});

test('V1.5.5 keeps the advanced-rule edge-case matrix intact',()=>{
  assert.match(sql,/p_action not in \('hit','stand','double','split','surrender'\)/);
  assert.match(sql,/最多只能分成 4 手牌/);
  assert.match(sql,/split_aces/);
  assert.match(sql,/status='surrender'/);
  assert.match(sql,/v_hand\.bet\*2/);
});

test('V1.5.6 mobile motion is bounded and compositor-oriented',()=>{
  const v15=css.slice(css.indexOf('Blackjack V1.5.1'));
  assert.match(v15,/content-visibility:auto/);
  assert.match(v15,/contain:layout paint/);
  assert.match(v15,/prefers-reduced-motion:reduce/);
  assert.match(app,/animationend.*remove\('dealt'\)/s);
  assert.match(app,/presentationQueue\.length > PRESENTATION_MAX/);
  assert.doesNotMatch(v15,/animation:[^;]*(infinite)/i);
  assert.doesNotMatch(v15,/filter:(?:blur|brightness)\(/i);
  assert.doesNotMatch(app,/requestAnimationFrame\([^)]*=>\s*requestAnimationFrame/s);
  assert.doesNotMatch(html,/<canvas\b/i);
});

test('V1.5 keeps server-authoritative gameplay and snapshot recovery',()=>{
  assert.match(app,/applyGameEvent\(event\)/);
  assert.match(app,/fromVersion !== currentVersion/);
  assert.match(app,/requestState\(0,true\)/);
  assert.match(app,/blackjack_casino_action_gateway_service|casinoAction\('hit'\)/);
});
