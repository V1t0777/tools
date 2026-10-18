import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, moveOrMerge, produce, fulfillOrder, advanceTime, validateSave,
  WIDTH, HEIGHT, CELL_COUNT, MAX_TIER, MAX_ENERGY, PRODUCER_CHARGES } from '../merge/engine.mjs';
import { loadLocal, saveLocal, SAVE_KEY } from '../merge/storage.mjs';
const start = () => createInitialState(1_000_000);

test('stable new game, 7x8 board and three production chains', () => {
  const s = start();
  assert.equal(s.board.length, WIDTH * HEIGHT);
  assert.equal(CELL_COUNT, 56);
  assert.equal(s.board.filter(i=>i?.kind === 'producer').length, 3);
  assert.equal(s.orders.length, 3);
  assert.equal(validateSave(s), true);
});

test('pure merge consumes exactly one item; moving & swapping preserve identities', () => {
  const before = start();
  const merged = moveOrMerge(before, 0, 1);
  assert.equal(merged.kind, 'merge');
  assert.equal(merged.state.board[0], null);
  assert.equal(merged.state.board[1].tier, 2);
  assert.equal(before.board[0].tier, 1);
  assert.equal(before.board[1].tier, 1);
  assert.equal(merged.state.revision, before.revision + 1);
  const moved = moveOrMerge(merged.state, 1, 2);
  assert.equal(moved.kind, 'move');
  const swapped = moveOrMerge(moved.state, 2, 3);
  assert.equal(swapped.kind, 'swap');
  assert.equal(new Set(swapped.state.board.filter(Boolean).map(i=>i.id)).size, swapped.state.board.filter(Boolean).length);
});

test('invalid action and max-tier merge cannot silently mutate', () => {
  const s = start();
  assert.equal(moveOrMerge(s, -1, 3).ok, false);
  assert.equal(moveOrMerge(s, 0, 0).ok, false);
  assert.equal(moveOrMerge(s, 5, 3).ok, false);
  const hi = structuredClone(s);
  hi.board[0].tier = MAX_TIER;
  hi.board[1].tier = MAX_TIER;
  const result = moveOrMerge(hi, 0, 1);
  assert.equal(result.ok, false);
  assert.equal(hi.board[0].tier, MAX_TIER);
});

test('production: energy, odds, nearby position, cooldown and refill', () => {
  let s = start();
  const before = s.board.filter(Boolean).length;
  const p = produce(s, 42, 1_000_000, ()=>0.9);
  assert.equal(p.kind, 'produce');
  assert.equal(p.state.energy, MAX_ENERGY-1);
  assert.equal(p.state.board[42].charges, PRODUCER_CHARGES-1);
  assert.equal(p.state.board.filter(Boolean).length, before+1);
  assert.equal(p.state.board.find(i=>i?.kind==='material'&&i.id===`m${s.nextId}`).tier, 2);
  assert.equal(s.energy, MAX_ENERGY);
  s = p.state;
  for(let i=1; i<PRODUCER_CHARGES; i++) {
    const r=produce(s, 42, 1_000_000, ()=>0.05);
    assert.equal(r.ok, true);
    s=r.state;
  }
  assert.equal(s.board[42].charges, 0);
  assert.equal(produce(s, 42, 1_000_001, ()=>0).ok, false);
  const later=advanceTime(s, 1_045_000);
  assert.equal(later.board[42].charges, PRODUCER_CHARGES);
});

test('production rejects a full board without spending energy', () => {
  const s=start();
  for(let i=0;i<CELL_COUNT;i++)if(!s.board[i])s.board[i]={id:`m${s.nextId++}`,kind:'material',chain:'tea',tier:1};
  const res=produce(s,42,1_000_000,()=>0);
  assert.equal(res.ok,false);
  assert.equal(res.state.energy,MAX_ENERGY);
});

test('energy restores with elapsed intervals',()=>{
  let s=start();
  s=produce(s,42,1_000_000,()=>0).state;
  assert.equal(advanceTime(s,1_180_000).energy,MAX_ENERGY);
});

test('order completion consumes matching item once and advances order',()=>{
  const s=start();
  const originalCount=s.board.filter(Boolean).length;
  const r=fulfillOrder(s,'o0');
  assert.equal(r.ok,true);
  assert.equal(r.state.board.filter(Boolean).length,originalCount-1);
  assert.equal(r.state.coins,12);
  assert.equal(r.state.xp,6);
  assert.equal(r.state.orders.length,3);
  assert.equal(fulfillOrder(r.state,'o0').ok,false);
});

test('save load roundtrip and corrupt-save isolation',()=>{
  const obj={};const local={getItem:k=>obj[k]??null,setItem:(k,v)=>{obj[k]=v}};
  const s=start();
  assert.equal(saveLocal(local,s),true);
  assert.equal(loadLocal(local).recovered,true);
  assert.deepEqual(loadLocal(local).state,s);
  obj[SAVE_KEY]='{garbage';
  assert.equal(loadLocal(local,1_000_000).recovered,false);
});

test('untrusted save rejects duplicate IDs, bad level, invalid shape and resource bounds',()=>{
  const s=start();
  const a=structuredClone(s);a.board[1].id=a.board[0].id;
  assert.equal(validateSave(a),false);
  const b=structuredClone(s);b.board[1].tier=999;
  assert.equal(validateSave(b),false);
  const c=structuredClone(s);c.energy=MAX_ENERGY+1;
  assert.equal(validateSave(c),false);
  const d=structuredClone(s);d.board.push(null);
  assert.equal(validateSave(d),false);
});

test('seeded pseudo-random long simulation preserves invariants',()=>{
  let state=start();let seed=71823;
  const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
  for(let tick=0;tick<3000;tick++){
    const action=Math.floor(rand()*4);
    let result;
    if(action===0)result=produce(state,[42,44,46][Math.floor(rand()*3)],1_000_000+tick*200_000,rand);
    else if(action===1)result=moveOrMerge(state,Math.floor(rand()*56),Math.floor(rand()*56));
    else if(action===2)result=fulfillOrder(state, state.orders[Math.floor(rand()*3)].id);
    else {state=advanceTime(state,1_000_000+tick*200_000);continue;}
    state=result.state;
    assert.equal(validateSave(state),true,`invalid at tick ${tick}`);
  }
});