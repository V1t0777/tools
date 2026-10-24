import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {shouldBlockStoryStorageEvent,shouldRefreshStoryDependencyEvent,shouldRefreshWorkshopForStoryEvent} from '../merge/story/storage-event-guard.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {STORY_WORKSHOP_KEY,readStoryWorkshop,writeStoryWorkshop} from '../merge/story/workshop-storage.mjs';
import {inspectStoryWorkshopRequirement} from '../merge/story/workshop-gate.mjs';
import {createInitialState,fulfillOrder} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';

test('P18 a workshop save event refreshes story prerequisites but does not block story save',()=>{
  const area={};
  const event={key:STORY_WORKSHOP_KEY,storageArea:area};
  assert.equal(shouldRefreshStoryDependencyEvent(event,{ownKey:STORY_SAVE_KEY,dependencyKey:STORY_WORKSHOP_KEY,storage:area}),true);
  assert.equal(shouldBlockStoryStorageEvent(event,{key:STORY_SAVE_KEY,storage:area}),false);
});
test('P18 a story save event refreshes workshop building eligibility without invalidating its board',()=>{
  const area={};
  const event={key:STORY_SAVE_KEY,storageArea:area};
  assert.equal(shouldRefreshStoryDependencyEvent(event,{ownKey:STORY_WORKSHOP_KEY,dependencyKey:STORY_SAVE_KEY,storage:area}),true);
  assert.equal(shouldRefreshWorkshopForStoryEvent(event,area),true);
  assert.equal(shouldBlockStoryStorageEvent(event,{key:STORY_WORKSHOP_KEY,storage:area}),false);
});
test('P18 clear, normal-mode, unrelated storage, malformed events and self keys never trigger dependency refresh',()=>{
  const area={getItem(){throw Error('should not read');},setItem(){throw Error('should not write');}};
  const opts={ownKey:STORY_SAVE_KEY,dependencyKey:STORY_WORKSHOP_KEY,storage:area};
  for(const event of [{key:null,storageArea:area},{key:SAVE_KEY,storageArea:area},{key:STORY_SAVE_KEY,storageArea:area},{key:STORY_WORKSHOP_KEY,storageArea:{}},{key:undefined,storageArea:area},null]){
    assert.equal(shouldRefreshStoryDependencyEvent(event,opts),false);
  }
  assert.equal(shouldRefreshStoryDependencyEvent({key:STORY_WORKSHOP_KEY,storageArea:area},{ownKey:STORY_SAVE_KEY,dependencyKey:STORY_SAVE_KEY,storage:area}),false);
  assert.equal(shouldRefreshStoryDependencyEvent({key:STORY_WORKSHOP_KEY,storageArea:area},{ownKey:'invalid',dependencyKey:STORY_WORKSHOP_KEY,storage:area}),false);
  assert.equal(shouldBlockStoryStorageEvent({key:null,storageArea:area},{key:STORY_SAVE_KEY,storage:area}),true,'clear still invalidates the own save');
});
test('P18 real story workshop order completion changes a cross-page requirement, not normal-mode data',()=>{
  const map=new Map();
  const storage={getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,v)};
  const normalRaw='normal-mode-preserve';
  storage.setItem(SAVE_KEY,normalRaw);
  assert.equal(inspectStoryWorkshopRequirement('first-order',storage).met,false);
  const initial=readStoryWorkshop(storage,1000000).state;
  const order=initial.orders[0];
  const slot=initial.board.findIndex(item=>item?.kind==='material'&&item.chain===order.chain&&item.tier===order.tier);
  if(slot<0){const free=initial.board.findIndex(item=>!item);assert.ok(free>=0);initial.board[free]={id:'m'+initial.nextId++,kind:'material',chain:order.chain,tier:order.tier};}
  const completed=fulfillOrder(initial,order.id);
  assert.equal(completed.ok,true);
  assert.equal(writeStoryWorkshop(storage,completed.state,{expectedRaw:null}),true);
  assert.equal(shouldRefreshStoryDependencyEvent({key:STORY_WORKSHOP_KEY,storageArea:storage},{ownKey:STORY_SAVE_KEY,dependencyKey:STORY_WORKSHOP_KEY,storage}),true);
  assert.equal(inspectStoryWorkshopRequirement('first-order',storage).met,true);
  assert.equal(storage.getItem(SAVE_KEY),normalRaw);
});
test('P18 both pages keep own-key conflict blocking, and refresh only on the other story key',()=>{
  const story=readFileSync(new URL('../merge/story/ui.mjs',import.meta.url),'utf8');
  const workshop=readFileSync(new URL('../merge/story/workshop.mjs',import.meta.url),'utf8');
  for(const ui of [story,workshop]){
    assert.ok(ui.includes('shouldBlockStoryStorageEvent(event,'));
    assert.ok(ui.includes('}else if(shouldRefreshStoryDependencyEvent(event,'));
    assert.ok(ui.includes("if($('story-dialog').open)$('story-dialog').close();")||ui.includes('selected=-1;render();'));
    assert.equal(ui.includes('localStorage.setItem'),false);
  }
  assert.ok(story.includes('ownKey:STORY_SAVE_KEY,dependencyKey:STORY_WORKSHOP_KEY,storage:store'));
  assert.ok(story.includes("selectedChoice=null;\n    if($('story-dialog').open)$('story-dialog').close();\n    render();"));
  assert.ok(workshop.includes('shouldRefreshWorkshopForStoryEvent(event,storage)'));
  assert.equal(workshop.includes('SAVE_KEY'),false,'normal-mode key and overlapping name must not enter workshop UI');
});
