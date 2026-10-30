import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmptyStoryProgress,validateStoryProgress} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry,dailyStoryIncident,pinDailyStoryIncident,
  pinnedDailyStoryIncident,availableStoryEntries} from '../merge/story/runtime.mjs';
import {nextCoreDailyJourney} from '../merge/story/journey-guide.mjs';
import {canCommitDailyIncident} from '../merge/story/daily-incident-guard.mjs';

const pack=CORE_STORY_PACK;
const crate=pack.entries.find(entry=>entry.id==='old-crate');
function afterHarbor(){
  let progress=startCoreStory(createEmptyStoryProgress(),pack);
  for(const entry of pack.entries.filter(item=>item.kind==='main')){
    progress=completeStoryEntry(progress,pack,entry.id,entry.choices[0]?.id??null);
    if(entry.id==='harbor-light')return progress;
  }
  throw Error('Missing harbor-light');
}
function pinnedCrate(){
  const progress=afterHarbor();
  const day=Array.from({length:31},(_,i)=>'2026-10-'+String(i+1).padStart(2,'0'))
    .find(value=>dailyStoryIncident(progress,pack,value)===crate);
  assert.ok(day,'at least one October date must select the one-off crate');
  const pinned=pinDailyStoryIncident(progress,pack,day);
  assert.equal(dailyStoryIncident(pinned,pack,day),crate);
  return {day,pinned};
}

test('P153 completed one-off crate remains readable on its pinned day without a reroll',()=>{
  const {day,pinned}=pinnedCrate();
  const finished=completeStoryEntry(pinned,pack,crate.id,'register');
  const raw=JSON.stringify(finished);
  assert.equal(validateStoryProgress(finished),true);
  assert.equal(pinnedDailyStoryIncident(finished,pack,day),true);
  assert.equal(availableStoryEntries(finished,pack,'incident').includes(crate),false);
  assert.equal(dailyStoryIncident(finished,pack,day),crate);
  assert.deepEqual(nextCoreDailyJourney(finished,day),{
    kind:'story',entry:crate,completed:true
  });
  assert.equal(canCommitDailyIncident(crate,day,day,finished,pack),true);
  assert.equal(completeStoryEntry(finished,pack,crate.id,'register'),finished,
    're-reading never repeats completion or grants resources');
  assert.equal(JSON.stringify(finished),raw,'daily replay must be read-only');
  for(const key of ['coins','energy','board','warehouse','xp'])
    assert.equal(Object.hasOwn(finished,key),false);
});

test('P153 next day excludes the completed one-off but keeps ordinary incidents',()=>{
  const {day,pinned}=pinnedCrate();
  const finished=completeStoryEntry(pinned,pack,crate.id,'ask');
  const nextDay=day==='2026-10-31'?'2026-11-01':'2026-10-'+
    String(Number(day.slice(-2))+1).padStart(2,'0');
  const next=pinDailyStoryIncident(finished,pack,nextDay);
  assert.equal(pinnedDailyStoryIncident(next,pack,day),false);
  assert.equal(pinnedDailyStoryIncident(next,pack,nextDay),true);
  assert.notEqual(dailyStoryIncident(next,pack,nextDay),crate);
  assert.equal(next.packs.core.completed.incident.filter(id=>id===crate.id).length,1);
  assert.equal(next.packs.core.choices['old-crate'],'ask');
});

test('P153 malformed pins, impossible prerequisites and DLC impostors stay blocked',()=>{
  const {day,pinned}=pinnedCrate();
  const key='daily-'+day.replaceAll('-','');
  const unknown=structuredClone(pinned);
  unknown.packs.core.choices[key]='not-an-event';
  assert.equal(validateStoryProgress(unknown),true);
  assert.equal(dailyStoryIncident(unknown,pack,day),null);
  assert.equal(nextCoreDailyJourney(unknown,day).kind,'blocked');

  const foreign=structuredClone(pinned);
  foreign.packs.core.choices[key]='wrong-letter';
  assert.equal(dailyStoryIncident(foreign,pack,day),null);
  assert.equal(nextCoreDailyJourney(foreign,day).kind,'blocked');

  const finished=completeStoryEntry(pinned,pack,crate.id,'register');
  const impossible=structuredClone(finished);
  impossible.packs.core.completed.main=impossible.packs.core.completed.main
    .filter(id=>id!=='harbor-light');
  assert.equal(validateStoryProgress(impossible),true);
  assert.equal(dailyStoryIncident(impossible,pack,day),null);
  assert.equal(nextCoreDailyJourney(impossible,day).kind,'blocked');

  assert.equal(canCommitDailyIncident({...crate},day,day,finished,pack),false,
    'a same-ID DLC object cannot impersonate the pinned core event');
  assert.equal(canCommitDailyIncident(crate,day,'2026-11-01',finished,pack),false);
});
