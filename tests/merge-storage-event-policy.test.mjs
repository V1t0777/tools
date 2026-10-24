import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
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
  assert.ok(handler.indexOf('isSafeSameRevisionClockUpdate')<handler.indexOf('state = fresh.state;'));
  assert.equal(handler.includes('advanceTime(fresh.state)'),false);
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

test('P2.31 future-dated energyAt cannot grant cross-tab energy early',()=>{
  const local={...initial(),energy:MAX_ENERGY-4};
  const future=advanceTime(local,now+2*ENERGY_REGEN_MS);
  assert.equal(future.energy,local.energy+2);
  assert.equal(safe(local,future,now+ENERGY_REGEN_MS),false);
  assert.equal(safe(local,future,now+2*ENERGY_REGEN_MS),true);
  // A baseline already dated in the future must not block an identical save.
  const futureBaseline={...initial(),energyAt:now+2*ENERGY_REGEN_MS};
  assert.equal(safe(futureBaseline,structuredClone(futureBaseline),now),true);
});
test('P2.31 future clock marker cannot piggyback on a due producer refill',()=>{
  const base=initial();
  const index=base.board.findIndex(item=>item?.kind==='producer');
  const board=base.board.map(item=>item?{...item}:item);
  board[index]={...board[index],charges:0,cooldownUntil:now+45_000};
  const exhausted={...base,board};
  const restored=advanceTime(exhausted,now+2*ENERGY_REGEN_MS);
  assert.equal(restored.board[index].charges,PRODUCER_CHARGES);
  assert.equal(safe(exhausted,restored,now+ENERGY_REGEN_MS),false);
  assert.equal(safe(exhausted,restored,now+2*ENERGY_REGEN_MS),true);
});

test('P2.32 storage listener adopts remote bytes without inventing unpersisted clock gains',()=>{
  const main=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
  const start=main.indexOf("window.addEventListener('storage', event => {");
  const end=main.indexOf('window.setInterval(() => {',start);
  assert.ok(start>=0&&end>start);
  const handler=main.slice(start,end);
  const saveKey='toolbox.merge-isle.local.v1';
  const old=createInitialState(now);
  const local={...old,energy:MAX_ENERGY-2};
  const remote=advanceTime(local,now+ENERGY_REGEN_MS);
  assert.notEqual(remote,local);
  assert.ok(remote.energy>local.energy);
  for(const [label,from,to] of [
    ['higher revision',local,{...local,revision:local.revision+1}],
    ['equal revision clock',local,remote]
  ]) {
    const fresh={ok:true,state:to,raw:JSON.stringify(to)};
    const status={textContent:''};
    const ctx={
      window:{addEventListener(type,fn){if(type==='storage')this.onStorage=fn;}},
      SAVE_KEY:saveKey,store:{},peekLocalV3(){return fresh;},
      isSafeSameRevisionClockUpdate(){return true;},
      advanceTime(){throw Error('unverified time advance: '+label);},
      state:from,persistedRaw:JSON.stringify(from),saveIssue:null,
      selected:3,activeGuidance:{boardSlots:[]},
      byId(id){assert.equal(id,'save-status');return status;},
      render(){},hint(){}
    };
    runInNewContext(handler,ctx);
    ctx.window.onStorage({storageArea:ctx.store,key:saveKey});
    assert.equal(JSON.stringify(ctx.state),fresh.raw,label);
    assert.equal(ctx.persistedRaw,fresh.raw,label);
    assert.equal(ctx.selected,-1);
    assert.equal(ctx.activeGuidance,null);
    assert.match(status.textContent,/已同步其他标签页进度/);
  }
});

test('P2.38 localStorage.clear event immediately blocks a removed normal save',()=>{
  const main=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
  const start=main.indexOf("window.addEventListener('storage', event => {");
  const end=main.indexOf('window.setInterval(() => {',start);
  assert.ok(start>=0&&end>start);
  const handler=main.slice(start,end);
  const saveKey='toolbox.merge-isle.local.v1';
  const current=initial(),raw=JSON.stringify(current);
  const status={textContent:''},messages=[];
  let reads=0,rendered=0;
  const ctx={
    window:{addEventListener(type,fn){if(type==='storage')this.onStorage=fn;}},
    SAVE_KEY:saveKey,store:{},state:current,persistedRaw:raw,
    saveIssue:null,selected:1,activeGuidance:null,
    peekLocalV3(){reads++;return {ok:false,reason:'SAVE_REMOVED'};},
    byId(id){assert.equal(id,'save-status');return status;},
    render(){rendered++;},hint(message){messages.push(message);}
  };
  runInNewContext(handler,ctx);
  ctx.window.onStorage({storageArea:ctx.store,key:'unrelated.setting'});
  assert.equal(reads,0,'unrelated key must not cause save inspection');
  ctx.window.onStorage({storageArea:ctx.store,key:null});
  assert.equal(reads,1,'clear must inspect actual normal save');
  assert.equal(ctx.saveIssue,'SAVE_REMOVED');
  assert.equal(ctx.persistedRaw,raw);
  assert.equal(ctx.state,current);
  assert.equal(rendered,0);
  assert.match(status.textContent,/已暂停同步/);
  assert.equal(messages.length,1);
  assert.match(messages[0],/跨标签存档发生变化/);
});

test('P2.38 clear event that leaves normal save unchanged does not interrupt play',()=>{
  const main=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
  const start=main.indexOf("window.addEventListener('storage', event => {");
  const end=main.indexOf('window.setInterval(() => {',start);
  assert.ok(start>=0&&end>start);
  const handler=main.slice(start,end);
  const saveKey='toolbox.merge-isle.local.v1';
  const current=initial(),raw=JSON.stringify(current);
  const status={textContent:'已保存'};
  let reads=0,rendered=0,hints=0;
  const ctx={
    window:{addEventListener(type,fn){if(type==='storage')this.onStorage=fn;}},
    SAVE_KEY:saveKey,store:{},state:current,persistedRaw:raw,
    saveIssue:null,selected:1,activeGuidance:null,
    peekLocalV3(){reads++;return {ok:true,state:current,raw};},
    byId(id){assert.equal(id,'save-status');return status;},
    render(){rendered++;},hint(){hints++;}
  };
  runInNewContext(handler,ctx);
  ctx.window.onStorage({storageArea:ctx.store,key:null});
  assert.equal(reads,1);
  assert.equal(ctx.saveIssue,null);
  assert.equal(ctx.selected,1);
  assert.equal(rendered,0);
  assert.equal(hints,0);
  assert.equal(status.textContent,'已保存');
});

test('P2.39 ignores same-key and clear events from other storage areas',()=>{
  const main=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
  const start=main.indexOf("window.addEventListener('storage', event => {");
  const end=main.indexOf('window.setInterval(() => {',start);
  assert.ok(start>=0&&end>start);
  const handler=main.slice(start,end);
  const current=initial(),raw=JSON.stringify(current);
  const status={textContent:'已保存'},localArea={},sessionArea={};
  let reads=0,hints=0,renders=0;
  const ctx={
    window:{addEventListener(type,fn){if(type==='storage')this.onStorage=fn;}},
    SAVE_KEY:'toolbox.merge-isle.local.v1',store:localArea,
    state:current,persistedRaw:raw,saveIssue:null,selected:1,activeGuidance:null,
    peekLocalV3(){reads++;return {ok:false,reason:'SAVE_REMOVED'};},
    byId(id){assert.equal(id,'save-status');return status;},
    hint(){hints++;},render(){renders++;}
  };
  runInNewContext(handler,ctx);
  ctx.window.onStorage({storageArea:sessionArea,key:ctx.SAVE_KEY});
  ctx.window.onStorage({storageArea:sessionArea,key:null});
  ctx.window.onStorage({storageArea:undefined,key:ctx.SAVE_KEY});
  assert.equal(reads,0,'foreign or unknown storage area must not inspect save');
  assert.equal(ctx.saveIssue,null);
  assert.equal(ctx.state,current);
  assert.equal(ctx.persistedRaw,raw);
  assert.equal(ctx.selected,1);
  assert.equal(status.textContent,'已保存');
  assert.equal(hints,0);
  assert.equal(renders,0);
  ctx.window.onStorage({storageArea:localArea,key:ctx.SAVE_KEY});
  assert.equal(reads,1,'actual localStorage save event still handled');
  assert.equal(ctx.saveIssue,'SAVE_REMOVED');
});
