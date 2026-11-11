import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry,dailyStoryIncident,pinDailyStoryIncident} from '../merge/story/runtime.mjs';
import {nextCoreDailyJourney} from '../merge/story/journey-guide.mjs';

const pack=CORE_STORY_PACK;
const day='2026-10-26';
const fresh=()=>startCoreStory(createEmptyStoryProgress(),pack);
function afterSignboard(){
  let state=fresh();
  for(const id of ['arrival','signboard']){
    const entry=pack.entries.find(e=>e.id===id);
    state=completeStoryEntry(state,pack,id,entry.choices[0]?.id??null);
  }
  return state;
}

test('P60 no unlocked event is not a fabricated daily shortcut',()=>{
  assert.equal(nextCoreDailyJourney(fresh(),day).kind,'none');
  assert.equal(nextCoreDailyJourney(null,day).kind,'unavailable');
  assert.equal(nextCoreDailyJourney(createEmptyStoryProgress(),day).kind,'unavailable');
  assert.equal(nextCoreDailyJourney(afterSignboard(),'2026-02-30').kind,'unavailable');
});

test('P60 provisional daily candidate is never clickable before the durable pin',()=>{
  const state=afterSignboard(),before=JSON.stringify(state);
  assert.ok(dailyStoryIncident(state,pack,day));
  const plan=nextCoreDailyJourney(state,day);
  assert.deepEqual(plan,{kind:'pending'});
  assert.equal(plan.entry,undefined);
  assert.equal(JSON.stringify(state),before);
});

test('P60 pinned event is the exact core scene and stays stable across repeat reads',()=>{
  const state=afterSignboard(),pinned=pinDailyStoryIncident(state,pack,day);
  const before=JSON.stringify(pinned);
  const plan=nextCoreDailyJourney(pinned,day);
  assert.equal(plan.kind,'story');
  assert.equal(plan.entry,dailyStoryIncident(pinned,pack,day));
  assert.equal(plan.completed,false);
  assert.equal(nextCoreDailyJourney(pinned,day).entry,plan.entry);
  assert.equal(JSON.stringify(pinned),before);
  assert.equal(nextCoreDailyJourney(pinned,'2026-10-27').kind,'pending');
});

test('P60 completed daily scene is only a replay, not a second completion',()=>{
  const pinned=pinDailyStoryIncident(afterSignboard(),pack,day);
  const plan=nextCoreDailyJourney(pinned,day);
  const finished=completeStoryEntry(pinned,pack,plan.entry.id,plan.entry.choices[0]?.id??null);
  const replay=nextCoreDailyJourney(finished,day);
  assert.equal(replay.kind,'story');
  assert.equal(replay.entry,plan.entry);
  assert.equal(replay.completed,true);
  assert.equal(completeStoryEntry(finished,pack,plan.entry.id,plan.entry.choices[0]?.id??null),finished);
});

test('P60 invalid pinned scene cannot reroll, and DLC cannot affect core selection',()=>{
  const pinned=pinDailyStoryIncident(afterSignboard(),pack,day);
  const foreign=structuredClone(pinned);
  foreign.packs['extra.stories']={checkpoint:null,completed:{main:[],side:[],incident:[]},choices:{},flags:{}};
  assert.equal(nextCoreDailyJourney(foreign,day).entry.id,nextCoreDailyJourney(pinned,day).entry.id);
  const inconsistent=structuredClone(pinned);
  inconsistent.packs.core.choices['daily-20261026']='old-crate';
  assert.equal(nextCoreDailyJourney(inconsistent,day).kind,'blocked');
  assert.equal(nextCoreDailyJourney(inconsistent,day).entry,undefined);
});

test('P60 iPhone daily shortcut preserves pinned-day and exact-save guards',()=>{
  const file=path=>readFileSync(new URL(path,import.meta.url),'utf8');
  const ui=file('../merge/story/ui.mjs'),html=file('../merge/story.html');
  const css=file('../merge/story/story.css'),guide=file('../merge/story/journey-guide.mjs');
  assert.ok(ui.includes("nextCoreDailyJourney(progress,day)"));
  assert.ok(ui.includes("dailyButton.hidden=dailyPlan.kind!=='story'"));
  assert.ok(ui.includes("const snapshot=checkStoryResumeSnapshot(store,{key:STORY_SAVE_KEY,expectedRaw:raw})"));
  assert.ok(ui.includes("if(localDay()!==day)return;"));
  assert.ok(ui.includes("kind='incident';render();"));
  assert.ok(ui.includes('open(plan.entry);'));
  for(const id of ['journey-daily','journey-daily-read'])assert.ok(html.includes('id="'+id+'"'));
  assert.ok(css.includes('#journey-daily-read{min-height:44px'));
  assert.ok(css.includes('prefers-color-scheme:dark'));
  assert.ok(css.includes('prefers-reduced-motion:reduce'));
  assert.ok(css.includes('safe-area-inset'));
  for(const code of [ui,guide])for(const word of ['innerHTML','insertAdjacentHTML','fetch(','sendBeacon('])
    assert.equal(code.includes(word),false,word);
});
