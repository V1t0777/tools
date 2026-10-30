import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {readStoryHash} from '../merge/story/story-return-route.mjs';
import {storyWorkshopGoalHref} from '../merge/story/workshop-gate.mjs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const destinations=Object.freeze({
  'orders-goal':'first-order',
  'warehouse-goal':'toolbox',
  'garden-goal':'tea-table',
  'harbor-goal':'harbor-light',
  'storefront-goal':'festival'
});

test('P44 every gated workshop section has an exact return link to its core story card',()=>{
  const html=read('../merge/story-workshop.html');
  for(const [goal,entryId] of Object.entries(destinations)){
    const scene=CORE_STORY_PACK.entries.find(e=>e.id===entryId);
    assert.ok(scene&&['main','side'].includes(scene.kind));
    assert.equal(storyWorkshopGoalHref(entryId),'./story-workshop.html#'+goal);
    const section=html.match(new RegExp('<section[^>]*id="'+goal+'"[^>]*>[\\s\\S]*?<\\/section>'));
    assert.ok(section,'missing workshop goal '+goal);
    const href='./story.html#story-'+entryId;
    assert.ok(section[0].includes('href="'+href+'"'),goal+' return must target exact story');
    assert.deepEqual(readStoryHash('#story-'+entryId),{kind:scene.kind,entryId});
  }
});

test('P44 all core main and side entries are routable without expanding DLC namespace',()=>{
  for(const scene of CORE_STORY_PACK.entries.filter(e=>e.kind==='main'||e.kind==='side'))
    assert.deepEqual(readStoryHash('#story-'+scene.id),{kind:scene.kind,entryId:scene.id});
  for(const hash of ['#story-old-crate','#story-nonexistent','#story-__proto__',
    '#story-toolbox?evil','#story-toolbox/other','#story-%74oolbox',
    '#story-<script>','',null,undefined])
    assert.deepEqual(readStoryHash(hash),{kind:'main',entryId:null});
  assert.deepEqual(readStoryHash('#side'),{kind:'side',entryId:null});
  assert.deepEqual(readStoryHash('#incident'),{kind:'incident',entryId:null});
  assert.deepEqual(readStoryHash('#main'),{kind:'main',entryId:null});
});

test('P44 story page safely focuses a rendered card only for validated fragment routes',()=>{
  const ui=read('../merge/story/ui.mjs');
  assert.ok(ui.includes("import {readStoryHash} from './story-return-route.mjs';"));
  assert.ok(ui.includes("wrapper.id='story-'+entry.id;"));
  assert.ok(ui.includes('wrapper.tabIndex=-1;'));
  assert.ok(ui.includes("window.addEventListener('hashchange',syncStoryHash);"));
  assert.ok(ui.includes('const route=readStoryHash(window.location.hash);'));
  assert.ok(ui.includes("document.getElementById('story-'+route.entryId)"));
  assert.ok(ui.includes('if(!target)return;'));
  assert.ok(ui.includes('target.focus({preventScroll:true});'));
  assert.ok(ui.includes("target.scrollIntoView({block:'nearest'});"));
  assert.equal(ui.includes('innerHTML'),false);
  assert.equal(ui.includes('window.localStorage.setItem('),false);
});

test('P44 fragment highlighting remains accessible on mobile, in dark mode and reduced motion',()=>{
  const css=read('../merge/story/story.css');
  assert.match(css,/\.story-card:target,\.story-card:focus\{[^}]*outline:/);
  assert.match(css,/\.story-card:target,\.story-card:focus\{[^}]*scroll-margin-top:/);
  assert.ok(css.includes('safe-area-inset'));
  assert.ok(css.includes('prefers-color-scheme:dark'));
  assert.ok(css.includes('prefers-reduced-motion:reduce'));
  const html=read('../merge/story-workshop.html');
  assert.ok(html.includes('href="./story.html"'),'generic return remains available');
});

test('P44 read-only fragment resolution does not mutate core story content',()=>{
  const before=JSON.stringify(CORE_STORY_PACK);
  for(const entry of CORE_STORY_PACK.entries)
    readStoryHash('#story-'+entry.id);
  assert.equal(JSON.stringify(CORE_STORY_PACK),before);
  const helper=read('../merge/story/story-return-route.mjs');
  assert.equal(/(?:localStorage|sessionStorage|setItem|pushState|replaceState|innerHTML)/.test(helper),false);
});
