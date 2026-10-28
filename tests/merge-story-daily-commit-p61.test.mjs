import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry,dailyStoryIncident,pinDailyStoryIncident} from '../merge/story/runtime.mjs';
import {canCommitDailyIncident} from '../merge/story/daily-incident-guard.mjs';

const day='2026-10-27';
function unlocked(){
  let progress=startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);
  progress=completeStoryEntry(progress,CORE_STORY_PACK,'arrival','help');
  return completeStoryEntry(progress,CORE_STORY_PACK,'signboard');
}

test('P61 provisional daily hash is never an authorized scene',()=>{
  const progress=unlocked(),raw=JSON.stringify(progress);
  const event=dailyStoryIncident(progress,CORE_STORY_PACK,day);
  assert.ok(event);
  assert.equal(canCommitDailyIncident(event,day,day,progress,CORE_STORY_PACK),false);
  assert.equal(JSON.stringify(progress),raw,'guard is read-only');
  const pinned=pinDailyStoryIncident(progress,CORE_STORY_PACK,day);
  assert.equal(canCommitDailyIncident(event,day,day,pinned,CORE_STORY_PACK),true);
  assert.equal(canCommitDailyIncident({...event},day,day,pinned,CORE_STORY_PACK),false);
  assert.equal(canCommitDailyIncident(event,day,'2026-10-28',pinned,CORE_STORY_PACK),false);
});

test('P61 damaged pin and DLC lookalike fail closed',()=>{
  const pinned=pinDailyStoryIncident(unlocked(),CORE_STORY_PACK,day);
  const event=dailyStoryIncident(pinned,CORE_STORY_PACK,day);
  const damaged=structuredClone(pinned);
  damaged.packs.core.choices['daily-20261027']='unknown-incident';
  assert.equal(canCommitDailyIncident(event,day,day,damaged,CORE_STORY_PACK),false);
  assert.equal(canCommitDailyIncident({...event},day,day,pinned,CORE_STORY_PACK),false);
  assert.equal(canCommitDailyIncident(event,day,day,pinned,{...CORE_STORY_PACK,entries:[]}),false);
});

test('P61 incident UI cannot expose a provisional card even in blocked state',()=>{
  const ui=readFileSync(new URL('../merge/story/ui.mjs',import.meta.url),'utf8');
  const guard=readFileSync(new URL('../merge/story/daily-incident-guard.mjs',import.meta.url),'utf8');
  assert.ok(ui.includes('if(todays&&dayPinned&&!blocked)list.append(card(todays,completed(todays),workshopForRender));'));
  assert.ok(ui.includes('const workshopForRender=blocked?null:readStoryWorkshop(store);'));
  assert.ok(ui.includes('今日事件入口已暂停；不会展示未固定的临时事件'));
  assert.ok(guard.includes('pinnedDailyStoryIncident(progress,pack,currentDay)&&'));
  assert.ok(ui.includes('if(entry.kind===\'incident\'&&!canCommitDailyIncident('));
  assert.ok(ui.includes('canCommitDailyIncident(selected,selectedIncidentDay,localDay(),progress,CORE_STORY_PACK);'));
  assert.equal(ui.includes('if(todays&&(dayPinned||blocked))'),false);
  for(const source of [ui,guard])
    for(const unsafe of ['innerHTML','insertAdjacentHTML','fetch(','sendBeacon('])
      assert.equal(source.includes(unsafe),false,unsafe);
});
