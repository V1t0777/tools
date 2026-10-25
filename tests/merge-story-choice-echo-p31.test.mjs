import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEmptyStoryProgress,validateStoryProgress} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {completeStoryEntry,dailyStoryIncident,startCoreStory} from '../merge/story/runtime.mjs';
import {incidentChoiceEcho} from '../merge/story/incident-choice-context.mjs';

const incident=id=>CORE_STORY_PACK.entries.find(e=>e.kind==='incident'&&e.id===id);
const fresh=()=>startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);
function through(target,choices={}){
  let save=fresh();
  for(const entry of CORE_STORY_PACK.entries.filter(e=>e.kind==='main')){
    save=completeStoryEntry(save,CORE_STORY_PACK,entry.id,
      choices[entry.id]??entry.choices[0]?.id??null);
    if(entry.id===target)return save;
  }
  throw new Error('Unknown mainline checkpoint');
}

test('P35 arrival choice is remembered during the cat incident only after completion',()=>{
  assert.equal(incidentChoiceEcho(incident('cat-nap'),fresh()),null);
  for(const [choice,fragment] of [['help','一起打开店门'],['ask','先问起的就是']]){
    const story=through('arrival',{arrival:choice});
    assert.match(incidentChoiceEcho(incident('cat-nap'),story).text,new RegExp(fragment));
  }
  const help=through('arrival',{arrival:'help'});
  const ask=through('arrival',{arrival:'ask'});
  assert.notEqual(incidentChoiceEcho(incident('cat-nap'),help).text,
    incidentChoiceEcho(incident('cat-nap'),ask).text);
});

test('P35 first-order choice changes baking echo without altering economic rewards',()=>{
  const before=through('signboard');
  assert.equal(incidentChoiceEcho(incident('baking'),before),null);
  for(const [choice,fragment] of [['listen','慢慢听完食谱'],['smile','不必每一次都完美']]){
    const story=through('first-order',{'first-order':choice});
    const snapshot=JSON.stringify(story);
    assert.match(incidentChoiceEcho(incident('baking'),story).text,new RegExp(fragment));
    assert.equal(JSON.stringify(story),snapshot);
    assert.equal('coins' in story,false);
    assert.equal('energy' in story,false);
  }
});

test('P35 new first-chapter echoes reject colliding DLC event objects and uncommitted choices',()=>{
  const story=through('first-order',{arrival:'help','first-order':'listen'});
  for(const id of ['cat-nap','baking']){
    assert.ok(incidentChoiceEcho(incident(id),story));
    assert.equal(incidentChoiceEcho({...incident(id)},story),null);
    assert.equal(incidentChoiceEcho({id,kind:'incident'},story),null);
  }
  const forged=fresh();
  forged.packs.core.choices.arrival='help';
  forged.packs.core.choices['first-order']='listen';
  assert.equal(validateStoryProgress(forged),true);
  assert.equal(incidentChoiceEcho(incident('cat-nap'),forged),null);
  assert.equal(incidentChoiceEcho(incident('baking'),forged),null);
});

test('P31 seed choice changes rain echo only after committed mainline choice',()=>{
  const early=through('garden-path');
  assert.equal(incidentChoiceEcho(incident('surprise-rain'),early),null);
  const kept=through('seed',{seed:'keep'}),tried=through('seed',{seed:'try'});
  assert.match(incidentChoiceEcho(incident('surprise-rain'),kept).text,/旧花种和标签/);
  assert.match(incidentChoiceEcho(incident('surprise-rain'),tried).text,/新试种的一角/);
  assert.notEqual(incidentChoiceEcho(incident('surprise-rain'),kept).text,
    incidentChoiceEcho(incident('surprise-rain'),tried).text);
});

test('P31 apprentice choice preserves harbor safety under fog for both branches',()=>{
  const before=through('old-pier');
  assert.equal(incidentChoiceEcho(incident('fog'),before),null);
  for(const [choice,fragment] of [['teach','示范的步骤'],['trust','封好湿滑']]){
    const echo=incidentChoiceEcho(incident('fog'),through('apprentice',{apprentice:choice}));
    assert.match(echo.text,new RegExp(fragment));
    assert.match(echo.text,/岚叔/);
    assert.doesNotMatch(echo.text,/出海了|恢复航路|启航/);
  }
});

test('P31 optional postcard choice echoes without gating mainline or claiming letter delivered',()=>{
  const before=through('tea-table');
  assert.equal(incidentChoiceEcho(incident('visitor'),before),null);
  for(const [choice,fragment] of [['send','亲自投递'],['hold','不寄也是她自己的决定']]){
    const after=completeStoryEntry(before,CORE_STORY_PACK,'postcard',choice);
    assert.equal(validateStoryProgress(after),true);
    assert.match(incidentChoiceEcho(incident('visitor'),after).text,new RegExp(fragment));
    assert.equal(after.packs.core.completed.main.length,before.packs.core.completed.main.length);
    assert.equal(after.packs.core.completed.side.includes('postcard'),true);
  }
});

test('P31 rejects missing, corrupt, uncommitted, unknown and colliding DLC contexts',()=>{
  const save=fresh();
  assert.equal(incidentChoiceEcho(incident('fog'),null),null);
  assert.equal(incidentChoiceEcho(incident('fog'),{packs:{}}),null);
  assert.equal(incidentChoiceEcho({id:'fog',kind:'incident'},save),null,
    'DLC entry reusing a core ID must not inherit core choice echo');
  assert.equal(incidentChoiceEcho({id:'other-dlc',kind:'incident'},save),null);
  assert.equal(incidentChoiceEcho(incident('cat-nap'),save),null);
  const injected=structuredClone(save);
  injected.packs.core.choices.seed='keep';
  assert.equal(validateStoryProgress(injected),true);
  assert.equal(incidentChoiceEcho(incident('surprise-rain'),injected),null,
    'a choice key alone is not proof of completed mainline');
});

test('P31 read-only choice echo never mutates progress, event rotation or economic resources',()=>{
  const save=through('apprentice',{seed:'try',apprentice:'trust'});
  const original=JSON.stringify(save);
  const selected=dailyStoryIncident(save,CORE_STORY_PACK,'2026-10-25')?.id;
  assert.ok(incidentChoiceEcho(incident('fog'),save));
  assert.ok(incidentChoiceEcho(incident('surprise-rain'),save));
  assert.equal(JSON.stringify(save),original);
  assert.equal(dailyStoryIncident(save,CORE_STORY_PACK,'2026-10-25')?.id,selected);
  for(const key of ['coins','energy','board','warehouse','xp'])assert.equal(key in save,false);
});

test('P31 UI adds choice echo independently of workshop availability and renders text safely',()=>{
  const ui=readFileSync(new URL('../merge/story/ui.mjs',import.meta.url),'utf8');
  assert.ok(ui.includes("import {incidentChoiceEcho} from './incident-choice-context.mjs';"));
  assert.ok(ui.includes('const choiceEcho=incidentChoiceEcho(entry,progress);'));
  assert.ok(ui.includes('if(choiceEcho)lines.push(choiceEcho);'));
  assert.ok(ui.includes("if(!workshop.blocked&&workshop.raw!==null)"));
  assert.ok(ui.includes('text.textContent=line.text;'));
  assert.equal(ui.includes('innerHTML'),false);
});

test('P37 old-crate choice echoes only after its first committed incident, without solving the mystery',()=>{
  const before=through('harbor-light');
  assert.equal(incidentChoiceEcho(incident('old-crate'),before),null);
  const variants=[];
  for(const [choice,fragment] of [['register','港湾登记簿'],['ask','旧榫接']]){
    const committed=completeStoryEntry(before,CORE_STORY_PACK,'old-crate',choice);
    const snapshot=JSON.stringify(committed);
    const echo=incidentChoiceEcho(incident('old-crate'),committed);
    assert.match(echo.text,new RegExp(fragment));
    assert.match(echo.text,/没有让任何人擅自打开|封存/);
    assert.doesNotMatch(echo.text,/找到失主|已经打开|确定来自邻岛/);
    assert.equal(JSON.stringify(committed),snapshot,'echo is read-only');
    assert.equal(completeStoryEntry(committed,CORE_STORY_PACK,'old-crate',
      choice==='register'?'ask':'register'),committed,'repeat viewing cannot rewrite the original choice');
    assert.equal(incidentChoiceEcho({...incident('old-crate')},committed),null,'DLC ID collision is isolated');
    variants.push(echo.text);
  }
  assert.notEqual(...variants);
  const forged=structuredClone(before);
  forged.packs.core.choices['old-crate']='register';
  assert.equal(validateStoryProgress(forged),true);
  assert.equal(incidentChoiceEcho(incident('old-crate'),forged),null,
    'a stored choice without a completed incident is not a consequence');
});
