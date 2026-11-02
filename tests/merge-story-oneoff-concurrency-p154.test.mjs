import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEmptyStoryProgress,STORY_SAVE_KEY,GAME_MODES,getModeSaveKey} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry,dailyStoryIncident,pinDailyStoryIncident,
  pinnedDailyStoryIncident} from '../merge/story/runtime.mjs';
import {readStorySave,writeStorySave} from '../merge/story/local-storage.mjs';
import {checkStoryResumeSnapshot} from '../merge/story/resume-guard.mjs';
import {shouldBlockStoryStorageEvent} from '../merge/story/storage-event-guard.mjs';
import {adoptConcurrentDailyPinStorageEvent,adoptConcurrentDailyPinOnResume,
  isMatchingConcurrentDailyPin} from '../merge/story/daily-pin-reconcile.mjs';
import {canCommitDailyIncident} from '../merge/story/daily-incident-guard.mjs';
import {nextCoreDailyJourney} from '../merge/story/journey-guide.mjs';

const pack=CORE_STORY_PACK;
const crate=pack.entries.find(entry=>entry.id==='old-crate');
function fixture(){
  let progress=startCoreStory(createEmptyStoryProgress(),pack);
  for(const entry of pack.entries.filter(item=>item.kind==='main')){
    progress=completeStoryEntry(progress,pack,entry.id,entry.choices[0]?.id??null);
    if(entry.id==='harbor-light')break;
  }
  const day=Array.from({length:31},(_,i)=>'2026-10-'+String(i+1).padStart(2,'0'))
    .find(key=>dailyStoryIncident(progress,pack,key)===crate);
  assert.ok(day,'a real October day must select the one-off clue');
  const pinned=pinDailyStoryIncident(progress,pack,day);
  const completed=completeStoryEntry(pinned,pack,crate.id,'register');
  const oldRaw=JSON.stringify(pinned),newRaw=JSON.stringify(completed);
  const normalKey=getModeSaveKey(GAME_MODES.NORMAL);
  const normalRaw='normal-mode-untouched';
  const data=new Map([[STORY_SAVE_KEY,oldRaw],[normalKey,normalRaw]]);
  const writes=[];
  const storage={
    getItem(key){return data.has(key)?data.get(key):null;},
    setItem(key,value){writes.push([key,value]);data.set(key,value);}
  };
  return {day,pinned,completed,oldRaw,newRaw,normalKey,normalRaw,data,writes,storage};
}
function commitPeer(f){
  assert.equal(writeStorySave(f.storage,f.completed,{expectedRaw:f.oldRaw}),true);
  assert.equal(f.storage.getItem(STORY_SAVE_KEY),f.newRaw);
  assert.equal(f.storage.getItem(f.normalKey),f.normalRaw);
}
const nextDay=day=>{
  const date=new Date(day+'T00:00:00Z');
  date.setUTCDate(date.getUTCDate()+1);
  return date.toISOString().slice(0,10);
};

test('P154 peer completion of a pinned one-off rejects the stale tab choice and preserves normal save',()=>{
  const f=fixture();
  commitPeer(f);
  const stale=completeStoryEntry(f.pinned,pack,crate.id,'ask');
  assert.equal(writeStorySave(f.storage,stale,{expectedRaw:f.oldRaw}),false);
  assert.equal(f.storage.getItem(STORY_SAVE_KEY),f.newRaw);
  assert.equal(f.storage.getItem(f.normalKey),f.normalRaw);
  assert.deepEqual(f.writes.map(([key])=>key),[STORY_SAVE_KEY]);
});

test('P154 BFCache resume rejects peer completion as a daily-pin-only change, then reads the completed clue',()=>{
  const f=fixture();
  commitPeer(f);
  assert.deepEqual(checkStoryResumeSnapshot(f.storage,{
    key:STORY_SAVE_KEY,expectedRaw:f.oldRaw
  }),{ok:false,reason:'WRITE_CONFLICT'});
  assert.equal(adoptConcurrentDailyPinOnResume(f.storage,{
    expectedRaw:f.oldRaw,day:f.day,pack
  }),null,'peer completion is not a harmless identical pin');
  const fresh=readStorySave(f.storage);
  assert.equal(fresh.blocked,false);
  assert.equal(fresh.raw,f.newRaw);
  const journey=nextCoreDailyJourney(fresh.progress,f.day);
  assert.equal(journey.kind,'story');
  assert.equal(journey.entry,crate);
  assert.equal(journey.completed,true);
  assert.equal(f.writes.length,1,'resume and journey lookup must not write');
});

test('P154 a peer StorageEvent completing the one-off cannot be passively adopted',()=>{
  const f=fixture();
  commitPeer(f);
  const event={key:STORY_SAVE_KEY,oldValue:f.oldRaw,newValue:f.newRaw,
    storageArea:f.storage};
  assert.equal(shouldBlockStoryStorageEvent(event,{
    key:STORY_SAVE_KEY,storage:f.storage
  }),true);
  assert.equal(adoptConcurrentDailyPinStorageEvent(event,{
    storage:f.storage,expectedRaw:f.oldRaw,day:f.day,pack
  }),null);
  assert.equal(isMatchingConcurrentDailyPin({
    expectedRaw:f.oldRaw,observedRaw:f.newRaw,
    proposed:f.completed,day:f.day,pack
  }),false);
  assert.equal(f.writes.length,1);
});

test('P154 next-day refresh excludes the completed one-off and forbids an overnight stale commit',()=>{
  const f=fixture();
  commitPeer(f);
  const tomorrow=nextDay(f.day);
  assert.equal(canCommitDailyIncident(crate,f.day,tomorrow,f.completed,pack),false);
  assert.equal(canCommitDailyIncident(crate,f.day,f.day,f.completed,pack),true);
  assert.equal(pinnedDailyStoryIncident(f.completed,pack,tomorrow),false);
  const next=pinDailyStoryIncident(f.completed,pack,tomorrow);
  assert.notEqual(next,f.completed);
  assert.notEqual(dailyStoryIncident(next,pack,tomorrow),crate);
  assert.equal(next.packs.core.completed.incident.filter(id=>id===crate.id).length,1);
  assert.equal(completeStoryEntry(f.completed,pack,crate.id,'ask'),f.completed);
  assert.equal(f.storage.getItem(STORY_SAVE_KEY),f.newRaw,
    'simulating a new day must not change persisted story or economy');
});

test('P154 story UI closes stale incident dialogue on page suspension and blocks foreign completion events',()=>{
  const ui=readFileSync(new URL('../merge/story/ui.mjs',import.meta.url),'utf8');
  assert.ok(ui.includes('if(!canCommitDailyIncident(selected,selectedIncidentDay,localDay(),progress,CORE_STORY_PACK)){'));
  assert.ok(ui.includes("if(selected?.kind==='incident'){"));
  assert.ok(ui.includes('const adopted=!saving&&!blocked?adoptConcurrentDailyPinStorageEvent(event,{'));
  assert.ok(ui.includes("storageEpoch++;blocked=true;reason='WRITE_CONFLICT';selectedChoice=null;"));
  assert.ok(ui.includes("window.addEventListener('pagehide',()=>suspendStoryPage({gone:true}));"));
  assert.equal(ui.includes('innerHTML'),false);
});
