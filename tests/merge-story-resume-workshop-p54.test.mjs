import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkStoryResumeSnapshot} from '../merge/story/resume-guard.mjs';
import {STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';

// P54: A suspended main/side dialogue may have missed a workshop StorageEvent.
// Its cached choices/echoes are safe to retain only for an unchanged raw save.
function fixture(initial=null){
  const data=new Map();
  if(initial!==null)data.set(STORY_WORKSHOP_KEY,initial);
  let writes=0;
  const storage={
    getItem(key){return data.has(key)?data.get(key):null;},
    setItem(){writes++;throw Error('resume must be read-only');}
  };
  return {data,storage,get writes(){return writes;}};
}
const check=(f,raw)=>checkStoryResumeSnapshot(f.storage,{
  key:STORY_WORKSHOP_KEY,expectedRaw:raw
});

test('P54 unchanged workshop snapshot permits retaining a resumed dialogue',()=>{
  const f=fixture('{"revision":4,"coins":7}');
  assert.equal(check(f,'{"revision":4,"coins":7}').ok,true);
  assert.equal(check(f,'{"revision":4,"coins":7}').ok,true);
  assert.equal(f.writes,0);
});

test('P54 missed workshop event invalidates a stale dialogue without writing',()=>{
  const f=fixture('{"revision":4,"coins":7}');
  f.data.set(STORY_WORKSHOP_KEY,'{"revision":5,"coins":7}');
  assert.equal(check(f,'{"revision":4,"coins":7}').reason,'WRITE_CONFLICT');
  f.data.set(STORY_WORKSHOP_KEY,'{"revision":4,"coins":8}');
  assert.equal(check(f,'{"revision":4,"coins":7}').reason,'WRITE_CONFLICT');
  assert.equal(f.writes,0);
});

test('P54 workshop creation and removal while backgrounded invalidate snapshot',()=>{
  const absent=fixture();
  absent.data.set(STORY_WORKSHOP_KEY,'{"revision":1}');
  assert.equal(check(absent,null).ok,false);
  const removed=fixture('{"revision":2}');
  removed.data.delete(STORY_WORKSHOP_KEY);
  assert.equal(check(removed,'{"revision":2}').ok,false);
  assert.equal(absent.writes+removed.writes,0);
});

test('P54 unavailable workshop storage fails closed on resume',()=>{
  assert.equal(checkStoryResumeSnapshot({getItem(){throw Error('denied');}},{
    key:STORY_WORKSHOP_KEY,expectedRaw:null
  }).reason,'STORAGE_UNAVAILABLE');
});

test('P54 story UI captures and rechecks workshop snapshot before preserving dialogue',()=>{
  const ui=readFileSync(new URL('../merge/story/ui.mjs',import.meta.url),'utf8');
  assert.ok(ui.includes('const workshopAtOpen=readStoryWorkshop(store);'));
  assert.ok(ui.includes('selectedWorkshopRaw=workshopAtOpen.raw;'));
  assert.ok(ui.includes('selectedWorkshopReadable=!workshopAtOpen.blocked;'));
  assert.ok(ui.includes("if(snapshotOk&&$('story-dialog').open&&selected&&"));
  assert.ok(ui.includes("(selected.kind==='main'||selected.kind==='side')"));
  assert.ok(ui.includes('snapshotOk=selectedWorkshopReadable&&'));
  assert.ok(ui.includes('checkStoryResumeSnapshot(store,{key:STORY_WORKSHOP_KEY,expectedRaw:selectedWorkshopRaw}).ok;'));
  assert.ok(ui.includes('const keepDialog=canKeepResumedStoryDialogue({'));
  assert.ok(ui.includes('if(!keepDialog){'));
  assert.equal(ui.includes('innerHTML'),false);
});
