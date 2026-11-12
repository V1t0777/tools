import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createInitialState} from '../merge/engine.mjs';
import {peekLocalV3,SAVE_KEY} from '../merge/storage.mjs';

// Run the actual ordinary-mode action gateway, not a copied guard.
const source=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
function extract(start,end) {
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a,'missing actual page handler: '+start);
  return source.slice(a,b);
}
const handlers=[
  extract('function commit(result) {','function maybeProduce(slot) {'),
  extract('function revalidateResumedSave() {',
    "document.addEventListener('visibilitychange', () => {")
].join('\n');

function harness({raw,blocked=false}={}) {
  const state=createInitialState(1000);
  const baseline=JSON.stringify(state);
  let currentRaw=raw===undefined?baseline:raw;
  let reads=0,writes=0,commits=0,renders=0;
  const hints=[],status={textContent:''};
  const store={
    getItem(key){assert.equal(key,SAVE_KEY);reads++;return currentRaw;},
    setItem(){writes++;throw Error('preflight must not write raw save');}
  };
  const ctx={
    state,store,peekLocalV3,persistedRaw:baseline,
    saveIssue:blocked?'CURRENT_SAVE_CHANGED':null,
    selected:1,activeGuidance:{boardSlots:[1]},drag:null,
    ignoreNextClick:false,
    byId(id){assert.equal(id,'save-status');return status;},
    persist(){commits++;return true;},
    render(){renders++;},
    hint(message){hints.push(message);}
  };
  runInNewContext(handlers,ctx);
  return {
    ctx,state,baseline,status,hints,
    setRaw(value){currentRaw=value;},
    act(result){ctx.commit(result);},
    get counts(){return {reads,writes,commits,renders};}
  };
}

test('P2.61n non-board successful action rejects stale raw save before persistence',()=>{
  const h=harness();
  h.setRaw(JSON.stringify({...h.state,revision:h.state.revision+1}));
  h.act({ok:true,state:{...h.state,revision:h.state.revision+1},message:'已完成'});
  assert.equal(h.ctx.saveIssue,'CURRENT_SAVE_CHANGED');
  assert.equal(h.ctx.state,h.state);
  assert.equal(h.ctx.persistedRaw,h.baseline);
  assert.equal(h.ctx.selected,-1);
  assert.equal(h.ctx.activeGuidance,null);
  assert.deepEqual(h.counts,{reads:1,writes:0,commits:0,renders:1});
  assert.match(h.status.textContent,/已暂停写入/);
});

test('P2.61n rejected engine action still detects delayed cross-tab replacement',()=>{
  const h=harness();
  h.setRaw(JSON.stringify({...h.state,revision:h.state.revision+1}));
  h.act({ok:false,message:'库存不足'});
  assert.equal(h.ctx.saveIssue,'CURRENT_SAVE_CHANGED');
  assert.deepEqual(h.counts,{reads:1,writes:0,commits:0,renders:1});
  assert.ok(h.hints.some(message=>message.includes('已暂停操作')));
});

test('P2.61n missing or damaged raw save freezes button actions without writes',()=>{
  for(const raw of [null,'{broken']) {
    const h=harness({raw});
    h.act({ok:true,state:{...h.state,revision:1},message:'已完成'});
    assert.ok(h.ctx.saveIssue);
    assert.equal(h.ctx.state,h.state);
    assert.equal(h.ctx.persistedRaw,h.baseline);
    assert.equal(h.counts.commits,0);
    assert.equal(h.counts.writes,0);
  }
});

test('P2.61n matching raw baseline preserves normal action gateway behavior',()=>{
  const h=harness();
  const next={...h.state,revision:h.state.revision+1};
  h.act({ok:true,state:next,message:'已完成'});
  assert.equal(h.ctx.state,next);
  assert.equal(h.ctx.saveIssue,null);
  assert.equal(h.ctx.selected,-1);
  assert.equal(h.ctx.activeGuidance,null);
  assert.deepEqual(h.counts,{reads:1,writes:0,commits:1,renders:1});
  assert.ok(h.hints.includes('已完成'));
});

test('P2.61n already blocked page does not read or persist on button action',()=>{
  const h=harness({blocked:true});
  h.act({ok:true,state:{...h.state,revision:1},message:'已完成'});
  assert.equal(h.ctx.state,h.state);
  assert.deepEqual(h.counts,{reads:0,writes:0,commits:0,renders:0});
  assert.ok(h.hints.some(message=>message.includes('已暂停操作')));
});

test('P2.61o delayed cross-tab replacement never invokes a deferred engine action',()=>{
  const h=harness();
  h.setRaw(JSON.stringify({...h.state,revision:h.state.revision+1}));
  let calls=0;
  h.act(()=>{calls++;return {ok:true,state:{...h.state,revision:1},message:'完成'};});
  assert.equal(calls,0);
  assert.equal(h.ctx.saveIssue,'CURRENT_SAVE_CHANGED');
  assert.deepEqual(h.counts,{reads:1,writes:0,commits:0,renders:1});
});

test('P2.61o already blocked page does not invoke deferred engine action',()=>{
  const h=harness({blocked:true});
  let calls=0;
  h.act(()=>{calls++;return {ok:false,message:'不应执行'};});
  assert.equal(calls,0);
  assert.deepEqual(h.counts,{reads:0,writes:0,commits:0,renders:0});
});

test('P2.61o matching raw executes deferred action once after preflight',()=>{
  const h=harness();
  let calls=0;
  const next={...h.state,revision:h.state.revision+1};
  h.act(current=>{
    calls++;
    assert.equal(h.counts.reads,1);
    assert.equal(current,h.state);
    return {ok:true,state:next,message:'已完成'};
  });
  assert.equal(calls,1);
  assert.equal(h.ctx.state,next);
  assert.deepEqual(h.counts,{reads:1,writes:0,commits:1,renders:1});
});

test('P2.61o rejected deferred action preserves existing no-write behavior',()=>{
  const h=harness();
  let calls=0;
  h.act(()=>{calls++;return {ok:false,message:'库存不足'};});
  assert.equal(calls,1);
  assert.equal(h.ctx.state,h.state);
  assert.deepEqual(h.counts,{reads:1,writes:0,commits:0,renders:1});
  assert.ok(h.hints.includes('库存不足'));
});

test('P2.61o ordinary action entrypoints defer engine evaluation to commit gateway',()=>{
  const actionNames=['produce','moveOrMerge','fulfillOrder','withdrawItem',
    'upgradeProducer','upgradeBuilding','useSupply','purchaseSupply',
    'storeItem','upgradeWarehouse'];
  for(const name of actionNames){
    assert.match(source,new RegExp('commit\\(current=>'+name+'\\(current'),name);
    assert.doesNotMatch(source,new RegExp('commit\\('+name+'\\(state'),name);
  }
});
