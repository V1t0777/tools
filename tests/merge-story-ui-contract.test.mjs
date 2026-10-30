import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('story preview is reachable from normal mode but isolated from normal engine',()=>{
  const index=read('../merge/index.html');
  const story=read('../merge/story.html');
  const scripts=[...index.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)].map(match=>match[1]);
  assert.deepEqual(scripts,['./main-locked.mjs'],'the story-enabled normal page must load exactly one locked runtime');
  const normal=read('../merge/'+scripts[0].slice(2));
  const ui=read('../merge/story/ui.mjs');
  assert.ok(index.includes('href="./story.html"'));
  assert.ok(story.includes('src="./story/ui.mjs"'));
  assert.ok(story.includes('href="./index.html"'));
  assert.ok(ui.includes('readStorySave('));
  assert.ok(ui.includes('dailyStoryIncident('));
  assert.equal(normal.includes('story/ui.mjs'),false);
  assert.equal(normal.includes('mode-boundaries.mjs'),false);
});
test('UI renders story as text and keeps unrelated economy and network untouched',()=>{
  const ui=read('../merge/story/ui.mjs');
  const html=read('../merge/story.html');
  const css=read('../merge/story/story.css');
  for(const banned of ['innerHTML','insertAdjacentHTML','eval(','fetch(','sendBeacon(','coins +=','energy +=']){
    assert.equal(ui.includes(banned),false,banned);
  }
  for(const element of ['story-list','story-dialog','save-state','reset-story','complete-story'])
    assert.ok(html.includes('id="'+element+'"'));
  assert.ok(css.includes('prefers-color-scheme:dark'));
  assert.ok(css.includes('prefers-reduced-motion:reduce'));
  assert.ok(css.includes('safe-area-inset'));
  assert.ok(css.includes('min-height:44px'));
});
