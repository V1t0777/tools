import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {dailyStoryIncident,completeStoryEntry,startCoreStory} from '../merge/story/runtime.mjs';
import {incidentWorkshopEcho} from '../merge/story/incident-context.mjs';
import {createInitialState,fulfillOrder,upgradeBuilding,validateSave} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';

const fresh=()=>startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);
const incident=id=>CORE_STORY_PACK.entries.find(e=>e.kind==='incident'&&e.id===id);
test('P30 rejects impossible Gregorian incident calendar days, including century leap rules',()=>{
  const story=fresh();
  const wrong=['','2026-02-29','2026-02-30','2026-04-31','2026-13-01','2026-00-10',
    '2026-01-00','2026-01-32','2026-1-01','0000-01-01','1900-02-29','2026-10-25T00:00'];
  for(const day of wrong)assert.throws(()=>dailyStoryIncident(story,CORE_STORY_PACK,day),TypeError,day);
  for(const day of ['2024-02-29','2000-02-29','1900-02-28','2026-10-25','9999-12-31'])
    assert.doesNotThrow(()=>dailyStoryIncident(story,CORE_STORY_PACK,day),day);
});
test('P30 six core daily incidents preserve narrative-only selection and do not require an economy save',()=>{
  const story=fresh();
  for(const event of CORE_STORY_PACK.entries.filter(e=>e.kind==='incident')){
    assert.equal(incidentWorkshopEcho(event,null),null);
    assert.equal(incidentWorkshopEcho(event,{board:[]}),null);
  }
  assert.equal(incidentWorkshopEcho({id:'unknown-dlc',kind:'incident'},createInitialState(1000000)),null);
  assert.equal(incidentWorkshopEcho({id:'fog',kind:'main'},createInitialState(1000000)),null);
  const day='2026-10-25';
  const first=dailyStoryIncident(story,CORE_STORY_PACK,day);
  assert.equal(dailyStoryIncident(story,CORE_STORY_PACK,day)?.id,first?.id);
});
test('P30 actual workshop fulfillment changes event dialogue without changing resources or save',()=>{
  const initial=createInitialState(1000000);
  const order=initial.orders[0];
  const before=JSON.stringify(initial);
  const beforeEcho=incidentWorkshopEcho(incident('baking'),initial);
  assert.match(beforeEcho.text,/还等着/);
  const result=fulfillOrder(initial,order.id);
  assert.equal(result.ok,true);
  assert.equal(validateSave(result.state),true);
  const after=JSON.stringify(result.state);
  assert.match(incidentWorkshopEcho(incident('baking'),result.state).text,/已经认真交付过/);
  assert.match(incidentWorkshopEcho(incident('visitor'),result.state).text,/已经重新接下/);
  assert.equal(JSON.stringify(initial),before);
  assert.equal(JSON.stringify(result.state),after,'read-only narrative does not consume coins/items');
});
test('P30 real building upgrades change garden, harbor and storefront event echoes',()=>{
  const base=createInitialState(1000000);
  const ready=structuredClone(base);ready.coins=2000;ready.xp=2000;
  assert.equal(validateSave(ready),true);
  const g=upgradeBuilding(ready,'garden');
  assert.equal(g.ok,true);
  const h=upgradeBuilding(g.state,'harbor');
  assert.equal(h.ok,true);
  const s=upgradeBuilding(h.state,'storefront');
  assert.equal(s.ok,true);
  assert.match(incidentWorkshopEcho(incident('surprise-rain'),ready).text,/等着修复/);
  assert.match(incidentWorkshopEcho(incident('surprise-rain'),s.state).text,/修复过的花园/);
  assert.match(incidentWorkshopEcho(incident('fog'),ready).text,/还没有修好/);
  assert.match(incidentWorkshopEcho(incident('fog'),s.state).text,/已经修缮/);
  assert.match(incidentWorkshopEcho(incident('old-crate'),s.state).text,/修缮后的港湾街角/);
  assert.match(incidentWorkshopEcho(incident('cat-nap'),ready).text,/没有修整好/);
  assert.match(incidentWorkshopEcho(incident('cat-nap'),s.state).text,/门面修整以后/);
});
test('P30 daily narrative echoes leave mainline, optional choices, existing saves and DLC slots intact',()=>{
  let story=fresh();
  for(const entry of CORE_STORY_PACK.entries.filter(e=>e.kind==='main').slice(0,10))
    story=completeStoryEntry(story,CORE_STORY_PACK,entry.id,entry.choices[0]?.id??null);
  const workshop=createInitialState(1000000);
  const initialStory=JSON.stringify(story),initialWorkshop=JSON.stringify(workshop);
  const daily=dailyStoryIncident(story,CORE_STORY_PACK,'2026-10-25');
  assert.ok(daily);
  const echo=incidentWorkshopEcho(daily,workshop);
  assert.ok(echo&&echo.speaker&&echo.text);
  assert.equal(JSON.stringify(story),initialStory);
  assert.equal(JSON.stringify(workshop),initialWorkshop);
  assert.equal(story.packs.core.completed.side.length,0);
  assert.equal(story.packs.core.completed.incident.length,0);
  assert.equal(Object.keys(story.packs).join(','),'core');
});
test('P30 mobile story page only adds read-only event lines for valid persisted story workshop',()=>{
  const ui=readFileSync(new URL('../merge/story/ui.mjs',import.meta.url),'utf8');
  const runtime=readFileSync(new URL('../merge/story/runtime.mjs',import.meta.url),'utf8');
  assert.ok(ui.includes("import {incidentWorkshopEcho} from './incident-context.mjs';"));
  assert.ok(ui.includes("if(entry.kind==='incident'){"));
  assert.ok(ui.includes("!workshop.blocked&&workshop.raw!==null"));
  assert.ok(ui.includes("if(echo)lines.push(echo);"));
  assert.ok(ui.includes("replaceChildren(...lines.map(lineElement))"));
  assert.ok(runtime.includes('validLocalCalendarDay(dayKey)'));
  for(const unsafe of ['innerHTML','insertAdjacentHTML','sendBeacon(','fetch('])
    assert.equal(ui.includes(unsafe),false,unsafe);
  // STORY_SAVE_KEY is allowed, but a standalone ordinary-mode SAVE_KEY is not.
  assert.equal(/(^|[^A-Za-z0-9_])SAVE_KEY(?![A-Za-z0-9_])/.test(ui),false);
  assert.notEqual(SAVE_KEY,'toolbox.merge-isle.story.local.v1');
});
