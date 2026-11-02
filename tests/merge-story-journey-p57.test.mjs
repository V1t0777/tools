import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState,fulfillOrder,upgradeBuilding,validateSave} from '../merge/engine.mjs';
import {createEmptyStoryProgress,STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry} from '../merge/story/runtime.mjs';
import {nextCoreStoryJourney} from '../merge/story/journey-guide.mjs';
import {STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';
import {checkStoryResumeSnapshot} from '../merge/story/resume-guard.mjs';
import {storyWorkshopGoalHref} from '../merge/story/workshop-gate.mjs';

const pack=CORE_STORY_PACK,main=pack.entries.filter(e=>e.kind==='main');
const empty=()=>startCoreStory(createEmptyStoryProgress(),pack);
function through(stop){
  let state=empty();
  for(const entry of main){
    state=completeStoryEntry(state,pack,entry.id,entry.choices[0]?.id??null);
    if(entry.id===stop)return state;
  }
  throw Error('unknown scene '+stop);
}
const readState=state=>({raw:JSON.stringify(state),state,blocked:false,reason:null});
const entry=id=>pack.entries.find(e=>e.id===id);

test('P57 first-volume guide progresses through actual unlocked story scenes, without writes',()=>{
  const workshop=readState(createInitialState(1000000));
  for(const [state,id] of [[empty(),'arrival'],[through('arrival'),'signboard'],[through('first-order'),'ledger'],[through('seed'),'tea-table']]){
    const before=JSON.stringify(state),shop=JSON.stringify(workshop);
    const guide=nextCoreStoryJourney(state,workshop);
    assert.equal(guide.entry.id,id);
    assert.equal(guide.kind,id==='tea-table'?'workshop':'story');
    assert.equal(JSON.stringify(state),before);
    assert.equal(JSON.stringify(workshop),shop);
  }
});

test('P57 real first-order business requirement links to the exact workshop action',()=>{
  const next=nextCoreStoryJourney(through('signboard'),readState(createInitialState(1000000)));
  assert.equal(next.kind,'workshop');
  assert.equal(next.entry.id,'first-order');
  assert.equal(next.href,storyWorkshopGoalHref('first-order'));
  assert.equal(next.requirement.current,0);
  const state=createInitialState(1000000);
  const done=fulfillOrder(state,state.orders[0].id);
  assert.equal(done.ok,true);
  const unlocked=nextCoreStoryJourney(through('signboard'),readState(done.state));
  assert.equal(unlocked.kind,'story');
  assert.equal(unlocked.entry,entry('first-order'));
});

test('P57 every real business-gated mainline step offers exact target and no invented completion',()=>{
  const cases=[['signboard','first-order'],['seed','tea-table'],['apprentice','harbor-light'],['harbor-light','festival']];
  const raw=createInitialState(1000000);
  for(const [checkpoint,expected] of cases){
    const next=nextCoreStoryJourney(through(checkpoint),readState(raw));
    assert.equal(next.kind,'workshop');
    assert.equal(next.entry.id,expected);
    assert.equal(next.href,storyWorkshopGoalHref(expected));
  }
  const ready=structuredClone(raw);ready.coins=2000;ready.xp=2000;
  assert.equal(validateSave(ready),true);
  const garden=upgradeBuilding(ready,'garden');
  assert.equal(garden.ok,true);
  assert.equal(nextCoreStoryJourney(through('seed'),readState(garden.state)).kind,'story');
  const harbor=upgradeBuilding(garden.state,'harbor');
  assert.equal(harbor.ok,true);
  assert.equal(nextCoreStoryJourney(through('apprentice'),readState(harbor.state)).kind,'story');
  const front=upgradeBuilding(harbor.state,'storefront');
  assert.equal(front.ok,true);
  assert.equal(nextCoreStoryJourney(through('harbor-light'),readState(front.state)).kind,'story');
});

test('P57 damaged and unavailable workshop cannot unlock a business-gated chapter',()=>{
  const story=through('signboard');
  for(const shop of [null,{blocked:true,reason:'CORRUPT_SAVE'}, {blocked:true,reason:'STORAGE_UNAVAILABLE'},
    {blocked:false,state:{board:[]}}]){
    const guide=nextCoreStoryJourney(story,shop);
    assert.equal(guide.kind,'workshop');
    assert.equal(guide.blocked,shop?.blocked!==false);
  }
  assert.equal(nextCoreStoryJourney(null,null).kind,'unavailable');
  assert.equal(nextCoreStoryJourney(createEmptyStoryProgress(),null).kind,'unavailable');
});

test('P57 story path is independent of optional side choices and extra DLC packs',()=>{
  const story=through('first-order');
  const baseline=nextCoreStoryJourney(story,readState(createInitialState(1000000)));
  assert.equal(baseline.kind,'story');
  assert.equal(baseline.entry,entry('ledger'));
  assert.ok(baseline.sideCount>0);
  const altered=structuredClone(story);
  altered.packs['extra.stories']={checkpoint:null,completed:{main:[],side:[],incident:[]},choices:{},flags:{}};
  const guide=nextCoreStoryJourney(altered,readState(createInitialState(1000000)));
  assert.equal(guide.entry,entry('ledger'));
  assert.equal(guide.sideCount,baseline.sideCount);
});

test('P57 completed first volume offers no replay rewards and keeps optional stories visible',()=>{
  const story=through('letter-answer');
  const guide=nextCoreStoryJourney(story,readState(createInitialState(1000000)));
  assert.equal(guide.kind,'complete');
  assert.equal(guide.entry,undefined);
  assert.ok(guide.sideCount>0);
});

test('P57 stale narrative or workshop snapshots fail read-only comparison',()=>{
  const data=new Map([[STORY_SAVE_KEY,'old-story'],[STORY_WORKSHOP_KEY,'old-workshop']]);
  const store={getItem:key=>data.has(key)?data.get(key):null,
    setItem(){throw Error('must not save during preflight');}};
  assert.equal(checkStoryResumeSnapshot(store,{key:STORY_SAVE_KEY,expectedRaw:'old-story'}).ok,true);
  data.set(STORY_SAVE_KEY,'other-story');
  assert.equal(checkStoryResumeSnapshot(store,{key:STORY_SAVE_KEY,expectedRaw:'old-story'}).reason,'WRITE_CONFLICT');
  data.set(STORY_WORKSHOP_KEY,'other-workshop');
  assert.equal(checkStoryResumeSnapshot(store,{key:STORY_WORKSHOP_KEY,expectedRaw:'old-workshop'}).reason,'WRITE_CONFLICT');
});

test('P57 UI makes next chapter accessible on iPhone and checks both snapshots on interaction',()=>{
  const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
  const ui=read('../merge/story/ui.mjs'),html=read('../merge/story.html'),css=read('../merge/story/story.css');
  const helper=read('../merge/story/journey-guide.mjs');
  assert.ok(ui.includes('nextCoreStoryJourney(progress,readStoryWorkshop(store))'));
  assert.ok(ui.includes("journeyButton.hidden=journey.kind!=='story'"));
  assert.ok(ui.includes("journeyLink.hidden=blocked||journey.kind!=='workshop'"));
  assert.ok(ui.includes("kind='main';render();"));
  assert.ok(ui.includes("open(plan.entry);"));
  assert.ok(ui.includes('const storyAtChoice=checkStoryResumeSnapshot(store,{key:STORY_SAVE_KEY,expectedRaw:raw});'));
  assert.ok(ui.includes('if(!openWorkshopCurrent()){'));
  assert.ok(ui.includes('inspectStoryWorkshopRequirementFromRead(entry.id,workshopAtOpen).met'));
  assert.ok(ui.includes('if(!availableStoryEntries(progress,CORE_STORY_PACK,entry.kind).includes(entry)&&'));
  for(const id of ['journey-read','journey-workshop','journey-guidance','journey-side'])assert.ok(html.includes('id="'+id+'"'));
  assert.ok(css.includes('.journey-actions [hidden]{display:none!important}'));
  assert.ok(css.includes('.journey-primary{'));
  assert.ok(css.includes('min-height:44px'));
  assert.ok(css.includes('prefers-color-scheme:dark'));
  assert.ok(css.includes('prefers-reduced-motion:reduce'));
  assert.ok(css.includes('safe-area-inset'));
  for(const code of [ui,helper])for(const word of ['innerHTML','insertAdjacentHTML','fetch(','sendBeacon('])
    assert.equal(code.includes(word),false,word);
});
