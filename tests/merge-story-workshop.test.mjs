import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState,createInitialState as createNormal,moveOrMerge,fulfillOrder,upgradeBuilding,validateSave} from '../merge/engine.mjs';
import {STORY_WORKSHOP_KEY,readStoryWorkshop,writeStoryWorkshop} from '../merge/story/workshop-storage.mjs';
import {storyWorkshopRequirement,inspectStoryWorkshopRequirement,storyGardenBuildAvailable} from '../merge/story/workshop-gate.mjs';
import {createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry} from '../merge/story/runtime.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
const db=()=>{const map=new Map();return {map,getItem:key=>map.has(key)?map.get(key):null,setItem:(key,val)=>map.set(key,val)};};
test('new story workshop is a valid independently initialized 7x8 game',()=>{
 const storage=db();const loaded=readStoryWorkshop(storage,1000000);
 assert.equal(loaded.blocked,false);assert.equal(loaded.state.board.length,56);
 assert.equal(validateSave(loaded.state),true);
 assert.equal(storyWorkshopRequirement('first-order',loaded.state).met,false);
 assert.equal(storyWorkshopRequirement('arrival',null).met,true);
 assert.equal(storyWorkshopRequirement('tea-table',loaded.state).met,false);
 assert.notEqual(STORY_WORKSHOP_KEY,SAVE_KEY);
});
test('actual story-only fulfillment unlocks first-order without transferring normal economy',()=>{
 const storage=db();const normal=createNormal(1000000);
 storage.setItem(SAVE_KEY,JSON.stringify(normal));const before=storage.getItem(SAVE_KEY);
 let state=createInitialState(1000000);
 const order=state.orders[0],slot=state.board.findIndex(x=>x?.kind==='material'&&x.chain===order.chain&&x.tier===order.tier);
 if(slot<0){const empty=state.board.findIndex(x=>!x);assert.ok(empty>=0);state.board[empty]={id:'m'+state.nextId++,kind:'material',chain:order.chain,tier:order.tier};}
 const result=fulfillOrder(state,order.id);assert.equal(result.ok,true);
 assert.equal(storyWorkshopRequirement('first-order',result.state).met,true);
 assert.equal(writeStoryWorkshop(storage,result.state,{expectedRaw:null}),true);
 assert.equal(inspectStoryWorkshopRequirement('first-order',storage).met,true);
 assert.equal(storage.getItem(SAVE_KEY),before);
});
test('stale tabs, corrupt saves, invalid state, failed writes and old revisions block',()=>{
 const storage=db();let save=createInitialState(1000000);
 assert.equal(writeStoryWorkshop(storage,save,{expectedRaw:undefined}),false);
 assert.equal(writeStoryWorkshop(storage,save,{expectedRaw:null}),true);
 const before=storage.getItem(STORY_WORKSHOP_KEY);
 assert.equal(writeStoryWorkshop(storage,save,{expectedRaw:before}),false);
 const moved=moveOrMerge(save,0,2);assert.equal(moved.ok,true);
 assert.equal(writeStoryWorkshop(storage,moved.state,{expectedRaw:null}),false);
 assert.equal(writeStoryWorkshop(storage,moved.state,{expectedRaw:before}),true);
 storage.setItem(STORY_WORKSHOP_KEY,'broken!');
 assert.equal(readStoryWorkshop(storage).reason,'CORRUPT_SAVE');
 assert.equal(inspectStoryWorkshopRequirement('first-order',storage).blocked,true);
 assert.equal(writeStoryWorkshop(storage,moved.state,{expectedRaw:'broken!'}),false);
 assert.equal(storage.getItem(STORY_WORKSHOP_KEY),'broken!');
 assert.equal(writeStoryWorkshop(storage,save,{expectedRaw:'broken!',confirmedReset:true}),true);
});
test('story workshop UI uses own state writer and a genuine engine, not normal save',()=>{
 const html=readFileSync(new URL('../merge/story-workshop.html',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../merge/story/workshop.mjs',import.meta.url),'utf8');
 const story=readFileSync(new URL('../merge/story/ui.mjs',import.meta.url),'utf8');
 for(const id of ['workshop-board','workshop-orders','reset-workshop','workshop-status'])assert.ok(html.includes('id="'+id+'"'));
 assert.ok(story.includes('inspectStoryWorkshopRequirement(selected.id,store)'));
 assert.ok(ui.includes('fulfillOrder(state,order.id)'));
 assert.ok(ui.includes('readStoryWorkshop(storage)'));
 for(const dangerous of ['innerHTML','insertAdjacentHTML','fetch(','sendBeacon(','localStorage.setItem','SAVE_KEY'])
   assert.equal(ui.includes(dangerous),false,dangerous);
});

test('second chapter tea-table requires actual garden construction, not order count',()=>{
  const storage=db();
  const state=createInitialState(1000000);
  assert.equal(storyWorkshopRequirement('tea-table',state).required,true);
  assert.equal(storyWorkshopRequirement('tea-table',state).description,'修复后院花园');
  assert.equal(storyWorkshopRequirement('tea-table',null).met,false);
  assert.equal(inspectStoryWorkshopRequirement('tea-table',storage).met,false);
  const delivered=fulfillOrder(state,state.orders[0].id);
  assert.equal(delivered.ok,true);
  const prepared=structuredClone(delivered.state);
  prepared.xp=200;prepared.coins=160;
  assert.equal(validateSave(prepared),true);
  assert.equal(storyWorkshopRequirement('tea-table',prepared).met,false);
  const upgrade=upgradeBuilding(prepared,'garden');
  assert.equal(upgrade.ok,true);
  assert.equal(upgrade.state.buildings.garden,1);
  assert.equal(upgrade.state.coins,0);
  assert.equal(storyWorkshopRequirement('tea-table',upgrade.state).met,true);
  assert.equal(writeStoryWorkshop(storage,upgrade.state,{expectedRaw:null}),true);
  assert.equal(inspectStoryWorkshopRequirement('tea-table',storage).met,true);
  assert.equal(storyWorkshopRequirement('first-order',upgrade.state).met,true);
  storage.setItem(STORY_WORKSHOP_KEY,'invalid');
  assert.equal(inspectStoryWorkshopRequirement('tea-table',storage).met,false);
  assert.equal(inspectStoryWorkshopRequirement('tea-table',storage).blocked,true);
});
test('chapter-two UI exposes real building action and mobile-safe touch targets',()=>{
  const html=readFileSync(new URL('../merge/story-workshop.html',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../merge/story/workshop.mjs',import.meta.url),'utf8');
  const css=readFileSync(new URL('../merge/story/workshop.css',import.meta.url),'utf8');
  const story=readFileSync(new URL('../merge/story/ui.mjs',import.meta.url),'utf8');
  for(const id of ['build-garden','garden-status','garden-hint'])assert.ok(html.includes('id="'+id+'"'));
  assert.ok(ui.includes("commit(upgradeBuilding(state,'garden'))"));
  assert.ok(story.includes("requirement.description"));
  assert.ok(css.includes('min-width:44px'));
  assert.ok(css.includes('min-height:44px'));
  assert.ok(css.includes('overflow-x:auto'));
  assert.ok(html.includes('可横向滚动的合成棋盘'));
});

test('garden construction requires chapter-two seed conversation before any spend',()=>{
  let story=startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);
  assert.equal(storyGardenBuildAvailable(story),false);
  const chapters=CORE_STORY_PACK.entries.filter(e=>e.kind==='main').slice(0,6);
  for(const entry of chapters.slice(0,5)){
    story=completeStoryEntry(story,CORE_STORY_PACK,entry.id,entry.choices[0]?.id??null);
  }
  assert.equal(storyGardenBuildAvailable(story),false);
  const seed=chapters[5];
  story=completeStoryEntry(story,CORE_STORY_PACK,seed.id,seed.choices[0]?.id??null);
  assert.equal(storyGardenBuildAvailable(story),true);
  const invalid=structuredClone(story);invalid.revision=-1;
  assert.equal(storyGardenBuildAvailable(invalid),false);
  const ui=readFileSync(new URL('../merge/story/workshop.mjs',import.meta.url),'utf8');
  assert.ok(ui.includes('!gardenStoryReady'));
  assert.ok(ui.includes("!storyGardenBuildAvailable(story.progress)"));
});
