import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEmptyStoryProgress,registerStoryPack,STORY_SAVE_KEY,validateStoryProgress} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry,dailyStoryIncident,pinDailyStoryIncident,pinnedDailyStoryIncident} from '../merge/story/runtime.mjs';
import {canCommitDailyIncident} from '../merge/story/daily-incident-guard.mjs';
import {writeStorySave} from '../merge/story/local-storage.mjs';

const pack=CORE_STORY_PACK;
const day='2026-10-25';
function through(target){
  let story=startCoreStory(createEmptyStoryProgress(),pack);
  for(const entry of pack.entries.filter(e=>e.kind==='main')){
    story=completeStoryEntry(story,pack,entry.id,entry.choices[0]?.id??null);
    if(entry.id===target)return story;
  }
  throw Error('Unknown checkpoint '+target);
}
const later=story=>{
  let next=completeStoryEntry(story,pack,'first-order','listen');
  return completeStoryEntry(next,pack,'ledger');
};
const memory=()=>{const map=new Map();return {
  getItem:key=>map.has(key)?map.get(key):null,
  setItem:(key,value)=>map.set(key,value),map
};};

test('P47 daily incident is durably pinned before newly unlocked incidents can reroll it',()=>{
  const early=through('signboard');
  const pinned=pinDailyStoryIncident(early,pack,day);
  assert.notEqual(pinned,early);
  assert.equal(validateStoryProgress(pinned),true);
  assert.equal(pinned.revision,early.revision+1);
  assert.equal(pinnedDailyStoryIncident(pinned,pack,day),true);
  assert.equal(pinnedDailyStoryIncident(early,pack,day),false);
  const first=dailyStoryIncident(pinned,pack,day);
  assert.ok(first);
  const unlocked=later(pinned);
  assert.equal(dailyStoryIncident(unlocked,pack,day),first);
  assert.equal(canCommitDailyIncident(first,day,day,unlocked,pack),true);
  assert.equal(pinDailyStoryIncident(unlocked,pack,day),unlocked,'reopening is read-only');
});

test('P47 an actual pre-pin same-day reroll is prevented after story advancement',()=>{
  const early=through('signboard'),unlocked=later(early);
  const changed=Array.from({length:28},(_,i)=>'2026-10-'+String(i+1).padStart(2,'0'))
    .find(d=>dailyStoryIncident(early,pack,d)!==dailyStoryIncident(unlocked,pack,d));
  assert.ok(changed,'test requires an unlock that really changes the candidate pool');
  const pinned=pinDailyStoryIncident(early,pack,changed);
  const advanced=later(pinned);
  assert.notEqual(dailyStoryIncident(unlocked,pack,changed),
    dailyStoryIncident(advanced,pack,changed));
  assert.equal(dailyStoryIncident(advanced,pack,changed),
    dailyStoryIncident(early,pack,changed));
});

test('P47 next day may select again; old daily markers are pruned, story choices remain',()=>{
  const before=through('signboard');
  const first=pinDailyStoryIncident(before,pack,'2026-10-25');
  const next=pinDailyStoryIncident(first,pack,'2026-10-26');
  assert.equal(pinnedDailyStoryIncident(next,pack,'2026-10-25'),false);
  assert.equal(pinnedDailyStoryIncident(next,pack,'2026-10-26'),true);
  assert.equal(Object.keys(next.packs.core.choices).filter(k=>/^daily-\d{8}$/.test(k)).length,1);
  assert.equal(next.packs.core.choices.arrival,'help');
  assert.equal(next.revision,first.revision+1);
  assert.equal(JSON.stringify(first.packs.core.completed),JSON.stringify(next.packs.core.completed));
});

test('P47 corrupt-but-schema-valid marker fails closed rather than silently rerolling',()=>{
  const story=through('signboard');
  story.packs.core.choices['daily-20261025']='not-a-core-event';
  assert.equal(validateStoryProgress(story),true);
  assert.equal(pinnedDailyStoryIncident(story,pack,day),true);
  assert.equal(dailyStoryIncident(story,pack,day),null);
  assert.equal(pinDailyStoryIncident(story,pack,day),story);
  assert.equal(canCommitDailyIncident(pack.entries.find(e=>e.id==='cat-nap'),
    day,day,story,pack),false);
});

test('P47 same-day claim cannot overwrite a concurrent story save or normal save',()=>{
  const db=memory(),initial=through('signboard'),raw=JSON.stringify(initial);
  db.setItem(STORY_SAVE_KEY,raw);
  db.setItem('toolbox.merge-isle.local.v1','normal-unchanged');
  const claim=pinDailyStoryIncident(initial,pack,day);
  assert.equal(writeStorySave(db,claim,{expectedRaw:raw}),true);
  const actual=db.getItem(STORY_SAVE_KEY);
  assert.notEqual(actual,raw);
  const competing=completeStoryEntry(initial,pack,'first-order','smile');
  assert.equal(writeStorySave(db,competing,{expectedRaw:raw}),false);
  assert.equal(db.getItem(STORY_SAVE_KEY),actual);
  assert.equal(db.getItem('toolbox.merge-isle.local.v1'),'normal-unchanged');
});

test('P47 DLC pack has its own day marker; core choice and economy stay isolated',()=>{
  const dlc={id:'neighbor',title:'邻岛支线',version:1,entries:[{
    id:'rain-note',kind:'incident',title:'邻岛小雨',chapter:'邻岛',place:'岸边',
    repeatable:true,requires:[],lines:[{speaker:'旅人',text:'雨会停。'}],choices:[]
  }]};
  const core=pinDailyStoryIncident(through('signboard'),pack,day);
  const expanded=registerStoryPack(core,dlc.id);
  const pinned=pinDailyStoryIncident(expanded,dlc,day);
  assert.equal(pinnedDailyStoryIncident(pinned,dlc,day),true);
  assert.equal(dailyStoryIncident(pinned,dlc,day).id,'rain-note');
  assert.equal(dailyStoryIncident(pinned,pack,day),dailyStoryIncident(core,pack,day));
  assert.equal(pinned.packs.core.choices['daily-20261025'],core.packs.core.choices['daily-20261025']);
  for(const key of ['coins','energy','board','warehouse','xp'])assert.equal(key in pinned,false);
});

test('P47 UI waits for durable same-day pin before exposing an actionable event',()=>{
  const ui=readFileSync(new URL('../merge/story/ui.mjs',import.meta.url),'utf8');
  assert.ok(ui.includes('const dayPinned=pinnedDailyStoryIncident(progress,CORE_STORY_PACK,day);'));
  assert.ok(ui.includes('if(todays&&(dayPinned||blocked))list.append(card(todays,completed(todays)));'));
  assert.ok(ui.includes('const next=pinDailyStoryIncident(progress,CORE_STORY_PACK,day);'));
  assert.ok(ui.includes('if(next!==progress)await save(next,false,()=>localDay()===day);'));
  assert.ok(ui.includes('queueMicrotask(async()=>{'));
  assert.ok(ui.includes("text.textContent=line.text;"));
  assert.equal(ui.includes('innerHTML'),false);
});
