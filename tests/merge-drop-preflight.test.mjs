import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createInitialState} from '../merge/engine.mjs';
import {peekLocalV3,SAVE_KEY} from '../merge/storage.mjs';

// Run the actual page's drag completion and raw-save revalidation functions.
const source=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
function extract(start,end) {
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a,'missing page handler: '+start);
  return source.slice(a,b);
}
const handlers=[
  extract('function completeDrag(event, cancelled = false) {',
    "board.addEventListener('pointerup', event => completeDrag(event));"),
  extract('function revalidateResumedSave() {',
    "document.addEventListener('visibilitychange', () => {")
].join('\n');

function harness() {
  const state=createInitialState(1000),baseline=JSON.stringify(state);
  let raw=baseline,throwOnRead=false;
  let reads=0,writes=0,moves=0,commits=0,renders=0,removals=0,targets=0;
  const status={textContent:''},cell={dataset:{slot:'1'}};
  const store={
    getItem(key){assert.equal(key,SAVE_KEY);reads++;if(throwOnRead)throw Error('denied');return raw;},
    setItem(){writes++;throw Error('drag preflight must never write');}
  };
  const ctx={
    state,persistedRaw:baseline,store,peekLocalV3,
    saveIssue:null,selected:0,activeGuidance:{boardSlots:[0]},
    drag:{id:7,origin:0,moved:true,ghost:{remove(){removals++;}}},
    ignoreNextClick:false,
    board:{contains(node){return node===cell;}},
    document:{elementFromPoint(){targets++;return {closest(){return cell;}};}},
    byId(id){assert.equal(id,'save-status');return status;},
    moveOrMerge(){moves++;return {ok:true,state};},
    commit(){commits++;},
    render(){renders++;},hint(){}
  };
  runInNewContext(handlers,ctx);
  return {ctx,state,baseline,status,
    setRaw(next){raw=next;},
    failRead(){throwOnRead=true;},
    finish(cancelled=false){ctx.completeDrag({pointerId:7,clientX:10,clientY:20},cancelled);},
    get counts(){return {reads,writes,moves,commits,renders,removals,targets};}
  };
}

test('P2.61m drop rejects another tab replacing the raw save mid-gesture',()=>{
  const h=harness();
  h.setRaw(JSON.stringify({...h.state,revision:h.state.revision+1}));
  h.finish();
  assert.equal(h.ctx.saveIssue,'CURRENT_SAVE_CHANGED');
  assert.deepEqual(h.counts,{reads:1,writes:0,moves:0,commits:0,
    renders:1,removals:1,targets:0});
  assert.equal(h.ctx.state,h.state);
  assert.equal(h.ctx.persistedRaw,h.baseline);
  assert.equal(h.ctx.selected,-1);
  assert.equal(h.ctx.activeGuidance,null);
  assert.equal(h.ctx.drag,null);
  assert.equal(h.ctx.ignoreNextClick,true);
  assert.match(h.status.textContent,/已暂停写入/);
});

test('P2.61m removed, corrupt or unreadable save blocks a pending drop',()=>{
  for(const [kind,reason] of [['removed','SAVE_REMOVED'],
    ['corrupt','CORRUPT_SAVE'],['unreadable','STORAGE_UNAVAILABLE']]) {
    const h=harness();
    if(kind==='removed')h.setRaw(null);
    else if(kind==='corrupt')h.setRaw('{');
    else h.failRead();
    h.finish();
    assert.equal(h.ctx.saveIssue,reason,kind);
    assert.equal(h.counts.reads,1,kind);
    assert.equal(h.counts.moves,0,kind);
    assert.equal(h.counts.commits,0,kind);
    assert.equal(h.counts.writes,0,kind);
    assert.equal(h.counts.targets,0,kind);
    assert.equal(h.ctx.ignoreNextClick,true,kind);
  }
});

test('P2.61m unchanged raw save preserves a completed drag',()=>{
  const h=harness();
  h.finish();
  assert.deepEqual(h.counts,{reads:1,writes:0,moves:1,commits:1,
    renders:0,removals:1,targets:1});
  assert.equal(h.ctx.saveIssue,null);
  assert.equal(h.ctx.drag,null);
  assert.equal(h.ctx.ignoreNextClick,true);
});

test('P2.61m cancelled or stationary drag does not add a storage read',()=>{
  for(const cancelled of [false,true]) {
    const h=harness();
    if(!cancelled)h.ctx.drag.moved=false;
    h.finish(cancelled);
    assert.equal(h.counts.reads,0);
    assert.equal(h.counts.moves,0);
    assert.equal(h.counts.commits,0);
    assert.equal(h.counts.removals,1);
    assert.equal(h.ctx.ignoreNextClick,false);
  }
});

test('P2.61m already-blocked page cannot apply an old drop',()=>{
  const h=harness();
  h.ctx.saveIssue='SAVE_OUTCOME_UNCERTAIN';
  h.finish();
  assert.equal(h.counts.reads,0);
  assert.equal(h.counts.moves,0);
  assert.equal(h.counts.commits,0);
  assert.equal(h.ctx.ignoreNextClick,true);
});
