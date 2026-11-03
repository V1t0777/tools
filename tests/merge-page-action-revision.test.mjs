import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createInitialState} from '../merge/engine.mjs';

// Run the real page's synchronous action gateway, not a copied validator.
const source=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
const start=source.indexOf('function commit(result) {');
const end=source.indexOf('function maybeProduce(slot) {',start);
assert.ok(start>=0&&end>start,'ordinary action gateway missing');
const gateway=source.slice(start,end);

function harness() {
  const state=createInitialState(1000);
  let preflights=0,writes=0,renders=0;
  const hints=[],status={textContent:''};
  const ctx={
    state,saveIssue:null,selected:0,activeGuidance:null,
    revalidateResumedSave(){preflights++;},
    byId(id){assert.equal(id,'save-status');return status;},
    persist(){writes++;return true;},
    render(){renders++;},
    hint(message){hints.push(message);}
  };
  runInNewContext(gateway,ctx);
  return {ctx,state,status,hints,act:action=>ctx.commit(action),
    get counts(){return {preflights,writes,renders};}};
}

test('P2.61r rejects same-revision economy replacement without saving',()=>{
  const h=harness();
  h.act(current=>({ok:true,state:{...current,coins:current.coins+500},message:'完成'}));
  assert.equal(h.ctx.saveIssue,'ACTION_REVISION_INVALID');
  assert.equal(h.ctx.state,h.state);
  assert.deepEqual(h.counts,{preflights:1,writes:0,renders:0});
  assert.match(h.status.textContent,/暂停写入/);
});

test('P2.61r rejects skipped revision and the identical input state',()=>{
  for(const kind of ['skip','identity']) {
    const h=harness();
    h.act(current=>({ok:true,state:kind==='skip'
      ? {...current,revision:current.revision+2}:current,message:'完成'}));
    assert.equal(h.ctx.saveIssue,'ACTION_REVISION_INVALID',kind);
    assert.deepEqual(h.counts,{preflights:1,writes:0,renders:0},kind);
  }
});

test('P2.61r malformed action result freezes the page without persistence',()=>{
  const h=harness();
  h.act(()=>null);
  assert.equal(h.ctx.saveIssue,'ACTION_REVISION_INVALID');
  assert.deepEqual(h.counts,{preflights:1,writes:0,renders:0});
  h.act(()=>{throw Error('blocked page must not evaluate another action');});
  assert.deepEqual(h.counts,{preflights:1,writes:0,renders:0});
});

test('P2.61r normal one-step action still persists and publishes once',()=>{
  const h=harness();
  const next={...h.state,revision:h.state.revision+1};
  h.act(current=>({ok:true,state:next,message:'已移动'}));
  assert.equal(h.ctx.saveIssue,null);
  assert.equal(h.ctx.state,next);
  assert.deepEqual(h.counts,{preflights:1,writes:1,renders:1});
  assert.ok(h.hints.includes('已移动'));
});

test('P2.61r ordinary rejected action remains a no-write message',()=>{
  const h=harness();
  h.act(()=>({ok:false,message:'库存不足'}));
  assert.equal(h.ctx.saveIssue,null);
  assert.deepEqual(h.counts,{preflights:1,writes:0,renders:1});
  assert.ok(h.hints.includes('库存不足'));
});
