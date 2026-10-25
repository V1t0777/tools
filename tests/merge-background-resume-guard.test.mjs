import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createInitialState} from '../merge/engine.mjs';
import {SAVE_KEY,peekLocalV3} from '../merge/storage.mjs';

const main=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
const slice=(start,end)=>{
  const left=main.indexOf(start),right=main.indexOf(end,left);
  assert.ok(left>=0&&right>left,`missing real page handler: ${start}`);
  return main.slice(left,right);
};
const visibilityCode=slice("document.addEventListener('visibilitychange', () => {",
  "byId('store-selected').addEventListener");
const timerCode=slice("window.setInterval(() => {","byId('save-status').textContent = saveIssue");

function visibilityHarness(raw,actual=raw) {
  const listeners={},hints=[],status={textContent:''};
  let renders=0,reads=0;
  const store={getItem(key){assert.equal(key,SAVE_KEY);reads++;return actual;}};
  const ctx={document:{hidden:false,addEventListener(name,listener){listeners[name]=listener;}},
    drag:null,ignoreNextClick:false,selected:2,activeGuidance:{boardSlots:[2]},
    saveIssue:null,persistedRaw:raw,store,peekLocalV3,
    byId(id){assert.equal(id,'save-status');return status;},
    hint(message){hints.push(message);},render(){renders++;},
    completeDrag(){throw Error('no active drag should be completed');}};
  runInNewContext(visibilityCode,ctx);
  assert.equal(typeof listeners.visibilitychange,'function');
  return {ctx,fire:()=>listeners.visibilitychange(),status,hints,get renders(){return renders;},
    get reads(){return reads;}};
}

test('P2.58 hidden tab timer never invokes regeneration or persistence',()=>{
  let handler=null,regenerations=0,saves=0,paints=0;
  const context={document:{hidden:true},window:{setInterval(callback,ms){
    assert.equal(ms,1000);handler=callback;}},
    Date:{now:()=>5000},state:createInitialState(1000),saveIssue:null,
    advanceTime(){regenerations++;throw Error('background regen');},
    persist(){saves++;throw Error('background save');},
    renderResources(){paints++;},refreshSupplyControls(){paints++;},
    render(){paints++;}};
  runInNewContext(timerCode,context);
  assert.equal(typeof handler,'function');
  handler();handler();
  assert.equal(regenerations,0);
  assert.equal(saves,0);
  assert.equal(paints,0);
});

test('P2.58 visible resume with unchanged raw baseline keeps gameplay enabled',()=>{
  const raw=JSON.stringify(createInitialState(1000)),h=visibilityHarness(raw);
  h.fire();
  assert.equal(h.ctx.saveIssue,null);
  assert.equal(h.ctx.persistedRaw,raw);
  assert.equal(h.ctx.selected,2);
  assert.equal(h.ctx.activeGuidance.boardSlots[0],2);
  assert.equal(h.reads,1);
  assert.equal(h.renders,0);
  assert.deepEqual(h.hints,[]);
});

test('P2.58 changed save during suspension blocks stale page before next write',()=>{
  const state=createInitialState(1000),raw=JSON.stringify(state);
  const other=JSON.stringify({...state,revision:state.revision+1});
  const h=visibilityHarness(raw,other);
  h.fire();
  assert.equal(h.ctx.saveIssue,'CURRENT_SAVE_CHANGED');
  assert.equal(h.ctx.persistedRaw,raw);
  assert.equal(h.ctx.selected,-1);
  assert.equal(h.ctx.activeGuidance,null);
  assert.equal(h.renders,1);
  assert.match(h.status.textContent,/已暂停写入/);
  assert.match(h.hints[0],/保护进度/);
});

test('P2.58 removed or corrupt save while hidden is rejected without resetting',()=>{
  const raw=JSON.stringify(createInitialState(1000));
  for(const [actual,reason] of [[null,'SAVE_REMOVED'],['{bad','CORRUPT_SAVE']]){
    const h=visibilityHarness(raw,actual);
    h.fire();
    assert.equal(h.ctx.saveIssue,reason);
    assert.equal(h.ctx.persistedRaw,raw);
    assert.equal(h.renders,1);
  }
});

test('P2.58 resumed tab cancels old gesture on detected storage conflict',()=>{
  const state=createInitialState(1000),raw=JSON.stringify(state);
  const h=visibilityHarness(raw,JSON.stringify({...state,revision:state.revision+1}));
  let removed=0;
  h.ctx.drag={id:8,ghost:{remove(){removed++;}}};
  h.fire();
  assert.equal(removed,1);
  assert.equal(h.ctx.drag,null);
  assert.equal(h.ctx.ignoreNextClick,true);
});

test('P2.58 background hide still cancels a stale drag without reading storage',()=>{
  const raw=JSON.stringify(createInitialState(1000));
  const h=visibilityHarness(raw);
  let cancelled=0;
  h.ctx.document.hidden=true;
  h.ctx.drag={id:7,ghost:null};
  h.ctx.completeDrag=event=>{
    assert.equal(event.pointerId,7);
    h.ctx.drag=null;
    cancelled++;
  };
  h.fire();
  assert.equal(cancelled,1);
  assert.equal(h.ctx.ignoreNextClick,true);
  assert.equal(h.reads,0);
});
