import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {captureStoryWorkshopEvidence,MAX_STORY_EVIDENCE_CHARS} from '../merge/story/save-evidence.mjs';
import {STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
const storage=()=>{
  const data=new Map([[STORY_WORKSHOP_KEY,'{ damaged 🏝️'],[SAVE_KEY,'normal save']]);
  return {data,getItem:key=>data.has(key)?data.get(key):null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
};
test('P9 evidence capture needs explicit consent, preserves exact text and never modifies normal save',()=>{
  const store=storage(),raw=store.getItem(STORY_WORKSHOP_KEY);
  assert.equal(captureStoryWorkshopEvidence(store,{key:STORY_WORKSHOP_KEY,expectedRaw:raw}).code,'CONSENT_REQUIRED');
  assert.equal(captureStoryWorkshopEvidence(store,{key:STORY_WORKSHOP_KEY,expectedRaw:null,confirmedByUser:true}).code,'NO_SNAPSHOT');
  assert.deepEqual(captureStoryWorkshopEvidence(store,{key:STORY_WORKSHOP_KEY,expectedRaw:raw,confirmedByUser:true}),{ok:true,code:'OK',content:raw});
  assert.equal(store.getItem(STORY_WORKSHOP_KEY),raw);
  assert.equal(store.getItem(SAVE_KEY),'normal save');
});
test('P9 rejects a stale, deleted, unreadable or oversized evidence snapshot without writes',()=>{
  const store=storage(),raw=store.getItem(STORY_WORKSHOP_KEY);
  store.setItem(STORY_WORKSHOP_KEY,'another tab changed this');
  assert.equal(captureStoryWorkshopEvidence(store,{key:STORY_WORKSHOP_KEY,expectedRaw:raw,confirmedByUser:true}).code,'STALE_SNAPSHOT');
  store.removeItem(STORY_WORKSHOP_KEY);
  assert.equal(captureStoryWorkshopEvidence(store,{key:STORY_WORKSHOP_KEY,expectedRaw:raw,confirmedByUser:true}).code,'STALE_SNAPSHOT');
  assert.equal(captureStoryWorkshopEvidence({getItem(){throw Error('private browsing denied');}},{key:STORY_WORKSHOP_KEY,expectedRaw:raw,confirmedByUser:true}).code,'STORAGE_UNAVAILABLE');
  const huge='x'.repeat(MAX_STORY_EVIDENCE_CHARS+1);
  store.setItem(STORY_WORKSHOP_KEY,huge);
  assert.equal(captureStoryWorkshopEvidence(store,{key:STORY_WORKSHOP_KEY,expectedRaw:huge,confirmedByUser:true}).code,'TOO_LARGE');
  assert.equal(store.getItem(SAVE_KEY),'normal save');
});
test('P9 recovery UI is opt-in, offline and does not claim a successful device download',()=>{
  const html=readFileSync(new URL('../merge/story-workshop.html',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../merge/story/workshop.mjs',import.meta.url),'utf8');
  assert.ok(html.includes('id="export-corrupt-workshop"'));
  assert.ok(ui.includes("reason!=='CORRUPT_SAVE'||typeof raw!=='string'"));
  assert.ok(ui.includes('captureStoryWorkshopEvidence(storage,{key:STORY_WORKSHOP_KEY,expectedRaw:raw,confirmedByUser:true})'));
  assert.ok(ui.includes('URL.createObjectURL'));
  assert.ok(ui.includes('已尝试下载'));
  assert.ok(ui.includes("if(reason==='CORRUPT_SAVE'&&!window.confirm"));
  for(const dangerous of ['innerHTML','insertAdjacentHTML','fetch(','sendBeacon(','SAVE_KEY','localStorage.setItem'])
    assert.equal(ui.includes(dangerous),false,dangerous);
});

test('P10 damaged narrative save can be captured only with consent and exact snapshot',()=>{
  const store=storage(),raw='{ broken narrative 🏝️';
  store.setItem(STORY_SAVE_KEY,raw);
  assert.equal(captureStoryWorkshopEvidence(store,{key:STORY_SAVE_KEY,expectedRaw:raw}).code,'CONSENT_REQUIRED');
  assert.deepEqual(captureStoryWorkshopEvidence(store,{key:STORY_SAVE_KEY,expectedRaw:raw,confirmedByUser:true}),
    {ok:true,code:'OK',content:raw});
  assert.equal(store.getItem(STORY_SAVE_KEY),raw);
  assert.equal(store.getItem(STORY_WORKSHOP_KEY),'{ damaged 🏝️');
  assert.equal(store.getItem(SAVE_KEY),'normal save');
  store.setItem(STORY_SAVE_KEY,'changed in another tab');
  assert.equal(captureStoryWorkshopEvidence(store,{key:STORY_SAVE_KEY,expectedRaw:raw,confirmedByUser:true}).code,'STALE_SNAPSHOT');
  assert.equal(store.getItem(STORY_SAVE_KEY),'changed in another tab');
});
test('P10 narrative export UI is opt-in, offline, and warns before damaged reset',()=>{
  const html=readFileSync(new URL('../merge/story.html',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../merge/story/ui.mjs',import.meta.url),'utf8');
  assert.ok(html.includes('id="export-corrupt-story"'));
  assert.ok(ui.includes("reason!=='CORRUPT_SAVE'||typeof raw!=='string'"));
  assert.ok(ui.includes('captureStoryWorkshopEvidence(store,{key:STORY_SAVE_KEY,expectedRaw:raw,confirmedByUser:true})'));
  assert.ok(ui.includes('URL.createObjectURL'));
  assert.ok(ui.includes('已尝试下载异常对白记录'));
  assert.ok(ui.includes("if(reason==='CORRUPT_SAVE'&&!window.confirm"));
  for(const dangerous of ['innerHTML','insertAdjacentHTML','fetch(','sendBeacon(','localStorage.setItem'])
    assert.equal(ui.includes(dangerous),false,dangerous);
});
