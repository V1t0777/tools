import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEmptyStoryProgress,validateStoryProgress} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {completeStoryEntry,startCoreStory,dailyStoryIncident} from '../merge/story/runtime.mjs';
import {mainlineChoiceEcho} from '../merge/story/mainline-choice-context.mjs';

const entry=id=>CORE_STORY_PACK.entries.find(e=>e.id===id);
const fresh=()=>startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);
function before(target,choices={}){
  let save=fresh();
  for(const item of CORE_STORY_PACK.entries.filter(e=>e.kind==='main')){
    if(item.id===target)return save;
    save=completeStoryEntry(save,CORE_STORY_PACK,item.id,
      choices[item.id]??item.choices[0]?.id??null);
  }
  throw Error('Unknown checkpoint '+target);
}

test('P41 a saved seed choice pays off differently when the tea table opens',()=>{
  assert.equal(mainlineChoiceEcho(entry('tea-table'),before('seed')),null);
  const seen=[];
  for(const [choice,fragment] of [['keep','旧种子标签'],['try','试种']]){
    const progress=before('tea-table',{seed:choice}),raw=JSON.stringify(progress);
    const echo=mainlineChoiceEcho(entry('tea-table'),progress);
    assert.ok(echo);
    assert.match(echo.text,new RegExp(fragment));
    assert.equal(echo.speaker,'晚禾');
    assert.equal(JSON.stringify(progress),raw,'narrative consequence is read-only');
    seen.push(echo.text);
  }
  assert.notEqual(...seen);
});

test('P41 apprentice lesson changes the later harbor-light mainline acknowledgement',()=>{
  assert.equal(mainlineChoiceEcho(entry('harbor-light'),before('apprentice')),null);
  const seen=[];
  for(const [choice,fragment] of [['teach','岚叔教过的步骤'],['trust','先把安全放在勇气前面']]){
    const progress=before('harbor-light',{apprentice:choice});
    const echo=mainlineChoiceEcho(entry('harbor-light'),progress);
    assert.ok(echo);
    assert.match(echo.text,new RegExp(fragment));
    assert.match(echo.text,/学徒|岚叔/);
    assert.doesNotMatch(echo.text,/擅自出海|航路完全恢复|离岛/);
    seen.push(echo.text);
  }
  assert.notEqual(...seen);
});

test('P41 a colliding DLC mainline node never inherits first-volume consequence',()=>{
  const save=before('harbor-light',{apprentice:'trust'});
  for(const id of ['harbor-light','tea-table']){
    assert.ok(mainlineChoiceEcho(entry(id),save));
    assert.equal(mainlineChoiceEcho({...entry(id)},save),null);
    assert.equal(mainlineChoiceEcho({id,kind:'main'},save),null);
  }
  assert.equal(mainlineChoiceEcho({...entry('harbor-light'),kind:'incident'},save),null);
  assert.equal(mainlineChoiceEcho(entry('ledger'),save),null);
});

test('P41 invalid or forged uncompleted choices do not produce chapter consequences',()=>{
  assert.equal(mainlineChoiceEcho(entry('tea-table'),null),null);
  assert.equal(mainlineChoiceEcho(entry('tea-table'),{packs:{}}),null);
  const story=before('seed');
  story.packs.core.choices.seed='keep';
  assert.equal(validateStoryProgress(story),true);
  assert.equal(mainlineChoiceEcho(entry('tea-table'),story),null);
  const harbor=before('apprentice');
  harbor.packs.core.choices.apprentice='trust';
  assert.equal(validateStoryProgress(harbor),true);
  assert.equal(mainlineChoiceEcho(entry('harbor-light'),harbor),null);
});

test('P41 mainline echo does not change story saves, day selection or economy',()=>{
  const save=before('harbor-light',{seed:'keep',apprentice:'teach'});
  const raw=JSON.stringify(save),day='2026-10-25';
  const selected=dailyStoryIncident(save,CORE_STORY_PACK,day)?.id;
  assert.ok(mainlineChoiceEcho(entry('tea-table'),save));
  assert.ok(mainlineChoiceEcho(entry('harbor-light'),save));
  assert.equal(JSON.stringify(save),raw);
  assert.equal(dailyStoryIncident(save,CORE_STORY_PACK,day)?.id,selected);
  for(const key of ['coins','energy','xp','board','warehouse'])
    assert.equal(Object.hasOwn(save,key),false);
});

test('P41 UI displays mainline echoes without unsafe markup or affecting completion gate',()=>{
  const ui=readFileSync(new URL('../merge/story/ui.mjs',import.meta.url),'utf8');
  assert.ok(ui.includes("import {mainlineChoiceEcho} from './mainline-choice-context.mjs';"));
  assert.ok(ui.includes("if(entry.kind==='main'){"));
  assert.ok(ui.includes('const mainlineEcho=mainlineChoiceEcho(entry,progress);'));
  assert.ok(ui.includes('if(mainlineEcho)lines.push(mainlineEcho);'));
  assert.ok(ui.includes('text.textContent=line.text;'));
  assert.ok(ui.includes('const requirement=inspectStoryWorkshopRequirementFromRead(entry.id,workshopRead);'));
  assert.ok(ui.includes('const workshopForRender=blocked?null:readStoryWorkshop(store);'));
  assert.equal(ui.includes('innerHTML'),false);
});
