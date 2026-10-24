import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState,advanceTime,ENERGY_REGEN_MS,MAX_ENERGY,PRODUCER_CHARGES,validateSave} from '../merge/engine.mjs';
import {isSafeSameRevisionClockUpdate as safe} from '../merge/storage-event-policy.mjs';
const now=1_000_000;
const initial=()=>createInitialState(now);
test('identical and formatting-only equal-revision snapshots are safe',()=>{
  const local=initial();
  assert.equal(safe(local,structuredClone(local)),true);
  assert.equal(safe(local,JSON.parse(JSON.stringify(local))),true);
});
test('same-revision clock regeneration may be adopted',()=>{
  const local={...initial(),energy:MAX_ENERGY-2};
  const advanced=advanceTime(local,now+ENERGY_REGEN_MS+1);
  assert.notEqual(advanced,local);
  assert.equal(advanced.revision,local.revision);
  assert.equal(validateSave(advanced),true);
  assert.equal(safe(local,advanced),true);
  assert.equal(safe(advanced,local),false,'stale clock progress must not roll back');
});
test('economic edits at identical revision are never silently adopted',()=>{
  const local=initial();
  const changes=[
    {...local,coins:local.coins+1},
    {...local,xp:local.xp+1},
    {...local,board:local.board.map((item,i)=>i===0?null:item)},
    {...local,orderIndex:local.orderIndex+1},
    {...local,nextId:local.nextId+1},
    {...local,revision:local.revision+1}
  ];
  for(const remote of changes)assert.equal(safe(local,remote),false);
});
test('clock rollback or spending without a revision is not a safe update',()=>{
  const local=initial();
  assert.equal(safe(local,{...local,energy:local.energy-1}),false);
  assert.equal(safe(local,{...local,energyAt:local.energyAt-1}),false);
});
test('producer cooldown can only move from exhausted to replenished',()=>{
  const local=initial();
  const index=local.board.findIndex(item=>item?.kind==='producer');
  assert.ok(index>=0);
  const board=local.board.map(item=>item?{...item}:item);
  board[index]={...board[index],charges:0,cooldownUntil:now+10};
  const exhausted={...local,board};
  const restored={...exhausted,board:board.map((item,i)=>i===index
    ?{...item,charges:PRODUCER_CHARGES,cooldownUntil:0}:item)};
  assert.equal(safe(exhausted,restored),true);
  assert.equal(safe(restored,exhausted),false);
  const suspicious={...exhausted,board:board.map((item,i)=>i===index
    ?{...item,charges:1,cooldownUntil:now+20}:item)};
  assert.equal(safe(exhausted,suspicious),false);
});
test('current storage listener blocks same-revision economic divergence without writes',()=>{
  const main=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
  const start=main.indexOf("window.addEventListener('storage', event => {");
  const end=main.indexOf('window.setInterval(() => {',start);
  assert.ok(start>=0&&end>start);
  const handler=main.slice(start,end);
  assert.ok(handler.includes('fresh.state.revision === state.revision'));
  assert.ok(handler.includes('!isSafeSameRevisionClockUpdate(state,fresh.state)'));
  assert.ok(handler.includes("saveIssue = 'CURRENT_SAVE_CHANGED'"));
  assert.ok(handler.indexOf('isSafeSameRevisionClockUpdate')<handler.indexOf('state = advanceTime(fresh.state)'));
  assert.equal(/\bpersist\s*\(/.test(handler.replace(/\/\/[^\n]*/g,'')),false);
  assert.equal(handler.includes('setItem('),false);
});

test('P2.30 energy gains require sufficient whole regeneration ticks',()=>{
  const local={...initial(),energy:MAX_ENERGY-4};
  assert.equal(safe(local,{...local,energy:local.energy+1}),false);
  assert.equal(safe(local,{...local,energy:local.energy+2,energyAt:now+ENERGY_REGEN_MS}),false);
  assert.equal(safe(local,{...local,energy:local.energy+1,energyAt:now+2*ENERGY_REGEN_MS}),false);
  assert.equal(safe(local,advanceTime(local,now+2*ENERGY_REGEN_MS+500)),true);
});
test('P2.30 refill must be due and restore exactly all charges',()=>{
  const local=initial();
  const slot=local.board.findIndex(item=>item?.kind==='producer');
  const board=local.board.map(item=>item?{...item}:item);
  board[slot]={...board[slot],charges:0,cooldownUntil:now+45_000};
  const exhausted={...local,board};
  const restored={...exhausted,board:board.map((item,i)=>i===slot
    ?{...item,charges:PRODUCER_CHARGES,cooldownUntil:0}:item)};
  const partial={...restored,board:restored.board.map((item,i)=>i===slot
    ?{...item,charges:PRODUCER_CHARGES-1}:item)};
  assert.equal(safe(exhausted,restored,now+44_999),false);
  assert.equal(safe(exhausted,restored,now+45_000),true);
  assert.equal(safe(exhausted,partial,now+45_000),false);
  assert.equal(safe(exhausted,exhausted,now),true);
});
test('P2.30 full energy clock marker cannot move without refill',()=>{
  const full=initial();
  assert.equal(safe(full,{...full,energyAt:now+ENERGY_REGEN_MS},now+ENERGY_REGEN_MS),false);
  const slot=full.board.findIndex(item=>item?.kind==='producer');
  const board=full.board.map(item=>item?{...item}:item);
  board[slot]={...board[slot],charges:0,cooldownUntil:now+45_000};
  const exhausted={...full,board};
  assert.equal(safe(exhausted,advanceTime(exhausted,now+ENERGY_REGEN_MS),
    now+ENERGY_REGEN_MS),true);
});
