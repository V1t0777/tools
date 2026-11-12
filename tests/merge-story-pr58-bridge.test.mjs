import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';

const read=(name)=>readFileSync(new URL(name,import.meta.url),'utf8');
test('story entry integrates without regressing normal-mode mobile and deadlock controls',()=>{
  const html=read('../merge/index.html');
  const css=read('../merge/style.css');
  assert.match(html, /class="story-entry-link" href="\.\/story\.html"/);
  for(const id of ['board-viewport','board-scroll-left','board-scroll-right','deadlock-discard','export-local-save','export-abnormal-reset-backup'])
    assert.ok(html.includes('id="'+id+'"'), 'missing normal-mode control '+id);
  for(const rule of ['.story-entry-link{','.story-entry-link:focus-visible','@media(prefers-color-scheme:dark){.story-entry-link','.board-viewport','@media(max-width:375px)'])
    assert.ok(css.includes(rule), 'missing shared style '+rule);
});
test('first volume pages have real module and style entrypoints',()=>{
  const story=read('../merge/story.html');
  const workshop=read('../merge/story-workshop.html');
  for(const [src,html] of [['./story/story.css',story],['./story/ui.mjs',story],['./story/story.css',workshop],['./story/workshop.css',workshop],['./story/workshop.mjs',workshop]]){
    assert.ok(html.includes(src),'missing page dependency '+src);
    assert.ok(existsSync(new URL('../merge/'+src.slice(2),import.meta.url)),'missing dependency file '+src);
  }
});
