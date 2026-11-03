import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {setImmediate} from 'node:timers/promises';

const source=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
const start=source.indexOf('function commit(result) {');
const end=source.indexOf('function maybeProduce(slot) {',start);
assert.ok(start>=0&&end>start,'real ordinary-mode action gateway missing');
const gateway=source.slice(start,end);

function harness(){
  const original={revision:1,coins:10,energy:8,board:[{kind:'material',tier:1}]};
  let writes=0,preflights=0,renders=0;
  const status={textContent:''},hints=[];
  const ctx={state:original,saveIssue:null,selected:0,activeGuidance:{stale:true},
    revalidateResumedSave(){preflights++;},
    byId(id){assert.equal(id,'save-status');return status;},
    persist(){writes++;return true;},
    render(){renders++;},hint(message){hints.push(message);}};
  runInNewContext(gateway,ctx);
  return {ctx,original,status,hints,act:action=>ctx.commit(action),
    get counts(){return {writes,preflights,renders};}};
}

test('P2.61t rejected Promise is observed and freezes synchronous page',async()=>{
  const h=harness();
  h.act(()=>Promise.reject(Error('deferred rejection')));
  await setImmediate();
  assert.equal(h.ctx.saveIssue,'ASYNC_ACTION_NOT_ALLOWED');
  assert.equal(h.ctx.state.coins,10);
  assert.notEqual(h.ctx.state,h.original);
  assert.deepEqual(h.counts,{writes:0,preflights:1,renders:1});
  assert.match(h.status.textContent,/暂停写入/);
  assert.equal(h.ctx.selected,-1);
  assert.equal(h.ctx.activeGuidance,null);
});

test('P2.61t deferred continuation cannot mutate published memory',async()=>{
  const h=harness();
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  h.act(current=>{
    pending.then(()=>{current.coins=999;});
    return pending;
  });
  assert.equal(h.ctx.saveIssue,'ASYNC_ACTION_NOT_ALLOWED');
  release();
  await pending;
  await setImmediate();
  assert.equal(h.original.coins,999);
  assert.equal(h.ctx.state.coins,10);
  assert.equal(h.counts.writes,0);
});

test('P2.61t input mutation retains purity priority but observes rejection',async()=>{
  const h=harness();
  h.act(current=>{
    current.board[0].tier=99;
    return Promise.reject(Error('rejected after mutation'));
  });
  await setImmediate();
  assert.equal(h.ctx.saveIssue,'ACTION_MUTATED_BASELINE');
  assert.equal(h.ctx.state.board[0].tier,1);
  assert.deepEqual(h.counts,{writes:0,preflights:1,renders:1});
});

test('P2.61t throwing then getter is rejected without crashing or writing',async()=>{
  const h=harness();
  assert.doesNotThrow(()=>h.act(()=>({
    get then(){throw Error('bad then getter');}
  })));
  await setImmediate();
  assert.equal(h.ctx.saveIssue,'ASYNC_ACTION_NOT_ALLOWED');
  assert.equal(h.counts.writes,0);
});

test('P2.61t custom rejecting thenable is observed and rejected',async()=>{
  const h=harness();
  h.act(()=>({then(_resolve,reject){reject(Error('thenable rejection'));}}));
  await setImmediate();
  assert.equal(h.ctx.saveIssue,'ASYNC_ACTION_NOT_ALLOWED');
  assert.equal(h.counts.writes,0);
});

test('P2.61t synchronous success and ordinary failure remain unchanged',()=>{
  const h=harness();
  h.act(()=>({ok:false,message:'库存不足'}));
  assert.equal(h.ctx.saveIssue,null);
  assert.equal(h.counts.writes,0);
  h.act(current=>({ok:true,state:{...current,revision:current.revision+1},message:'已移动'}));
  assert.equal(h.ctx.saveIssue,null);
  assert.deepEqual(h.counts,{writes:1,preflights:2,renders:2});
  assert.ok(h.hints.includes('已移动'));
});
