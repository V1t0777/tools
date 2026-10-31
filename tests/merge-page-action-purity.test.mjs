import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createInitialState} from '../merge/engine.mjs';

const source=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
const start=source.indexOf('function commit(result) {');
const end=source.indexOf('function maybeProduce(slot) {',start);
assert.ok(start>=0&&end>start,'real ordinary-mode action gateway missing');
const gateway=source.slice(start,end);

function harness() {
  const initial=createInitialState(1000);
  let writes=0,preflights=0,renders=0;
  const status={textContent:''},hints=[];
  const ctx={state:initial,saveIssue:null,selected:3,activeGuidance:{stale:true},
    revalidateResumedSave(){preflights++;},
    byId(id){assert.equal(id,'save-status');return status;},
    persist(){writes++;return true;},
    render(){renders++;},hint(message){hints.push(message);}};
  runInNewContext(gateway,ctx);
  return {initial,ctx,status,hints,act:action=>ctx.commit(action),
    get counts(){return {writes,preflights,renders};}};
}

test('P2.61s rejects successful action that mutates a nested board item',()=>{
  const h=harness(),before=JSON.stringify(h.initial);
  h.act(current=>{
    current.board[0].level=99;
    return {ok:true,state:{...current,revision:current.revision+1},message:'伪成功'};
  });
  assert.equal(h.ctx.saveIssue,'ACTION_MUTATED_BASELINE');
  assert.equal(JSON.stringify(h.ctx.state),before);
  assert.deepEqual(h.counts,{writes:0,preflights:1,renders:1});
  assert.equal(h.ctx.selected,-1);
  assert.equal(h.ctx.activeGuidance,null);
  assert.match(h.status.textContent,/暂停写入/);
});

test('P2.61s rejects failed action that silently changes coins',()=>{
  const h=harness(),before=JSON.stringify(h.initial);
  h.act(current=>{current.coins+=999;return {ok:false,message:'金币不足'};});
  assert.equal(h.ctx.saveIssue,'ACTION_MUTATED_BASELINE');
  assert.equal(JSON.stringify(h.ctx.state),before);
  assert.equal(h.counts.writes,0);
});

test('P2.61s restores original snapshot when action throws after mutation',()=>{
  const h=harness(),before=JSON.stringify(h.initial);
  assert.doesNotThrow(()=>h.act(current=>{current.energy=0;throw Error('boom');}));
  assert.equal(h.ctx.saveIssue,'ACTION_MUTATED_BASELINE');
  assert.equal(JSON.stringify(h.ctx.state),before);
  assert.equal(h.counts.writes,0);
});

test('P2.61s safely restores baseline when action introduces a cycle',()=>{
  const h=harness(),before=JSON.stringify(h.initial);
  h.act(current=>{current.loop=current;return {ok:false,message:'失败'};});
  assert.equal(h.ctx.saveIssue,'ACTION_MUTATED_BASELINE');
  assert.equal(JSON.stringify(h.ctx.state),before);
  assert.equal(h.counts.writes,0);
});

test('P2.61s pure success and pure failure preserve existing behavior',()=>{
  const h=harness();
  h.act(current=>({ok:false,message:'没有体力'}));
  assert.equal(h.ctx.saveIssue,null);
  assert.deepEqual(h.counts,{writes:0,preflights:1,renders:1});
  h.act(current=>({ok:true,state:{...current,revision:current.revision+1},message:'完成'}));
  assert.equal(h.ctx.saveIssue,null);
  assert.deepEqual(h.counts,{writes:1,preflights:2,renders:2});
});
