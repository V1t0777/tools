import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const app=readFileSync(new URL('../blackjack/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../blackjack/index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../blackjack/style.css',import.meta.url),'utf8');

test('V1.7.3 renders a localized, avatar-free 2.5D table without changing backend',()=>{
  assert.doesNotThrow(()=>new Function(app));
  assert.match(html,/id="casinoStage" aria-label="翡翠绿立体赌场牌桌"/);
  assert.match(html,/class="table-brass-track"/);
  assert.match(html,/class="table-felt-mark"/);
  assert.match(html,/私人 21 点/);
  assert.match(html,/id="cardShoe"/);
  assert.match(html,/id="playerTable" aria-label="半环形玩家座位"/);
  assert.doesNotMatch(html,/<canvas\b|<iframe\b|three\.js|babylon/i);
  assert.match(css,/\.casino-stage::before/);
  assert.match(css,/--casino-walnut:/);
  assert.match(css,/--casino-emerald:/);
  assert.match(css,/--casino-champagne:/);
  assert.match(css,/@media\(orientation:landscape\) and \(max-height:560px\)/);
  assert.match(css,/@media\(max-width:620px\)/);
});

test('V1.7.3 keeps cards authoritative and flights bounded, cancellable and visual-only',()=>{
  assert.match(app,/function animateDealFlight\(card,index = 0\)/);
  assert.match(app,/activeDealFlights\.size >= DEAL_FLIGHT_MAX/);
  assert.match(app,/DEAL_FLIGHT_MAX = 5/);
  assert.match(app,/clone\.setAttribute\('aria-hidden','true'\)/);
  assert.match(app,/card\.style\.opacity = '0'/);
  assert.match(app,/animation\.finished\.then\(finish,finish\)/);
  assert.match(app,/for \(const finish of \[\.\.\.activeDealFlights\]\) finish\(\)/);
  assert.match(app,/if \(current\) current\.replaceWith\(card\);\s*else container\.append\(card\);/);
  assert.match(app,/!animateDealFlight\(card,i\)/);
  assert.match(css,/\.flying-card/);
  assert.match(css,/\.low-power \.flying-card/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)\{\.flying-card/);
  assert.doesNotMatch(app,/await animateDealFlight/);
});

test('V1.7.3 offers a persisted, reversible iPhone immersive mode',()=>{
  assert.match(html,/id="immersiveBtn" type="button" aria-pressed="false"/);
  assert.match(app,/IMMERSIVE_KEY = 'toolbox_blackjack_immersive_v173'/);
  assert.match(app,/localStorage\.setItem\(IMMERSIVE_KEY/);
  assert.match(app,/\$\('immersiveBtn'\)\.onclick = toggleImmersive/);
  assert.match(app,/classList\.toggle\('immersive-mode',immersiveMode && id === 'gameScreen'\)/);
  assert.match(app,/id !== 'gameScreen'/);
  assert.match(css,/\.immersive-mode #gameScreen/);
  assert.match(css,/env\(safe-area-inset-bottom\)/);
});

test('V1.7.3 renders visible wager chips without affecting game economics',()=>{
  assert.match(app,/betStack\.className = 'bet-stack hidden'/);
  assert.match(app,/betSpot\.append\(betStack,betAmount\)/);
  assert.match(app,/node\.betStack\.classList\.toggle\('hidden',!hasBet\)/);
  assert.match(css,/\.bet-stack::after/);
  assert.match(app,/mutate\('bet',\{amount,action_id:makeId\(\)\}\)/);
});

test('V1.7.3 generates finite cached material audio without external assets',()=>{
  const start=app.indexOf('  function materialSound(ctx,kind) {');
  const end=app.indexOf('  function playSound(kind,memberId = null) {',start);
  assert.ok(start>0 && end>start,'materialSound must be a standalone pure audio helper');
  const cache=new Map();
  const materialSound=new Function('soundSamples',app.slice(start,end)+'\nreturn materialSound;')(cache);
  const ctx={
    sampleRate:24000,
    createBuffer(channels,length,sampleRate){
      assert.equal(channels,1);
      assert.equal(sampleRate,this.sampleRate);
      const samples=new Float32Array(length);
      return {getChannelData(index){assert.equal(index,0);return samples;}};
    },
  };
  for(const kind of ['chip','card','flip','blackjack','win','loss']){
    const buffer=materialSound(ctx,kind);
    const samples=buffer.getChannelData(0);
    assert.ok(samples.length>1000 && samples.length<7000,kind);
    assert.ok(samples.some(v=>Math.abs(v)>0.001),kind);
    assert.ok(samples.every(v=>Number.isFinite(v) && Math.abs(v)<=1),kind);
    assert.strictEqual(materialSound(ctx,kind),buffer,'sample must be cached');
  }
  assert.match(app,/typeof ctx\.createStereoPanner === 'function'/);
  assert.doesNotMatch(html,/<audio\b/i);
  assert.doesNotMatch(app,/fetch\([^)]*\.(?:mp3|wav|ogg)/i);
});

test('V1.7.3 does not introduce continuous render loops or server schema changes',()=>{
  const v173=css.slice(css.indexOf('V1.7.3 | Emerald'));
  assert.doesNotMatch(v173,/animation:[^;]*infinite/i);
  assert.doesNotMatch(app,/requestAnimationFrame\([^)]*=>\s*requestAnimationFrame/s);
  assert.match(app,/forceFunctionRegion=ap-southeast-1/);
  assert.match(app,/worker:true/);
  assert.match(app,/heartbeatIntervalMs:15000/);
  assert.match(html,/style\.css\?v=20261010-v173/);
  assert.match(html,/app\.js\?v=20261010-v173/);
});
