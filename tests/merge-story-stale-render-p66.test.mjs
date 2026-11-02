import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createWorkshopRenderedActionGuard} from '../merge/story/render-action-guard.mjs';

const readUI=()=>readFileSync(new URL('../merge/story/workshop.mjs',import.meta.url),'utf8');

test('P66 a queued detached order action is never interpreted against a newer render',()=>{
  let generation=1,fulfillments=0,stale=0;
  const guard=createWorkshopRenderedActionGuard(()=>generation,()=>stale++);
  const oldOrder=guard(()=>{fulfillments++;});
  generation=2;
  assert.equal(oldOrder(),undefined);
  assert.equal(fulfillments,0);
  assert.equal(stale,1);
  const currentOrder=guard(()=>{fulfillments++;return 'accepted';});
  assert.equal(currentOrder(),'accepted');
  assert.equal(fulfillments,1);
});

test('P66 stale board and warehouse taps cannot alter selection or inventory',()=>{
  let generation=8,selected=-1,warehouse=2,stale=0;
  const guard=createWorkshopRenderedActionGuard(()=>generation,()=>stale++);
  const oldCell=guard(()=>{selected=16;});
  const oldWithdraw=guard(()=>{warehouse--;});
  generation=9;
  oldCell();oldWithdraw();
  assert.equal(selected,-1);
  assert.equal(warehouse,2);
  assert.equal(stale,2);
  guard(()=>{selected=20;})();
  assert.equal(selected,20);
});

test('P66 render invalidation during one action prevents a second queued action',()=>{
  let generation=4,actions=0,stale=0;
  const guard=createWorkshopRenderedActionGuard(()=>generation,()=>stale++);
  const first=guard(()=>{actions++;generation++;});
  const second=guard(()=>{actions++;});
  first();second();
  assert.equal(actions,1);
  assert.equal(stale,1);
});

test('P66 guard validates callbacks and forwards live event arguments',()=>{
  assert.throws(()=>createWorkshopRenderedActionGuard(null,()=>{}),TypeError);
  assert.throws(()=>createWorkshopRenderedActionGuard(()=>1,null),TypeError);
  const guard=createWorkshopRenderedActionGuard(()=>1,()=>{});
  assert.throws(()=>guard(null),TypeError);
  assert.deepEqual(guard((a,b)=>[a,b])('touch',3),['touch',3]);
});

test('P66 story live UI binds all generated board, warehouse and order actions to their render',()=>{
  const ui=readUI();
  assert.ok(ui.includes("import {createWorkshopRenderedActionGuard} from './render-action-guard.mjs';"));
  assert.ok(ui.includes('let renderGeneration=0;'));
  assert.ok(ui.includes('renderGeneration++;'));
  assert.ok(ui.includes("button.addEventListener('click',guardRenderedAction(()=>touch(i)))"));
  assert.ok(ui.includes("button.addEventListener('click',guardRenderedAction(()=>commit(withdrawItem(state,i))))"));
  assert.ok(ui.includes("btn.addEventListener('click',guardRenderedAction(()=>commit(fulfillOrder(state,order.id))))"));
  assert.ok(ui.includes('界面已更新，请在最新界面重新操作'));
  assert.ok(ui.includes('if(!revalidateWorkshopBeforeInteraction())return;'));
  assert.ok(ui.includes('runStoryWriteWithLock(webLocks,STORY_WORKSHOP_KEY'));
  for(const unsafe of ['innerHTML','insertAdjacentHTML','fetch(','sendBeacon(','localStorage.setItem','SAVE_KEY'])
    assert.equal(ui.includes(unsafe),false,unsafe);
});

test('P66 stale-tap feedback is an accessible live region, not an auto-replay',()=>{
  const html=readFileSync(new URL('../merge/story-workshop.html',import.meta.url),'utf8');
  const css=readFileSync(new URL('../merge/story/workshop.css',import.meta.url),'utf8');
  assert.match(html,/<p id="board-notice" role="status" aria-live="polite">/);
  assert.ok(css.includes('min-height:48px'));
  assert.ok(css.includes('overflow-x:auto'));
  assert.ok(css.includes('prefers-reduced-motion:reduce'));
});
