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
