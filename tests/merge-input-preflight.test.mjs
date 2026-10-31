import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createInitialState} from '../merge/engine.mjs';
import {peekLocalV3,SAVE_KEY} from '../merge/storage.mjs';

// Exercise the real page's guard and event handlers, not a duplicate policy.
const source=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
function extract(start,end) {
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a,'missing page handler: '+start);
  return source.slice(a,b);
}
const handlers=[
  extract('function touchCell(slot) {','function formatSeconds'),
  extract("board.addEventListener('pointerdown', event => {",
    "board.addEventListener('pointermove', event => {"),
  extract('function revalidateResumedSave() {',
    "document.addEventListener('visibilitychange', () => {")
].join('\n');

function harness(actualRaw=undefined) {
  const state=createInitialState(1000),baseline=JSON.stringify(state);
  const listeners={},status={textContent:''};
  let reads=0,writes=0,renders=0,notices=0,captures=0;
  const store={
    getItem(key){assert.equal(key,SAVE_KEY);reads++;return actualRaw===undefined?baseline:actualRaw;},
    setItem(){writes++;throw Error('input preflight must never write');}
  };
  const cell={dataset:{slot:'0'},setPointerCapture(){captures++;}};
  const board={addEventListener(type,fn){listeners[type]=fn;}};
  const ctx={store,peekLocalV3,board,state,persistedRaw:baseline,
    saveIssue:null,selected:-1,activeGuidance:null,drag:null,ignoreNextClick:false,
    byId(id){assert.equal(id,'save-status');return status;},
    render(){renders++;},hint(){notices++;},
    maybeProduce(){throw Error('unexpected production');},
    moveOrMerge(){throw Error('unexpected merge');},
    commit(){throw Error('unexpected action');}
  };
  runInNewContext(handlers,ctx);
  return {ctx,status,baseline,cell,
    touch:()=>ctx.touchCell(0),
    pointer:()=>listeners.pointerdown({button:0,pointerId:7,clientX:5,clientY:6,
      target:{closest(){return cell;}}}),
    get reads(){return reads;},get writes(){return writes;},
    get renders(){return renders;},get notices(){return notices;},
    get captures(){return captures;}
  };
}

test('P2.61l stale save blocks a tap before selecting old board',()=>{
  const state=createInitialState(1000);
  const changed=JSON.stringify({...state,revision:state.revision+1});
  const h=harness(changed);
  h.touch();
  assert.equal(h.reads,1);
  assert.equal(h.writes,0);
  assert.equal(h.ctx.saveIssue,'CURRENT_SAVE_CHANGED');
  assert.equal(h.ctx.selected,-1);
  assert.equal(h.ctx.persistedRaw,h.baseline);
  assert.equal(h.ctx.state.revision,0);
  assert.equal(h.renders,1);
  assert.match(h.status.textContent,/已暂停写入/);
});

test('P2.61l unchanged save keeps normal tap and selection behavior',()=>{
  const h=harness();
  h.touch();
  assert.equal(h.reads,1);
  assert.equal(h.writes,0);
  assert.equal(h.ctx.saveIssue,null);
  assert.equal(h.ctx.selected,0);
  assert.equal(h.renders,1);
  assert.equal(h.notices,0);
});

test('P2.61l missing or corrupt save cannot start a new drag',()=>{
  for(const [raw,reason] of [[null,'SAVE_REMOVED'],['{','CORRUPT_SAVE']]){
    const h=harness(raw);
    h.pointer();
    assert.equal(h.reads,1);
    assert.equal(h.writes,0);
    assert.equal(h.ctx.saveIssue,reason);
    assert.equal(h.ctx.drag,null);
    assert.equal(h.captures,0);
    assert.equal(h.ctx.persistedRaw,h.baseline);
    assert.equal(h.renders,1);
  }
});

test('P2.61l unchanged save preserves primary pointer capture',()=>{
  const h=harness();
  h.pointer();
  assert.equal(h.reads,1);
  assert.equal(h.writes,0);
  assert.equal(h.ctx.saveIssue,null);
  assert.equal(h.captures,1);
  assert.equal(h.ctx.drag?.id,7);
  assert.equal(h.renders,0);
});
