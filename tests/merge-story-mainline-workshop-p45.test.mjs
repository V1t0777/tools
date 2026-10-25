import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState,fulfillOrder,storeItem,upgradeBuilding,validateSave} from '../merge/engine.mjs';
import {createEmptyStoryProgress,validateStoryProgress} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {completeStoryEntry,startCoreStory} from '../merge/story/runtime.mjs';
import {storyWorkshopRequirement} from '../merge/story/workshop-gate.mjs';
import {storyWorkshopChapterEcho} from '../merge/story/mainline-workshop-context.mjs';
import {readStoryWorkshop,STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';

const entry=id=>CORE_STORY_PACK.entries.find(x=>x.id===id);
const fresh=()=>startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);
function before(target){
  let save=fresh();
  for(const scene of CORE_STORY_PACK.entries.filter(x=>x.kind==='main')){
    if(scene.id===target)return save;
    save=completeStoryEntry(save,CORE_STORY_PACK,scene.id,scene.choices[0]?.id??null);
  }
  throw Error('Unknown scene '+target);
}
function achieved(){
  const base=createInitialState(1_000_000);
  const order=fulfillOrder(base,base.orders[0].id);
  const warehouse=storeItem(base,0);
  assert.equal(order.ok,true);
  assert.equal(warehouse.ok,true);
  const ready=structuredClone(base);
  ready.coins=2000;ready.xp=2000;
  assert.equal(validateSave(ready),true);
  const garden=upgradeBuilding(ready,'garden');
  assert.equal(garden.ok,true);
  const harbor=upgradeBuilding(garden.state,'harbor');
  assert.equal(harbor.ok,true);
  const storefront=upgradeBuilding(harbor.state,'storefront');
  assert.equal(storefront.ok,true);
  return {base,order:order.state,warehouse:warehouse.state,
    garden:garden.state,harbor:harbor.state,storefront:storefront.state};
}

test('P45 real engine actions create chapter echoes at five gated story scenes',()=>{
  const states=achieved();
  const cases=[
    ['first-order',before('first-order'),states.order,/交付的街坊委托/],
    ['toolbox',before('apprentice'),states.warehouse,/收进剧情仓库/],
    ['tea-table',before('tea-table'),states.garden,/花园确实已经修复/],
    ['harbor-light',before('harbor-light'),states.harbor,/修缮已经完成/],
    ['festival',before('festival'),states.storefront,/门面终于修整妥当/]
  ];
  for(const [id,story,workshop,fragment] of cases){
    const storyRaw=JSON.stringify(story),workshopRaw=JSON.stringify(workshop);
    assert.equal(storyWorkshopRequirement(id,workshop).met,true,id);
    const echo=storyWorkshopChapterEcho(entry(id),story,workshop);
    assert.ok(echo,id);
    assert.match(echo.text,fragment,id);
    assert.equal(JSON.stringify(story),storyRaw,'read-only story '+id);
    assert.equal(JSON.stringify(workshop),workshopRaw,'read-only workshop '+id);
  }
});

test('P45 unfulfilled, withdrawn, invalid and unavailable workshop goals never claim success',()=>{
  const states=achieved();
  const cases=[
    ['first-order',before('first-order')],
    ['toolbox',before('apprentice')],
    ['tea-table',before('tea-table')],
    ['harbor-light',before('harbor-light')],
    ['festival',before('festival')]
  ];
  for(const [id,story] of cases){
    assert.equal(storyWorkshopChapterEcho(entry(id),story,states.base),null,id);
    assert.equal(storyWorkshopChapterEcho(entry(id),story,null),null,id);
    assert.equal(storyWorkshopChapterEcho(entry(id),story,{board:[]}),null,id);
  }
  const db={getItem:key=>key===STORY_WORKSHOP_KEY?'{bad-json':null,setItem(){}};
  const corrupted=readStoryWorkshop(db);
  assert.equal(corrupted.blocked,true);
  assert.equal(storyWorkshopChapterEcho(entry('festival'),before('festival'),corrupted.state),null);
});

test('P45 prerequisites must be committed before an achievement can be narrated',()=>{
  const states=achieved();
  assert.equal(storyWorkshopChapterEcho(entry('first-order'),fresh(),states.order),null);
  assert.equal(storyWorkshopChapterEcho(entry('toolbox'),before('old-pier'),states.warehouse),null);
  assert.equal(storyWorkshopChapterEcho(entry('tea-table'),before('seed'),states.garden),null);
  assert.equal(storyWorkshopChapterEcho(entry('harbor-light'),before('apprentice'),states.harbor),null);
  assert.equal(storyWorkshopChapterEcho(entry('festival'),before('harbor-light'),states.storefront),null);
  const forged=fresh();
  forged.packs.core.choices.seed='keep';
  assert.equal(validateStoryProgress(forged),true);
  assert.equal(storyWorkshopChapterEcho(entry('tea-table'),forged,states.garden),null);
});

test('P45 colliding DLC entries cannot inherit any core chapter economic feedback',()=>{
  const states=achieved();
  for(const [id,story,workshop] of [
    ['first-order',before('first-order'),states.order],
    ['toolbox',before('apprentice'),states.warehouse],
    ['tea-table',before('tea-table'),states.garden],
    ['harbor-light',before('harbor-light'),states.harbor],
    ['festival',before('festival'),states.storefront]
  ]){
    assert.ok(storyWorkshopChapterEcho(entry(id),story,workshop));
    assert.equal(storyWorkshopChapterEcho({...entry(id)},story,workshop),null,id);
    assert.equal(storyWorkshopChapterEcho({id,kind:entry(id).kind},story,workshop),null,id);
  }
  assert.equal(storyWorkshopChapterEcho(entry('old-crate'),before('festival'),states.storefront),null);
});

test('P45 mobile dialogue appends read-only goal feedback only for persisted valid workshop',()=>{
  const ui=readFileSync(new URL('../merge/story/ui.mjs',import.meta.url),'utf8');
  assert.ok(ui.includes("import {storyWorkshopChapterEcho} from './mainline-workshop-context.mjs';"));
  assert.ok(ui.includes("if(entry.kind==='main'||entry.kind==='side'){"));
  assert.ok(ui.includes('const chapterEcho=storyWorkshopChapterEcho(entry,progress,workshop.state);'));
  assert.ok(ui.includes('if(chapterEcho)lines.push(chapterEcho);'));
  assert.ok(ui.includes("if(!workshop.blocked&&workshop.raw!==null)"));
  assert.ok(ui.includes('text.textContent=line.text;'));
  assert.ok(ui.includes('const requirement=inspectStoryWorkshopRequirement(entry.id,store);'));
  for(const unsafe of ['innerHTML','insertAdjacentHTML','fetch(','sendBeacon('])
    assert.equal(ui.includes(unsafe),false,unsafe);
});
