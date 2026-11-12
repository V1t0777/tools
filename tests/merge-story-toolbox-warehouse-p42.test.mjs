import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState,storeItem,withdrawItem,validateSave} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {createEmptyStoryProgress,validateStoryProgress,STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {validateStoryPack,availableStoryEntries,completeStoryEntry,startCoreStory} from '../merge/story/runtime.mjs';
import {storyWorkshopRequirement,inspectStoryWorkshopRequirement} from '../merge/story/workshop-gate.mjs';
import {STORY_WORKSHOP_KEY,writeStoryWorkshop} from '../merge/story/workshop-storage.mjs';
import {writeStorySave} from '../merge/story/local-storage.mjs';
import {storyDialogueCommitAllowed} from '../merge/story/dialogue-commit-guard.mjs';
import {saveStoryDialogueWithLock} from '../merge/story/dialogue-write.mjs';
import {mainlineChoiceEcho} from '../merge/story/mainline-choice-context.mjs';

const entry=id=>CORE_STORY_PACK.entries.find(x=>x.id===id);
const fresh=()=>startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);
function through(target){
  let story=fresh();
  for(const e of CORE_STORY_PACK.entries.filter(x=>x.kind==='main')){
    story=completeStoryEntry(story,CORE_STORY_PACK,e.id,e.choices[0]?.id??null);
    if(e.id===target)return story;
  }
  throw Error('Unknown checkpoint');
}
function memory(){
  const data=new Map();
  return {data,getItem:key=>data.has(key)?data.get(key):null,
    setItem:(key,value)=>data.set(key,value)};
}

test('P42 toolbox remains optional, but now offers two meaningful organization choices',()=>{
  assert.equal(validateStoryPack(CORE_STORY_PACK),true);
  const toolbox=entry('toolbox');
  assert.equal(toolbox.kind,'side');
  assert.deepEqual(toolbox.choices.map(x=>x.id),['label','space']);
  const before=through('old-pier');
  assert.ok(availableStoryEntries(before,CORE_STORY_PACK,'side').includes(toolbox));
  assert.equal(availableStoryEntries(before,CORE_STORY_PACK,'main')[0].id,'apprentice');
  const selected=completeStoryEntry(before,CORE_STORY_PACK,'toolbox','label');
  assert.equal(selected.packs.core.choices.toolbox,'label');
  assert.equal(selected.packs.core.completed.side.includes('toolbox'),true);
  assert.equal(selected.packs.core.completed.main.length,before.packs.core.completed.main.length);
  assert.throws(()=>completeStoryEntry(before,CORE_STORY_PACK,'toolbox'),RangeError);
});

test('P42 real engine warehouse storage fulfills goal; taking material out reverses uncommitted goal',()=>{
  const initial=createInitialState(1_000_000);
  const goal=storyWorkshopRequirement('toolbox',initial);
  assert.equal(goal.required,true);
  assert.equal(goal.met,false);
  assert.equal(goal.current,0);
  assert.equal(goal.goal,1);
  const stored=storeItem(initial,0);
  assert.equal(stored.ok,true);
  assert.equal(validateSave(stored.state),true);
  assert.equal(storyWorkshopRequirement('toolbox',stored.state).met,true);
  assert.equal(storyWorkshopRequirement('toolbox',stored.state).current,1);
  assert.equal(storyWorkshopRequirement('first-order',stored.state).met,false,
    'warehouse storage must not manufacture completed orders');
  const slot=stored.state.warehouse.slots.findIndex(Boolean);
  const withdrawn=withdrawItem(stored.state,slot);
  assert.equal(withdrawn.ok,true);
  assert.equal(storyWorkshopRequirement('toolbox',withdrawn.state).met,false);
  assert.equal(storyWorkshopRequirement('toolbox',null).met,false);
});

test('P42 workshop goal uses only story key and never trusts corrupt or missing data',()=>{
  const db=memory(),normal='normal-mode-sentinel';
  db.setItem(SAVE_KEY,normal);
  assert.equal(inspectStoryWorkshopRequirement('toolbox',db).met,false);
  const stored=storeItem(createInitialState(1_000_000),0);
  assert.equal(writeStoryWorkshop(db,stored.state,{expectedRaw:null}),true);
  const snapshot=db.getItem(STORY_WORKSHOP_KEY);
  assert.equal(inspectStoryWorkshopRequirement('toolbox',db).met,true);
  assert.equal(storyDialogueCommitAllowed(db,'toolbox',snapshot),true);
  assert.equal(storyDialogueCommitAllowed(db,'toolbox','stale'),false);
  assert.equal(storyDialogueCommitAllowed(db,'toolbox',undefined),false);
  assert.equal(db.getItem(SAVE_KEY),normal);
  db.setItem(STORY_WORKSHOP_KEY,'{bad');
  const bad=inspectStoryWorkshopRequirement('toolbox',db);
  assert.equal(bad.blocked,true);
  assert.equal(bad.met,false);
  assert.equal(storyDialogueCommitAllowed(db,'toolbox','{bad'),false);
  assert.equal(db.getItem(SAVE_KEY),normal);
});

test('P42 queued toolbox dialogue refuses completion if material is withdrawn before lock',async()=>{
  const db=memory(),story=through('old-pier');
  const next=completeStoryEntry(story,CORE_STORY_PACK,'toolbox','space');
  assert.equal(writeStorySave(db,story,{expectedRaw:null}),true);
  const storyRaw=db.getItem(STORY_SAVE_KEY);
  const stored=storeItem(createInitialState(1_000_000),0);
  assert.equal(writeStoryWorkshop(db,stored.state,{expectedRaw:null}),true);
  const workshopRaw=db.getItem(STORY_WORKSHOP_KEY);
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const locks={request:async(_name,_options,callback)=>{await gate;return callback();}};
  const pending=saveStoryDialogueWithLock(locks,db,next,{
    expectedRaw:storyRaw,
    commitGuard:()=>storyDialogueCommitAllowed(db,'toolbox',workshopRaw)
  });
  const slot=stored.state.warehouse.slots.findIndex(Boolean);
  const withdrawn=withdrawItem(stored.state,slot);
  assert.equal(writeStoryWorkshop(db,withdrawn.state,{expectedRaw:workshopRaw}),true);
  release();
  const outcome=await pending;
  assert.equal(outcome.ok,true);
  assert.equal(outcome.value,false);
  assert.equal(db.getItem(STORY_SAVE_KEY),storyRaw);
  assert.equal(db.getItem(SAVE_KEY),null);
});

test('P42 unchanged real warehouse goal allows a locked optional story completion',async()=>{
  const db=memory(),story=through('old-pier');
  assert.equal(writeStorySave(db,story,{expectedRaw:null}),true);
  const raw=db.getItem(STORY_SAVE_KEY);
  const stored=storeItem(createInitialState(1_000_000),0);
  assert.equal(writeStoryWorkshop(db,stored.state,{expectedRaw:null}),true);
  const workshopRaw=db.getItem(STORY_WORKSHOP_KEY);
  const next=completeStoryEntry(story,CORE_STORY_PACK,'toolbox','label');
  const locks={request:async(_name,_options,callback)=>callback()};
  const result=await saveStoryDialogueWithLock(locks,db,next,{
    expectedRaw:raw,commitGuard:()=>storyDialogueCommitAllowed(db,'toolbox',workshopRaw)
  });
  assert.equal(result.ok,true);
  assert.equal(result.value,true);
  assert.equal(JSON.parse(db.getItem(STORY_SAVE_KEY)).packs.core.choices.toolbox,'label');
  assert.equal(db.getItem(STORY_WORKSHOP_KEY),workshopRaw);
});

test('P42 optional toolbox choice echoes at festival but never gates festival',()=>{
  const before=through('harbor-light');
  assert.equal(mainlineChoiceEcho(entry('festival'),before),null);
  assert.equal(availableStoryEntries(before,CORE_STORY_PACK,'main')[0].id,'festival');
  const variants=[];
  for(const [choice,fragment] of [['label','工具标签'],['space','通道']]){
    const completed=completeStoryEntry(before,CORE_STORY_PACK,'toolbox',choice);
    const raw=JSON.stringify(completed);
    const echo=mainlineChoiceEcho(entry('festival'),completed);
    assert.ok(echo);
    assert.match(echo.text,new RegExp(fragment));
    assert.doesNotMatch(echo.text,/已经出海|航路恢复|邻岛真相/);
    assert.equal(JSON.stringify(completed),raw);
    assert.equal(availableStoryEntries(completed,CORE_STORY_PACK,'main')[0].id,'festival');
    assert.equal(mainlineChoiceEcho({...entry('festival')},completed),null);
    variants.push(echo.text);
  }
  assert.notEqual(...variants);
  const forged=structuredClone(before);
  forged.packs.core.choices.toolbox='label';
  assert.equal(validateStoryProgress(forged),true);
  assert.equal(mainlineChoiceEcho(entry('festival'),forged),null);
});

test('P42 older completed toolbox saves without a choice remain readable',()=>{
  const story=through('harbor-light');
  story.packs.core.completed.side.push('toolbox');
  story.packs.core.checkpoint='toolbox';
  story.revision++;
  assert.equal(validateStoryProgress(story),true);
  assert.equal(mainlineChoiceEcho(entry('festival'),story),null);
  assert.equal(completeStoryEntry(story,CORE_STORY_PACK,'toolbox','label'),story);
});

test('P42 mobile story cards show actual goals without unsafe HTML or fake progress on corrupt save',()=>{
  const ui=readFileSync(new URL('../merge/story/ui.mjs',import.meta.url),'utf8');
  const css=readFileSync(new URL('../merge/story/story.css',import.meta.url),'utf8');
  assert.ok(ui.includes("goal.className='goal-progress'"));
  assert.ok(ui.includes("requirement.description+' · '+Math.min(requirement.current,requirement.goal)+' / '+requirement.goal"));
  assert.ok(ui.includes("requirement.blocked?'工作台需核对'"));
  assert.ok(ui.includes("goal.textContent=requirement.blocked"));
  assert.ok(ui.includes('storyDialogueCommitAllowed(store,entryId,expectedWorkshopRaw)'));
  assert.equal(ui.includes('innerHTML'),false);
  assert.ok(css.includes('.story-card .goal-progress'));
  assert.ok(css.includes('overflow-wrap:anywhere'));
  assert.ok(css.includes('white-space:normal'));
  assert.ok(css.includes('prefers-color-scheme:dark'));
  assert.ok(css.includes('prefers-reduced-motion:reduce'));
});
