import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEmptyStoryProgress,STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry,pinDailyStoryIncident,pinnedDailyStoryIncident,dailyStoryIncident} from '../merge/story/runtime.mjs';
import {saveStoryDialogueWithLock} from '../merge/story/dialogue-write.mjs';
import {readStorySave} from '../merge/story/local-storage.mjs';

const pack=CORE_STORY_PACK;
const yesterday='2026-10-25',today='2026-10-26';
const lockName='toolbox.merge-isle.story.write.'+STORY_SAVE_KEY;
function firstIncidentUnlocked(){
  let save=startCoreStory(createEmptyStoryProgress(),pack);
  save=completeStoryEntry(save,pack,'arrival','help');
  return completeStoryEntry(save,pack,'signboard');
}
function storage(initial){
  const values=new Map([[STORY_SAVE_KEY,JSON.stringify(initial)],
    [SAVE_KEY,'normal-untouched'],[STORY_WORKSHOP_KEY,'workshop-untouched']]);
  const writes=[];
  return {writes,
    getItem(key){return values.has(key)?values.get(key):null;},
    setItem(key,value){writes.push(key);values.set(key,value);}
  };
}
function locks(){
  let tail=Promise.resolve();
  const calls=[];
  return {calls,request(name,options,callback){
    assert.equal(name,lockName);
    assert.equal(options.mode,'exclusive');
    calls.push(name);
    const pending=tail.then(callback);
    tail=pending.catch(()=>{});
    return pending;
  }};
}
function assertIsolation(db){
  assert.equal(db.getItem(SAVE_KEY),'normal-untouched');
  assert.equal(db.getItem(STORY_WORKSHOP_KEY),'workshop-untouched');
  assert.ok(db.writes.every(key=>key===STORY_SAVE_KEY));
}

test('P48 two lock-queued daily claims from the same raw baseline cannot both write',async()=>{
  const initial=firstIncidentUnlocked(),db=storage(initial),webLocks=locks();
  const raw=db.getItem(STORY_SAVE_KEY);
  const next=pinDailyStoryIncident(initial,pack,yesterday);
  const [first,second]=await Promise.all([
    saveStoryDialogueWithLock(webLocks,db,next,{expectedRaw:raw}),
    saveStoryDialogueWithLock(webLocks,db,next,{expectedRaw:raw})
  ]);
  assert.deepEqual([first.value,second.value],[true,false]);
  assert.ok(first.ok&&second.ok);
  assert.equal(db.writes.length,1);
  assert.equal(webLocks.calls.length,2);
  assert.equal(readStorySave(db).progress.revision,initial.revision+1);
  assert.equal(pinnedDailyStoryIncident(readStorySave(db).progress,pack,yesterday),true);
  assertIsolation(db);
});

test('P48 old-day pin waiting behind another tab is refused inside the lock',async()=>{
  const initial=firstIncidentUnlocked(),db=storage(initial),webLocks=locks();
  const raw=db.getItem(STORY_SAVE_KEY),oldPin=pinDailyStoryIncident(initial,pack,yesterday);
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const blocker=webLocks.request(lockName,{mode:'exclusive'},()=>gate);
  let day=yesterday,checks=0;
  const pending=saveStoryDialogueWithLock(webLocks,db,oldPin,{
    expectedRaw:raw,commitGuard:()=>{checks++;return day===yesterday;}
  });
  day=today;
  release();
  await blocker;
  const expired=await pending;
  assert.equal(expired.ok,true);
  assert.equal(expired.value,false);
  assert.equal(checks,1,'date guard must run inside the acquired lock');
  assert.equal(db.getItem(STORY_SAVE_KEY),raw);
  assert.deepEqual(db.writes,[]);
  const freshPin=pinDailyStoryIncident(initial,pack,today);
  const fresh=await saveStoryDialogueWithLock(webLocks,db,freshPin,{
    expectedRaw:raw,commitGuard:()=>day===today
  });
  assert.equal(fresh.value,true);
  assert.equal(pinnedDailyStoryIncident(readStorySave(db).progress,pack,today),true);
  assert.equal(pinnedDailyStoryIncident(readStorySave(db).progress,pack,yesterday),false);
  assertIsolation(db);
});

test('P48 competing chapter write cannot be overwritten by a queued day pin',async()=>{
  const initial=firstIncidentUnlocked(),db=storage(initial),webLocks=locks();
  const raw=db.getItem(STORY_SAVE_KEY);
  const chapter=completeStoryEntry(initial,pack,'first-order','listen');
  const pinned=pinDailyStoryIncident(initial,pack,yesterday);
  const [chapterSave,daySave]=await Promise.all([
    saveStoryDialogueWithLock(webLocks,db,chapter,{expectedRaw:raw}),
    saveStoryDialogueWithLock(webLocks,db,pinned,{expectedRaw:raw})
  ]);
  assert.equal(chapterSave.value,true);
  assert.equal(daySave.value,false);
  assert.equal(db.getItem(STORY_SAVE_KEY),JSON.stringify(chapter));
  assert.equal(pinnedDailyStoryIncident(readStorySave(db).progress,pack,yesterday),false);
  const fresh=pinDailyStoryIncident(readStorySave(db).progress,pack,yesterday);
  assert.equal((await saveStoryDialogueWithLock(webLocks,db,fresh,{
    expectedRaw:db.getItem(STORY_SAVE_KEY)
  })).value,true);
  assert.equal(db.writes.length,2);
  assertIsolation(db);
});

test('P48 malformed Web Locks and storage failures do not authorize a pin',async()=>{
  const initial=firstIncidentUnlocked(),db=storage(initial),raw=db.getItem(STORY_SAVE_KEY);
  const oldPin=pinDailyStoryIncident(initial,pack,yesterday);
  for(const broken of [{request:null},{request(){throw Error('denied');}}]){
    const result=await saveStoryDialogueWithLock(broken,db,oldPin,{expectedRaw:raw});
    assert.equal(result.ok,false);
    assert.equal(db.getItem(STORY_SAVE_KEY),raw);
  }
  const storageFailure={
    getItem(){throw Error('storage unavailable');},
    setItem(){throw Error('storage unavailable');}
  };
  const result=await saveStoryDialogueWithLock(locks(),storageFailure,oldPin,{
    expectedRaw:raw,commitGuard:()=>false
  });
  assert.equal(result.value,false);
  assert.equal(db.getItem(STORY_SAVE_KEY),raw);
  assertIsolation(db);
});

test('P48 crossing midnight prunes the old marker without mutating economy',()=>{
  const initial=firstIncidentUnlocked();
  const pinned=pinDailyStoryIncident(initial,pack,yesterday);
  assert.ok(dailyStoryIncident(pinned,pack,yesterday));
  assert.equal(pinnedDailyStoryIncident(pinned,pack,today),false);
  const after=pinDailyStoryIncident(pinned,pack,today);
  assert.equal(pinnedDailyStoryIncident(after,pack,yesterday),false);
  assert.equal(pinnedDailyStoryIncident(after,pack,today),true);
  assert.equal(after.revision,pinned.revision+1);
  assert.equal(JSON.stringify(after.packs.core.completed),JSON.stringify(pinned.packs.core.completed));
});

test('P48 UI retries only unchanged-baseline midnight cancellation and refreshes main tab',()=>{
  const ui=readFileSync(new URL('../merge/story/ui.mjs',import.meta.url),'utf8');
  assert.ok(ui.includes('pinDay!==null&&localDay()!==pinDay&&attempt.ok&&attempt.value===false&&'));
  assert.ok(ui.includes('storageEpoch===expectedEpoch&&!blocked'));
  assert.ok(ui.includes('if(!current.blocked&&current.raw===expectedRaw){render();return false;}'));
  assert.ok(ui.includes('if(!attempt.ok||attempt.value!==true||storageEpoch!==expectedEpoch||(!reset&&blocked)){'));
  assert.ok(ui.includes('if(next!==progress)await save(next,false,()=>localDay()===day,day);'));
  assert.ok(ui.includes('pinQueued=false;'));
  assert.ok(ui.includes('if(!blocked&&!saving&&localDay()!==day)render();'));
  assert.ok(ui.includes('function refreshIncidentDay(){'));
  assert.equal(ui.includes("if(kind==='incident')render();"),false);
  assert.ok(ui.includes('  render();\n}'));
  assert.ok(ui.includes('text.textContent=line.text;'));
  assert.equal(ui.includes('innerHTML'),false);
});
