import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmptyStoryProgress,validateStoryProgress} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry,availableStoryEntries} from '../merge/story/runtime.mjs';
import {mainlineChoiceEcho} from '../merge/story/mainline-choice-context.mjs';

const main=CORE_STORY_PACK.entries.filter(entry=>entry.kind==='main');
const festival=main.find(entry=>entry.id==='festival');
const fresh=()=>startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);
function beforeFestival(){
  let progress=fresh();
  for(const entry of main){
    if(entry.id==='festival')return progress;
    progress=completeStoryEntry(progress,CORE_STORY_PACK,entry.id,entry.choices[0]?.id??null);
  }
  throw Error('Missing festival');
}

test('P152 optional toolbox choice creates two distinct, safety-consistent festival acknowledgements',()=>{
  const before=beforeFestival();
  assert.equal(mainlineChoiceEcho(festival,before),null,
    'the festival must not invent an optional toolbox memory');
  assert.deepEqual(availableStoryEntries(before,CORE_STORY_PACK,'main').map(x=>x.id),['festival']);
  const replies=[];
  for(const [choice,fragment] of [['label','工具标签'],['space','通道']]){
    const story=completeStoryEntry(before,CORE_STORY_PACK,'toolbox',choice);
    const snapshot=JSON.stringify(story);
    assert.equal(validateStoryProgress(story),true);
    assert.deepEqual(availableStoryEntries(story,CORE_STORY_PACK,'main').map(x=>x.id),['festival'],
      'the optional quest must not add a festival gate');
    const echo=mainlineChoiceEcho(festival,story);
    assert.ok(echo,choice);
    assert.match(echo.text,new RegExp(fragment),choice);
    assert.doesNotMatch(echo.text,/航路已经安全|确定失主|世界真相|已经解开/);
    assert.equal(JSON.stringify(story),snapshot,'echo cannot mutate story progress');
    replies.push(echo.text);
  }
  assert.notEqual(...replies,'both optional choices must remain meaningful');
  assert.equal(before.packs.core.completed.side.includes('toolbox'),false);
});

test('P152 a forged toolbox choice or a colliding DLC festival never receives the core echo',()=>{
  const before=beforeFestival();
  const forged=structuredClone(before);
  forged.packs.core.choices.toolbox='label';
  assert.equal(validateStoryProgress(forged),true,
    'schema validity alone cannot prove a quest was completed');
  assert.equal(mainlineChoiceEcho(festival,forged),null);
  const completed=completeStoryEntry(before,CORE_STORY_PACK,'toolbox','space');
  assert.ok(mainlineChoiceEcho(festival,completed));
  assert.equal(mainlineChoiceEcho({...festival},completed),null);
  assert.equal(mainlineChoiceEcho({id:'festival',kind:'main'},completed),null);
  assert.equal(mainlineChoiceEcho({...festival,kind:'side'},completed),null);
  assert.equal(mainlineChoiceEcho(festival,{packs:{}}),null);
});

test('P152 optional workshop memory neither rewrites the first-volume finale nor grants resources',()=>{
  const before=beforeFestival();
  const withToolbox=completeStoryEntry(before,CORE_STORY_PACK,'toolbox','label');
  const completedFestival=completeStoryEntry(withToolbox,CORE_STORY_PACK,'festival');
  const ending=completeStoryEntry(completedFestival,CORE_STORY_PACK,'letter-answer');
  assert.equal(ending.packs.core.completed.main.length,12);
  assert.deepEqual(ending.packs.core.completed.side,['toolbox']);
  assert.deepEqual(availableStoryEntries(ending,CORE_STORY_PACK,'main'),[]);
  assert.equal(ending.packs.core.choices.toolbox,'label');
  assert.equal(ending.packs.core.completed.incident.length,0);
  assert.equal(ending.packs.core.checkpoint,'letter-answer');
  assert.equal(Object.keys(ending.packs).join(','),'core');
  for(const key of ['coins','energy','board','warehouse','xp'])
    assert.equal(Object.hasOwn(ending,key),false,key+' is not a narrative reward');
  assert.equal(mainlineChoiceEcho(festival,ending)?.speaker,'学徒');
});
