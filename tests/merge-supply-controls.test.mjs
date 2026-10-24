import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState,validateSave} from '../merge/engine.mjs';
import {getSupplyControlSnapshot} from '../merge/supply-controls.mjs';

const now=1_000_000;
function sandbox(){
  const state=createInitialState(now);
  for(const id of ['soda','meal','speed','reset']){
    state.shop.purchases[id]=1;
    state.bag[id]=1;
  }
  assert.equal(validateSave(state),true);
  return state;
}

test('P2.10 switching to a cooling producer enables only relevant stocked cards immediately',()=>{
  const s=sandbox();
  s.board[44].charges=0;s.board[44].cooldownUntil=now+40_000;
  const ready=getSupplyControlSnapshot(s,s.board[42].id,now);
  assert.equal(ready.producerId,s.board[42].id);
  assert.equal(ready.cooling,false);
  assert.equal(ready.usable.speed,false);
  assert.equal(ready.usable.reset,false);
  const chosen=getSupplyControlSnapshot(s,s.board[44].id,now);
  assert.equal(chosen.producerId,s.board[44].id);
  assert.equal(chosen.cooling,true);
  assert.equal(chosen.remainingSeconds,40);
  assert.equal(chosen.usable.speed,true);
  assert.equal(chosen.usable.reset,true);
  assert.equal(chosen.usable.soda,false);
});

test('P2.10 countdown advances on read-only ticks without refreshing unrelated state',()=>{
  const s=sandbox();
  s.board[44].charges=0;s.board[44].cooldownUntil=now+40_000;
  const before=structuredClone(s);
  const a=getSupplyControlSnapshot(s,s.board[44].id,now);
  const b=getSupplyControlSnapshot(s,s.board[44].id,now+1000);
  const c=getSupplyControlSnapshot(s,s.board[44].id,now+39_999);
  const expired=getSupplyControlSnapshot(s,s.board[44].id,now+40_000);
  assert.equal(a.remainingSeconds,40);
  assert.equal(b.remainingSeconds,39);
  assert.equal(c.remainingSeconds,1);
  assert.equal(expired.remainingSeconds,0);
  assert.equal(expired.cooling,false);
  assert.equal(expired.usable.speed,false);
  assert.equal(expired.usable.reset,false);
  assert.deepEqual(s,before);
});

test('P2.10 selecting a noncooling producer never consumes the only cooldown card',()=>{
  const s=sandbox();
  s.board[44].charges=0;s.board[44].cooldownUntil=now+45_000;
  const selected=getSupplyControlSnapshot(s,s.board[46].id,now);
  assert.equal(selected.cooling,false);
  assert.equal(selected.usable.speed,false);
  assert.equal(s.bag.speed,1);
  const valid=getSupplyControlSnapshot(s,s.board[44].id,now);
  assert.equal(valid.usable.speed,true);
});

test('P2.10 energy supplies are allowed only when below the new maximum',()=>{
  const s=sandbox();
  assert.equal(getSupplyControlSnapshot(s,s.board[42].id,now).usable.soda,false);
  assert.equal(getSupplyControlSnapshot(s,s.board[42].id,now).usable.meal,false);
  s.energy=119;
  const below=getSupplyControlSnapshot(s,s.board[42].id,now);
  assert.equal(below.usable.soda,true);
  assert.equal(below.usable.meal,true);
  assert.equal(below.usable.speed,false);
  assert.equal(validateSave(s),true);
});

test('P2.10 no inventory prevents use even if target is cooling or energy is low',()=>{
  const s=createInitialState(now);
  s.energy=0;
  s.board[44].charges=0;s.board[44].cooldownUntil=now+45000;
  const snap=getSupplyControlSnapshot(s,s.board[44].id,now);
  assert.deepEqual(Object.values(snap.usable),[false,false,false,false]);
  assert.equal(validateSave(s),true);
});

test('P2.10 invalid or removed producer selection falls back to a real producer',()=>{
  const s=sandbox();
  const fallback=getSupplyControlSnapshot(s,'deleted-or-unknown',now);
  assert.equal(fallback.producerId,s.board[42].id);
  assert.equal(fallback.options.length,3);
  assert.equal(new Set(fallback.options.map(x=>x.id)).size,3);
  assert.equal(fallback.producerName,'茶饮工坊');
});

test('P2.10 snapshot rejects non-finite clocks and returns immutable descriptors',()=>{
  const s=sandbox();
  for(const clock of [NaN,Infinity,-1])
    assert.throws(()=>getSupplyControlSnapshot(s,s.board[42].id,clock),/Invalid supply UI time/);
  const snap=getSupplyControlSnapshot(s,s.board[42].id,now);
  assert.ok(Object.isFrozen(snap));
  assert.ok(Object.isFrozen(snap.options));
  assert.ok(Object.isFrozen(snap.usable));
  assert.ok(Object.isFrozen(snap.options[0]));
});

test('P2.10 UI reacts to selection changes and timer ticks without rebuilding all supply cards',()=>{
  const source=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
  const html=readFileSync(new URL('../merge/index.html',import.meta.url),'utf8');
  assert.ok(source.includes("getSupplyControlSnapshot(state,select.value,now)"));
  assert.ok(source.includes("'change',()=>refreshSupplyControls()"));
  assert.ok(source.includes("else {renderResources(now);refreshSupplyControls(now);}"));
  assert.ok(source.includes("if(!sameOptions)"));
  assert.equal(source.split('select.replaceChildren(fragment)').length-1,1);
  assert.ok(source.includes('button.dataset.supplyUse=id'));
  assert.ok(source.includes('if(button)button.disabled=!usable'));
  assert.ok(html.includes('aria-describedby="supply-cooldown-status"'));
  assert.ok(html.includes('id="supply-cooldown-status" aria-live="off"'));
});
