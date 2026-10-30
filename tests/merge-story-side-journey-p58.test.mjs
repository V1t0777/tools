import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState,storeItem,withdrawItem,validateSave} from '../merge/engine.mjs';
import {createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry} from '../merge/story/runtime.mjs';
import {nextCoreSideJourney} from '../merge/story/journey-guide.mjs';
import {storyWorkshopGoalHref} from '../merge/story/workshop-gate.mjs';

const pack=CORE_STORY_PACK;
const main=pack.entries.filter(e=>e.kind==='main');
const fresh=()=>startCoreStory(createEmptyStoryProgress(),pack);
const read=state=>({state,raw:JSON.stringify(state),blocked:false,reason:null});
function through(stop){
  let state=fresh();
  for(const entry of main){
    state=completeStoryEntry(state,pack,entry.id,entry.choices[0]?.id??null);
    if(entry.id===stop)return state;
  }
  throw Error('unknown scene');
}
function finishSide(state,id){
  const entry=pack.entries.find(e=>e.id===id&&e.kind==='side');
  assert.ok(entry);
  return completeStoryEntry(state,pack,id,entry.choices[0]?.id??null);
}
function onlyToolbox(){
  let state=through('old-pier');
  for(const id of ['wrong-letter','old-seeds','postcard'])state=finishSide(state,id);
  return state;
}

test('P58 side shortcut recommends a real unlocked scene without mutating either save',()=>{
  const progress=through('old-pier'),workshop=read(createInitialState(1_000_000));
  const before=JSON.stringify(progress),shop=JSON.stringify(workshop);
  const plan=nextCoreSideJourney(progress,workshop);
  assert.equal(plan.kind,'story');
  assert.equal(plan.entry.id,'wrong-letter');
  assert.equal(plan.available,4);
  assert.equal(JSON.stringify(progress),before);
  assert.equal(JSON.stringify(workshop),shop);
});

test('P58 blocked warehouse side does not hide a later readable optional scene',()=>{
  let progress=through('old-pier');
  progress=finishSide(progress,'wrong-letter');
  progress=finishSide(progress,'old-seeds');
  const plan=nextCoreSideJourney(progress,read(createInitialState(1_000_000)));
  assert.equal(plan.kind,'story');
  assert.equal(plan.entry.id,'postcard');
  assert.equal(plan.available,2);
});

test('P58 when only toolbox remains, route to the exact real warehouse goal',()=>{
  const progress=onlyToolbox();
  const plan=nextCoreSideJourney(progress,read(createInitialState(1_000_000)));
  assert.equal(plan.kind,'workshop');
  assert.equal(plan.entry.id,'toolbox');
  assert.equal(plan.href,storyWorkshopGoalHref('toolbox'));
  assert.equal(plan.requirement.goal,1);
  assert.equal(plan.requirement.current,0);
  assert.equal(plan.available,1);
});

test('P58 real engine warehouse storage unlocks optional reading, withdrawal closes the gate',()=>{
  const progress=onlyToolbox();
  const stored=storeItem(createInitialState(1_000_000),0);
  assert.equal(stored.ok,true);
  assert.equal(validateSave(stored.state),true);
  const readable=nextCoreSideJourney(progress,read(stored.state));
  assert.equal(readable.kind,'story');
  assert.equal(readable.entry.id,'toolbox');
  const slot=stored.state.warehouse.slots.findIndex(Boolean);
  const withdrawn=withdrawItem(stored.state,slot);
  assert.equal(withdrawn.ok,true);
  assert.equal(nextCoreSideJourney(progress,read(withdrawn.state)).kind,'workshop');
});

test('P58 damaged, missing and forged workshop state never invents a warehouse completion',()=>{
  const progress=onlyToolbox();
  for(const value of [null,{blocked:true,reason:'CORRUPT_SAVE'},
    {blocked:true,reason:'STORAGE_UNAVAILABLE'},{blocked:false,state:{board:[]}}]){
    const plan=nextCoreSideJourney(progress,value);
    assert.equal(plan.kind,'workshop');
    assert.equal(plan.requirement.met,false);
    assert.equal(plan.href,storyWorkshopGoalHref('toolbox'));
  }
  assert.equal(nextCoreSideJourney(null,null).kind,'unavailable');
  assert.equal(nextCoreSideJourney(createEmptyStoryProgress(),null).kind,'unavailable');
});

test('P58 completed side quests are not replayed; foreign DLC packs never change core recommendation',()=>{
  let progress=through('letter-answer');
  const baseline=nextCoreSideJourney(progress,read(createInitialState(1_000_000)));
  assert.equal(baseline.entry.id,'wrong-letter');
  const withDlc=structuredClone(progress);
  withDlc.packs['extra.stories']={checkpoint:null,completed:{main:[],side:[],incident:[]},choices:{},flags:{}};
  assert.equal(nextCoreSideJourney(withDlc,read(createInitialState(1_000_000))).entry.id,baseline.entry.id);
  for(const entry of pack.entries.filter(e=>e.kind==='side'))progress=finishSide(progress,entry.id);
  const complete=nextCoreSideJourney(progress,read(createInitialState(1_000_000)));
  assert.equal(complete.kind,'complete');
  assert.equal(complete.available,0);
});

test('P58 iPhone UI routes the side action through existing stale-save guards',()=>{
  const file=path=>readFileSync(new URL(path,import.meta.url),'utf8');
  const ui=file('../merge/story/ui.mjs'),html=file('../merge/story.html');
  const css=file('../merge/story/story.css'),guide=file('../merge/story/journey-guide.mjs');
  assert.ok(ui.includes("nextCoreSideJourney(progress,readStoryWorkshop(store))"));
  assert.ok(ui.includes("sideButton.hidden=sideJourney.kind!=='story'"));
  assert.ok(ui.includes("sideLink.hidden=sideJourney.kind!=='workshop'"));
  assert.ok(ui.includes("kind='side';render();"));
  assert.ok(ui.includes('open(plan.entry);'));
  assert.ok(ui.includes('checkStoryResumeSnapshot(store,{key:STORY_SAVE_KEY,expectedRaw:raw})'));
  for(const id of ['journey-side-read','journey-side-workshop'])assert.ok(html.includes('id="'+id+'"'));
  assert.ok(css.includes('.journey-actions [hidden]{display:none!important}'));
  assert.ok(css.includes('.journey-secondary{'));
  assert.ok(css.includes('min-height:44px'));
  assert.ok(css.includes('prefers-color-scheme:dark'));
  assert.ok(css.includes('prefers-reduced-motion:reduce'));
  assert.ok(css.includes('safe-area-inset'));
  for(const code of [ui,guide])for(const word of ['innerHTML','insertAdjacentHTML','fetch(','sendBeacon('])
    assert.equal(code.includes(word),false,word);
});
