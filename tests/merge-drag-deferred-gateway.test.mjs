import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createInitialState} from '../merge/engine.mjs';
import {peekLocalV3,SAVE_KEY} from '../merge/storage.mjs';

// Execute the real ordinary-mode drop and action gateway together.
const source=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
function extract(start,end) {
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a,'missing page handler: '+start);
  return source.slice(a,b);
}
const handlers=[
  extract('function commit(result) {','function maybeProduce(slot) {'),
  extract('function completeDrag(event, cancelled = false) {',
    "board.addEventListener('pointerup', event => completeDrag(event));"),
  extract('function revalidateResumedSave() {',
    "document.addEventListener('visibilitychange', () => {")
].join('\n');

function harness({replaceDuringHitTest=false,actionOk=true,targetPresent=true}={}) {
  const state=createInitialState(1000);
  const baseline=JSON.stringify(state);
  let raw=baseline,reads=0,moves=0,persists=0,renders=0,targets=0;
  const hints=[],status={textContent:''},cell={dataset:{slot:'1'}};
  const store={
    getItem(key){assert.equal(key,SAVE_KEY);reads++;return raw;},
    setItem(){throw Error('no real storage writes in gateway harness');}
  };
  const ctx={
    state,persistedRaw:baseline,store,peekLocalV3,
    saveIssue:null,selected:0,activeGuidance:{boardSlots:[0]},
    drag:{id:7,origin:0,moved:true,ghost:{remove(){}}},
    ignoreNextClick:false,
    board:{contains(node){return node===cell;}},
    document:{elementFromPoint(){
      targets++;
      if(replaceDuringHitTest)raw=JSON.stringify({...state,revision:1});
      return targetPresent?{closest(){return cell;}}:null;
    }},
    byId(id){assert.equal(id,'save-status');return status;},
    moveOrMerge(current,origin,target){
      moves++;
      assert.equal(current,ctx.state);
      assert.equal(origin,0);
      assert.equal(target,1);
      return actionOk
        ? {ok:true,state:{...current,revision:current.revision+1},message:'已合成'}
        : {ok:false,message:'不能合成'};
    },
    persist(){persists++;return true;},
    render(){renders++;},
    hint(message){hints.push(message);}
  };
  runInNewContext(handlers,ctx);
  return {
    ctx,baseline,status,hints,
    finish(){ctx.completeDrag({pointerId:7,clientX:10,clientY:20});},
    get counts(){return {reads,moves,persists,renders,targets};}
  };
}

test('P2.61p hit-test race blocks deferred merge before engine evaluation',()=>{
  const h=harness({replaceDuringHitTest:true});
  h.finish();
  assert.deepEqual(h.counts,{reads:2,moves:0,persists:0,renders:1,targets:1});
  assert.equal(h.ctx.saveIssue,'CURRENT_SAVE_CHANGED');
  assert.equal(h.ctx.persistedRaw,h.baseline);
  assert.equal(h.ctx.state.revision,0);
  assert.equal(h.ctx.selected,-1);
  assert.equal(h.ctx.ignoreNextClick,true);
  assert.match(h.status.textContent,/已暂停写入/);
});

test('P2.61p normal drag executes merge once after both raw-save checks',()=>{
  const h=harness();
  h.finish();
  assert.deepEqual(h.counts,{reads:2,moves:1,persists:1,renders:1,targets:1});
  assert.equal(h.ctx.state.revision,1);
  assert.equal(h.ctx.saveIssue,null);
  assert.equal(h.ctx.ignoreNextClick,true);
  assert.ok(h.hints.includes('已合成'));
});

test('P2.61p rejected drag action still renders its original engine message',()=>{
  const h=harness({actionOk:false});
  h.finish();
  assert.deepEqual(h.counts,{reads:2,moves:1,persists:0,renders:1,targets:1});
  assert.equal(h.ctx.state.revision,0);
  assert.ok(h.hints.includes('不能合成'));
});

test('P2.61p drop outside the board never invokes the action gateway',()=>{
  const h=harness({targetPresent:false});
  h.finish();
  assert.deepEqual(h.counts,{reads:1,moves:0,persists:0,renders:0,targets:1});
  assert.equal(h.ctx.ignoreNextClick,true);
});
