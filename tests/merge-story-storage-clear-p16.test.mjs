import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {shouldBlockStoryStorageEvent} from '../merge/story/storage-event-guard.mjs';
import {STORY_WORKSHOP_KEY,readStoryWorkshop,writeStoryWorkshop} from '../merge/story/workshop-storage.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {createInitialState,moveOrMerge} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';

test('P16 cross-tab clear() invalidates both story views, including previously empty saves',()=>{
  const storage={};
  for(const key of [STORY_SAVE_KEY,STORY_WORKSHOP_KEY]){
    assert.equal(shouldBlockStoryStorageEvent({key:null,storageArea:storage},{key,storage}),true);
    assert.equal(shouldBlockStoryStorageEvent({key,storageArea:storage},{key,storage}),true);
    assert.equal(shouldBlockStoryStorageEvent({key:'unrelated-key',storageArea:storage},{key,storage}),false);
    assert.equal(shouldBlockStoryStorageEvent({key:SAVE_KEY,storageArea:storage},{key,storage}),false);
    assert.equal(shouldBlockStoryStorageEvent({key:null,storageArea:{}},{key,storage}),false,'unrelated sessionStorage.clear must not block');
  }
});
test('P16 malformed events and unexpected key selectors never read or touch unrelated storage',()=>{
  const storage={getItem(){throw Error('must not read');},setItem(){throw Error('must not write');}};
  assert.equal(shouldBlockStoryStorageEvent(null,{key:STORY_SAVE_KEY,storage}),false);
  assert.equal(shouldBlockStoryStorageEvent({key:null},{key:'not-story',storage}),false);
  assert.equal(shouldBlockStoryStorageEvent({key:undefined},{key:STORY_SAVE_KEY,storage}),false);
  assert.equal(shouldBlockStoryStorageEvent({key:null},{key:STORY_SAVE_KEY,storage}),true);
});
test('P16 replay of a stale workshop snapshot after another tab clears cannot silently save',()=>{
  const data=new Map();
  const storage={
    getItem(key){return data.has(key)?data.get(key):null;},
    setItem(key,val){data.set(key,val);},
    clear(){data.clear();}
  };
  const initial=createInitialState(1000000);
  assert.equal(writeStoryWorkshop(storage,initial,{expectedRaw:null}),true);
  const tabA=readStoryWorkshop(storage,1000000);
  const action=moveOrMerge(tabA.state,0,2);
  assert.equal(action.ok,true);
  storage.clear();
  assert.equal(shouldBlockStoryStorageEvent({key:null,storageArea:storage},{key:STORY_WORKSHOP_KEY,storage}),true);
  assert.equal(writeStoryWorkshop(storage,action.state,{expectedRaw:tabA.raw}),false);
  assert.equal(storage.getItem(STORY_WORKSHOP_KEY),null);
  assert.equal(storage.getItem(SAVE_KEY),null);
});
test('P16 UI invalidates queued actions and closes stale dialogue after cross-tab clear()',()=>{
  const workshop=readFileSync(new URL('../merge/story/workshop.mjs',import.meta.url),'utf8');
  const dialogue=readFileSync(new URL('../merge/story/ui.mjs',import.meta.url),'utf8');
  for(const file of [workshop,dialogue]){
    assert.ok(file.includes("import {shouldBlockStoryStorageEvent} from './storage-event-guard.mjs';"));
    assert.ok(file.includes("window.addEventListener('storage',event=>{"));
    assert.ok(file.includes('shouldBlockStoryStorageEvent(event,'));
  }
  assert.ok(workshop.includes('async function commit(result){\n  // One in-flight action'));
  assert.ok(workshop.includes('if(!revalidateWorkshopBeforeInteraction())return;\n  if(!result.ok)'),
    'the P64 preflight must cancel stale actions before engine result handling');
  assert.ok(workshop.includes("selected=-1;render();"));
  assert.ok(dialogue.includes("if(blocked&&!reset)return false;"));
  assert.ok(dialogue.includes("selectedChoice=null;"));
  assert.ok(dialogue.includes("if($('story-dialog').open)$('story-dialog').close();"));
  for(const dangerous of ['innerHTML','insertAdjacentHTML','fetch(','sendBeacon(','SAVE_KEY'])
    assert.equal(workshop.includes(dangerous),false,dangerous);
});
