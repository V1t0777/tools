import test from 'node:test';
import assert from 'node:assert/strict';
import {storyDialogueWorkshopSnapshotCurrent as current} from '../merge/story/workshop-dialogue-snapshot.mjs';
import {readStoryWorkshop,STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';
import {createInitialState} from '../merge/engine.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {readFileSync} from 'node:fs';

function fixture(raw){
  const values=new Map([[STORY_WORKSHOP_KEY,raw],
    [STORY_SAVE_KEY,'dialogue-sentinel'],[SAVE_KEY,'normal-sentinel']]);
  const writes=[];
  const storage={
    getItem:key=>values.has(key)?values.get(key):null,
    setItem(key,value){writes.push(key);values.set(key,value);}
  };
  return {values,writes,storage};
}

test('P91 unchanged damaged workshop still permits independent story scenes',()=>{
  const broken='{damaged'+String.fromCharCode(0xd800);
  const {storage,writes}=fixture(broken);
  const opened=readStoryWorkshop(storage);
  assert.equal(opened.reason,'CORRUPT_SAVE');
  assert.equal(current(opened,readStoryWorkshop(storage)),true);
  assert.deepEqual(writes,[]);
});

test('P91 peer repair of unreadable workshop invalidates already-open dialogue',()=>{
  const broken='{damaged'+String.fromCharCode(0xdc00);
  const {values,storage,writes}=fixture(broken);
  const opened=readStoryWorkshop(storage);
  values.set(STORY_WORKSHOP_KEY,JSON.stringify(createInitialState(1_000_000)));
  assert.equal(readStoryWorkshop(storage).blocked,false);
  assert.equal(current(opened,readStoryWorkshop(storage)),false);
  assert.equal(values.get(STORY_SAVE_KEY),'dialogue-sentinel');
  assert.equal(values.get(SAVE_KEY),'normal-sentinel');
  assert.deepEqual(writes,[]);
});

test('P91 changed corrupt bytes and unavailable storage invalidate old consent',()=>{
  const {values,storage,writes}=fixture('{bad-one');
  const opened=readStoryWorkshop(storage);
  values.set(STORY_WORKSHOP_KEY,'{bad-two');
  assert.equal(current(opened,readStoryWorkshop(storage)),false);
  const denied={getItem(){throw Error('storage blocked');},setItem(){throw Error('storage blocked');}};
  assert.equal(current(opened,readStoryWorkshop(denied)),false);
  assert.deepEqual(writes,[]);
});

test('P91 previously healthy or absent workshop still requires exact raw bytes',()=>{
  const {values,storage,writes}=fixture(null);
  values.delete(STORY_WORKSHOP_KEY);
  const opened=readStoryWorkshop(storage);
  assert.equal(opened.blocked,false);
  assert.equal(current(opened,readStoryWorkshop(storage)),true);
  values.set(STORY_WORKSHOP_KEY,JSON.stringify(createInitialState(1_000_000)));
  assert.equal(current(opened,readStoryWorkshop(storage)),false);
  assert.deepEqual(writes,[]);
});

test('P91 real story UI rechecks unreadable workshop at choice and commit',()=>{
  const ui=readFileSync(new URL('../merge/story/ui.mjs',import.meta.url),'utf8');
  assert.ok(ui.includes("import {storyDialogueWorkshopSnapshotCurrent} from './workshop-dialogue-snapshot.mjs'"));
  assert.ok(ui.includes('return storyDialogueWorkshopSnapshotCurrent('));
  assert.ok(ui.includes('if(!openWorkshopCurrent())'));
  assert.ok(ui.includes('const commitGuard=()=>openWorkshopCurrent()'));
});
