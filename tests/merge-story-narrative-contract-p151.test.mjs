import test from 'node:test';
import assert from 'node:assert/strict';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {startCoreStory,availableStoryEntries,completeStoryEntry,validateStoryPack} from '../merge/story/runtime.mjs';
import {storyWorkshopRequirement,storyWorkshopGoalHref} from '../merge/story/workshop-gate.mjs';
import {createInitialState} from '../merge/engine.mjs';

const main=CORE_STORY_PACK.entries.filter(entry=>entry.kind==='main');
const byId=new Map(CORE_STORY_PACK.entries.map(entry=>[entry.id,entry]));

test('P151 first volume keeps four ordered chapters and a single causal mainline',()=>{
  assert.equal(validateStoryPack(CORE_STORY_PACK),true);
  const chapters=[
    ['第一章 · 初见云屿',['arrival','signboard','first-order','ledger']],
    ['第二章 · 花园旧事',['garden-path','seed','tea-table']],
    ['第三章 · 旧港湾',['old-pier','apprentice','harbor-light']],
    ['第四章 · 灯火再起',['festival','letter-answer']]
  ];
  assert.deepEqual(main.map(entry=>entry.id),chapters.flatMap(([,ids])=>ids));
  for(const [chapter,ids] of chapters)
    for(const id of ids)assert.equal(byId.get(id).chapter,chapter,id+' chapter');
  main.forEach((entry,index)=>{
    assert.deepEqual(entry.requires,index?[main[index-1].id]:[],entry.id+' must follow previous scene');
  });
  assert.deepEqual(byId.get('letter-answer').requires,['festival'],
    'the anonymous letter reveal must remain after the opening festival');
});

test('P151 real workshop milestones stay attached to the intended narrative beats',()=>{
  const workshop=createInitialState(1000000);
  const goals={
    'first-order':'orders-goal',
    'tea-table':'garden-goal',
    'harbor-light':'harbor-goal',
    'festival':'storefront-goal',
    'toolbox':'warehouse-goal'
  };
  for(const [entryId,anchor] of Object.entries(goals)){
    assert.ok(byId.has(entryId),'missing story milestone '+entryId);
    const gate=storyWorkshopRequirement(entryId,workshop);
    assert.equal(gate.required,true,entryId+' must require genuine workshop state');
    assert.equal(gate.goal,1,entryId+' goal');
    assert.equal(gate.met,false,entryId+' cannot be complete in a fresh workshop');
    assert.equal(storyWorkshopGoalHref(entryId),'./story-workshop.html#'+anchor);
  }
  for(const entry of main.filter(entry=>!Object.hasOwn(goals,entry.id)))
    assert.equal(storyWorkshopRequirement(entry.id,workshop).required,false,
      entry.id+' must not acquire an unplanned economic gate');
});

test('P151 optional stories and daily incidents never block the first-volume finale',()=>{
  const mainIds=new Set(main.map(entry=>entry.id));
  const optional=CORE_STORY_PACK.entries.filter(entry=>entry.kind!=='main');
  for(const entry of optional){
    assert.ok(entry.requires.length>0,entry.id+' needs a story anchor');
    assert.ok(entry.requires.every(id=>mainIds.has(id)),
      entry.id+' must not depend on another optional entry');
    // The found crate is a one-off mystery clue; all other daily incidents replay.
    assert.equal(entry.repeatable,entry.kind==='incident'&&entry.id!=='old-crate',
      entry.id+' one-off versus replayable incident contract');
  }
  const incidentUnlocks={
    'cat-nap':'signboard','surprise-rain':'garden-path',
    'visitor':'ledger','fog':'old-pier',
    'baking':'first-order','old-crate':'harbor-light'
  };
  for(const [id,anchor] of Object.entries(incidentUnlocks))
    assert.deepEqual(byId.get(id).requires,[anchor],id+' unlock chronology');
  let progress=startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);
  for(const entry of main){
    assert.deepEqual(availableStoryEntries(progress,CORE_STORY_PACK,'main').map(x=>x.id),
      [entry.id],'mainline should offer exactly the next scene');
    progress=completeStoryEntry(progress,CORE_STORY_PACK,entry.id,entry.choices[0]?.id??null);
  }
  assert.equal(progress.packs.core.completed.main.length,12);
  assert.deepEqual(progress.packs.core.completed.side,[]);
  assert.deepEqual(progress.packs.core.completed.incident,[]);
  assert.deepEqual(availableStoryEntries(progress,CORE_STORY_PACK,'main'),[]);
});
