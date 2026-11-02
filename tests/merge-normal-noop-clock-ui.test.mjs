import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Exercise the production page timer body, not a rewritten clock algorithm.
const source=readFileSync(new URL('../merge/main-locked.mjs',import.meta.url),'utf8');
const start=source.indexOf('let timerPending=false;');
const end=source.indexOf("byId('save-status').textContent='正在核验",start);
assert.ok(start>=0&&end>start,'ordinary page timer section must exist');
const code=source.slice(start,end);

function harness({due=false,stale=false,busy=false,importing=false}={}){
  const state=Object.freeze({revision:2,energy:119});
  const calls={revalidate:0,advance:0,clock:0,resources:0,supplies:0,
    published:0,blocked:0};
  let tick;
  const ctx={
    state,saveIssue:null,
    window:{setInterval(fn,ms){assert.equal(ms,1000);tick=fn;}},
    pageSuspended:()=>false,importPending:()=>importing,
    runtime:{busy,async clock({now}){assert.equal(now,4000);calls.clock++;
      return {ok:true,changed:true};}},
    Date:{now:()=>4000},
    revalidateResumedSave(){calls.revalidate++;return !stale;},
    advanceTime(current,now){calls.advance++;assert.equal(now,4000);
      assert.equal(current,state);return due?{...current,energy:120}:current;},
    renderResources(now){assert.equal(now,4000);calls.resources++;},
    refreshSupplyControls(){calls.supplies++;},
    handleTransactionResult(result,kind){assert.equal(kind,'clock');
      assert.equal(result.ok,true);calls.published++;},
    pauseUnsafe(){calls.blocked++;}
  };
  runInNewContext(code,ctx);
  assert.equal(typeof tick,'function');
  return {tick:()=>tick(),calls,ctx,state};
}

test('P2.65cq ordinary no-op second checks the current baseline without taking a Web Lock',async()=>{
  const h=harness();
  await h.tick();
  assert.deepEqual(h.calls,{revalidate:1,advance:1,clock:0,resources:1,
    supplies:1,published:0,blocked:0});
  await h.tick();
  assert.equal(h.calls.clock,0,'repeated no-op seconds must not occupy the action lock');
  assert.equal(h.calls.revalidate,2,'no-op must still detect stale cross-tab saves');
  assert.equal(h.ctx.state,h.state);
});

test('P2.65cq real energy or producer regeneration still uses the exclusive clock writer',async()=>{
  const h=harness({due:true});
  await h.tick();
  assert.deepEqual(h.calls,{revalidate:1,advance:1,clock:1,resources:0,
    supplies:0,published:1,blocked:0});
});

test('P2.65cq changed baseline blocks timer before any preview or lock',async()=>{
  const h=harness({stale:true});
  await h.tick();
  assert.deepEqual(h.calls,{revalidate:1,advance:0,clock:0,resources:0,
    supplies:0,published:0,blocked:0});
});

test('P2.65cq pending import or busy writer never enters timer preflight',async()=>{
  for(const opts of [{importing:true},{busy:true}]){
    const h=harness(opts);
    await h.tick();
    assert.deepEqual(h.calls,{revalidate:0,advance:0,clock:0,resources:0,
      supplies:0,published:0,blocked:0});
  }
});
