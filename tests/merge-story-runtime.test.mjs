import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmptyStoryProgress,validateStoryProgress,STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {availableStoryEntries,completedStoryEntries,completeStoryEntry,startCoreStory,dailyStoryIncident,validateStoryPack} from '../merge/story/runtime.mjs';
import {readStorySave,writeStorySave} from '../merge/story/local-storage.mjs';
const fresh=()=>startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);
const storage=()=>{const map=new Map();return {
  getItem:key=>map.has(key)?map.get(key):null,
  setItem:(key,value)=>map.set(key,value),map
};};
test('V1 core pack validates and contains four chapters, independent side quests and incidents',()=>{
  assert.equal(validateStoryPack(CORE_STORY_PACK),true);
  assert.equal(CORE_STORY_PACK.entries.filter(x=>x.kind==='main').length,12);
  assert.ok(CORE_STORY_PACK.entries.filter(x=>x.kind==='side').length>=6);
  assert.ok(CORE_STORY_PACK.entries.filter(x=>x.kind==='incident').length>=6);
  assert.equal(new Set(CORE_STORY_PACK.entries.filter(x=>x.kind==='main').map(x=>x.chapter)).size,4);
});
test('story starts without coins, xp, energy, inventory or normal-mode mutation',()=>{
  const original=createEmptyStoryProgress(),snapshot=structuredClone(original);
  const save=fresh();assert.deepEqual(original,snapshot);
  assert.ok(validateStoryProgress(save));
  for(const field of ['coins','energy','xp','board','bag','shop'])assert.ok(!Object.hasOwn(save,field));
  assert.equal(availableStoryEntries(save,CORE_STORY_PACK,'main')[0].id,'arrival');
  assert.equal(save.packs.core.completed.main.length,0);
});
test('ordered mainline progression prevents skipping, records a choice, and does not repeat rewards',()=>{
  let save=fresh();
  assert.throws(()=>completeStoryEntry(save,CORE_STORY_PACK,'ledger'),RangeError);
  assert.throws(()=>completeStoryEntry(save,CORE_STORY_PACK,'arrival'),RangeError);
  assert.throws(()=>completeStoryEntry(save,CORE_STORY_PACK,'arrival','bad-choice'),RangeError);
  const first=completeStoryEntry(save,CORE_STORY_PACK,'arrival','help');
  assert.equal(save.packs.core.completed.main.length,0);
  assert.equal(first.packs.core.choices.arrival,'help');
  assert.equal(completeStoryEntry(first,CORE_STORY_PACK,'arrival','ask'),first);
  assert.equal(availableStoryEntries(first,CORE_STORY_PACK,'main')[0].id,'signboard');
  save=first;
  for(const item of CORE_STORY_PACK.entries.filter(x=>x.kind==='main').slice(1)){
    const choice=item.choices[0]?.id??null;
    save=completeStoryEntry(save,CORE_STORY_PACK,item.id,choice);
  }
  assert.equal(save.packs.core.completed.main.length,12);
  assert.equal(availableStoryEntries(save,CORE_STORY_PACK,'main').length,0);
  assert.equal(completedStoryEntries(save,CORE_STORY_PACK,'main').length,12);
  assert.equal(validateStoryProgress(save),true);
});
test('side quests are optional and do not block mainline',()=>{
  let save=fresh();
  for(const item of CORE_STORY_PACK.entries.filter(x=>x.kind==='main').slice(0,6)){
    save=completeStoryEntry(save,CORE_STORY_PACK,item.id,item.choices[0]?.id??null);
  }
  assert.ok(availableStoryEntries(save,CORE_STORY_PACK,'side').some(x=>x.id==='wrong-letter'));
  assert.equal(save.packs.core.completed.side.length,0);
  assert.equal(availableStoryEntries(save,CORE_STORY_PACK,'main')[0].id,'tea-table');
});
test('daily event remains deterministic per day; completion cannot manufacture rewards',()=>{
  let save=fresh();
  for(const item of CORE_STORY_PACK.entries.filter(x=>x.kind==='main').slice(0,10))
    save=completeStoryEntry(save,CORE_STORY_PACK,item.id,item.choices[0]?.id??null);
  const event=dailyStoryIncident(save,CORE_STORY_PACK,'2026-10-23');
  assert.equal(dailyStoryIncident(save,CORE_STORY_PACK,'2026-10-23').id,event.id);
  const done=completeStoryEntry(save,CORE_STORY_PACK,event.id,event.choices[0]?.id??null);
  assert.equal(completeStoryEntry(done,CORE_STORY_PACK,event.id,event.choices[0]?.id??null),done);
  assert.equal(done.packs.core.completed.incident.length,1);
  assert.equal(done.packs.core.completed.main.length,10);
});
test('malformed pack, bogus IDs and attempts at bypass are rejected',()=>{
  const pack=structuredClone(CORE_STORY_PACK);
  pack.entries.push({...pack.entries[0],id:'arrival'});
  assert.equal(validateStoryPack(pack),false);
  assert.throws(()=>availableStoryEntries(fresh(),pack),TypeError);
  assert.throws(()=>completeStoryEntry(fresh(),CORE_STORY_PACK,'__proto__'),RangeError);
  assert.throws(()=>dailyStoryIncident(fresh(),CORE_STORY_PACK,'bad-date'),TypeError);
});
test('storage fail closed: corrupt original preserved, no silent overwrite',()=>{
  const db=storage();db.setItem(STORY_SAVE_KEY,'{broken}');
  const loaded=readStorySave(db);
  assert.equal(loaded.blocked,true);
  assert.equal(loaded.reason,'CORRUPT_SAVE');
  assert.equal(db.getItem(STORY_SAVE_KEY),'{broken}');
  assert.equal(writeStorySave(db,fresh(),{expectedRaw:loaded.raw}),false);
  assert.equal(db.getItem(STORY_SAVE_KEY),'{broken}');
});
test('story storage CAS blocks stale tab and preserves normal namespace',()=>{
  const db=storage();
  const initial=readStorySave(db);
  const save=fresh();
  assert.equal(writeStorySave(db,save,{expectedRaw:initial.raw}),true);
  const raw=db.getItem(STORY_SAVE_KEY);
  const next=completeStoryEntry(save,CORE_STORY_PACK,'arrival','ask');
  assert.equal(writeStorySave(db,next,{expectedRaw:null}),false);
  assert.equal(db.getItem(STORY_SAVE_KEY),raw);
  assert.equal(writeStorySave(db,next,{expectedRaw:raw}),true);
  assert.equal(db.getItem('toolbox.merge-isle.local.v1'),null);
  assert.deepEqual(readStorySave(db).progress,next);
  assert.equal(writeStorySave(db,save,{expectedRaw:db.getItem(STORY_SAVE_KEY)}),false);
});
test('explicit reset is the only path to replacing a damaged story save',()=>{
  const db=storage();db.setItem(STORY_SAVE_KEY,'bad');
  const blank=createEmptyStoryProgress();
  assert.equal(writeStorySave(db,blank,{expectedRaw:'bad'}),false);
  assert.equal(writeStorySave(db,blank,{expectedRaw:'bad',confirmedReset:true}),true);
  assert.ok(validateStoryProgress(readStorySave(db).progress));
});
