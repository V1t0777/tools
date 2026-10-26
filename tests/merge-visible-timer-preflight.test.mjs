import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createInitialState} from '../merge/engine.mjs';
import {peekLocalV3,SAVE_KEY} from '../merge/storage.mjs';

// Execute the actual page's resume guard and visible timer, not copied logic.
const source=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
function section(start,end) {
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a,'missing page section: '+start);
  return source.slice(a,b);
}
const code=section('function revalidateResumedSave() {',
  "document.addEventListener('visibilitychange', () => {")+
  section('window.setInterval(() => {',
    "byId('save-status').textContent = saveIssue");

function harness({raw,blocked=false,hidden=false,changed=false}={}) {
  const initial=createInitialState(1000),baseline=JSON.stringify(initial);
  let actual=raw===undefined?baseline:raw;
  let timer,reads=0,writes=0,advances=0,saves=0,renders=0,paints=0;
  const status={textContent:''},hints=[];
  const store={
    getItem(key){assert.equal(key,SAVE_KEY);reads++;return actual;},
    setItem(){writes++;throw Error('timer preflight must not write');}
  };
  const ctx={
    document:{hidden},window:{setInterval(fn,ms){assert.equal(ms,1000);timer=fn;}},
    Date:{now:()=>5000},state:initial,store,peekLocalV3,persistedRaw:baseline,
    saveIssue:blocked?'CURRENT_SAVE_CHANGED':null,selected:1,
    activeGuidance:{boardSlots:[1]},drag:null,ignoreNextClick:false,
    byId(id){assert.equal(id,'save-status');return status;},
    hint(message){hints.push(message);},render(){renders++;},
    renderResources(){paints++;},refreshSupplyControls(){paints++;},
    getBoardGuidance(){return null;},
    advanceTime(current){advances++;return changed?{...current,energy:current.energy-1}:current;},
    persist(){saves++;return true;}
  };
  runInNewContext(code,ctx);
  assert.equal(typeof timer,'function');
  return {ctx,initial,baseline,status,hints,tick:()=>timer(),
    setRaw(value){actual=value;},
    get counts(){return {reads,writes,advances,saves,renders,paints};}};
}

test('P2.61q visible no-op tick detects delayed cross-tab replacement',()=>{
  const h=harness();
  h.setRaw(JSON.stringify({...h.initial,revision:h.initial.revision+1}));
  h.tick();
  assert.equal(h.ctx.saveIssue,'CURRENT_SAVE_CHANGED');
  assert.equal(h.ctx.state,h.initial);
  assert.equal(h.ctx.persistedRaw,h.baseline);
  assert.equal(h.ctx.selected,-1);
  assert.equal(h.ctx.activeGuidance,null);
  assert.deepEqual(h.counts,{reads:1,writes:0,advances:0,saves:0,renders:1,paints:0});
  assert.match(h.status.textContent,/暂停写入/);
});

test('P2.61q due regeneration does not compute against a stale baseline',()=>{
  const h=harness({changed:true});
  h.setRaw(JSON.stringify({...h.initial,revision:h.initial.revision+1}));
  h.tick();
  assert.equal(h.ctx.saveIssue,'CURRENT_SAVE_CHANGED');
  assert.deepEqual(h.counts,{reads:1,writes:0,advances:0,saves:0,renders:1,paints:0});
});

test('P2.61q removed and corrupt save block timer without overwriting raw',()=>{
  for(const raw of [null,'{broken']) {
    const h=harness({raw,changed:true});
    h.tick();
    assert.ok(h.ctx.saveIssue);
    assert.equal(h.ctx.persistedRaw,h.baseline);
    assert.deepEqual(h.counts,{reads:1,writes:0,advances:0,saves:0,renders:1,paints:0});
  }
});

test('P2.61q matching baseline preserves unchanged tick without writes',()=>{
  const h=harness();
  h.tick();
  assert.equal(h.ctx.saveIssue,null);
  assert.equal(h.ctx.state,h.initial);
  assert.deepEqual(h.counts,{reads:1,writes:0,advances:1,saves:0,renders:0,paints:2});
});

test('P2.61q matching baseline preserves one due clock persistence',()=>{
  const h=harness({changed:true});
  h.tick();
  assert.equal(h.ctx.saveIssue,null);
  assert.notEqual(h.ctx.state,h.initial);
  assert.deepEqual(h.counts,{reads:1,writes:0,advances:1,saves:1,renders:1,paints:0});
});

test('P2.61q hidden or already blocked timer does not read or write',()=>{
  for(const flags of [{hidden:true},{blocked:true}]) {
    const h=harness({...flags,changed:true});
    h.tick();
    assert.deepEqual(h.counts,{reads:0,writes:0,advances:0,saves:0,renders:0,paints:0});
  }
});
