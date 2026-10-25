import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry,dailyStoryIncident} from '../merge/story/runtime.mjs';
import {canCommitDailyIncident} from '../merge/story/daily-incident-guard.mjs';

function afterSignboard(){
  let story=startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);
  story=completeStoryEntry(story,CORE_STORY_PACK,'arrival','help');
  return completeStoryEntry(story,CORE_STORY_PACK,'signboard');
}
const pack=CORE_STORY_PACK;
const day='2026-10-25';

test('P46 same-day selected incident may commit without mutating saves',()=>{
  const story=afterSignboard(),raw=JSON.stringify(story);
  const incident=dailyStoryIncident(story,pack,day);
  assert.ok(incident);
  assert.equal(canCommitDailyIncident(incident,day,day,story,pack),true);
  assert.equal(JSON.stringify(story),raw);
  for(const key of ['coins','energy','board','warehouse'])
    assert.equal(Object.hasOwn(story,key),false);
});

test('P46 midnight invalidates an overnight-open incident, even with the same event ID',()=>{
  const story=afterSignboard(),incident=dailyStoryIncident(story,pack,day);
  assert.equal(canCommitDailyIncident(incident,day,'2026-10-26',story,pack),false);
  assert.equal(canCommitDailyIncident(incident,day,'2026-10-24',story,pack),false);
  assert.equal(canCommitDailyIncident(incident,null,day,story,pack),false);
  assert.equal(canCommitDailyIncident(incident,'2026-02-30','2026-02-30',story,pack),false);
});

test('P46 a same-ID DLC object or changed daily candidate cannot impersonate current event',()=>{
  const story=afterSignboard(),incident=dailyStoryIncident(story,pack,day);
  assert.equal(canCommitDailyIncident({...incident},day,day,story,pack),false);
  assert.equal(canCommitDailyIncident({id:incident.id,kind:'incident'},day,day,story,pack),false);
  assert.equal(canCommitDailyIncident(incident,day,day,{packs:{}},pack),false);
  assert.equal(canCommitDailyIncident(incident,day,day,story,{...pack,entries:[]}),false);
});

test('P46 normal mainline and side dialogues remain independent of local-day expiry',()=>{
  const story=afterSignboard();
  for(const id of ['first-order','wrong-letter']){
    const entry=pack.entries.find(e=>e.id===id);
    assert.equal(canCommitDailyIncident(entry,null,'2026-10-26',story,pack),true);
  }
  assert.equal(canCommitDailyIncident(null,day,day,story,pack),false);
});

test('P46 UI refreshes after midnight and rechecks incident at click and under Web Lock',()=>{
  const ui=readFileSync(new URL('../merge/story/ui.mjs',import.meta.url),'utf8');
  assert.ok(ui.includes("import {canCommitDailyIncident} from './daily-incident-guard.mjs';"));
  assert.ok(ui.includes("if(entry.kind==='incident'&&!canCommitDailyIncident("));
  assert.ok(ui.includes('if(!canCommitDailyIncident(selected,selectedIncidentDay,localDay(),progress,CORE_STORY_PACK))'));
  assert.ok(ui.includes('const commitGuard=()=>storyDialogueCommitAllowed(store,entryId,expectedWorkshopRaw)&&'));
  assert.ok(ui.includes('function refreshIncidentDay(){'));
  assert.ok(ui.includes("if(selected?.kind==='incident')"));
  assert.ok(ui.includes('  render();\n}'));
  assert.equal(ui.includes("if(kind==='incident')render();"),false);
  assert.ok(ui.includes("if(document.visibilityState==='visible')refreshIncidentDay();"));
  assert.ok(ui.includes("window.addEventListener('pageshow',recheckStoryOnResume);"));
  assert.ok(ui.includes("document.addEventListener('visibilitychange',()=>{"));
  assert.ok(ui.includes("text.textContent=line.text;"));
  assert.equal(ui.includes('innerHTML'),false);
});
