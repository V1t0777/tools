import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('P127 320–375px scroll-button board and 44px cells coexist with the story entry link',()=>{
  const css=read('../merge/style.css');
  const html=read('../merge/index.html');
  assert.match(css,/\/\* P2\.65bu: 320–375px compact iPhone layout/);
  assert.ok(css.includes('.board-viewport{max-width:100%;min-width:0;overflow-x:auto'));
  assert.ok(css.includes('.board{width:max-content;grid-template-columns:repeat(7,44px);touch-action:pan-y}'));
  assert.ok(css.includes('.board-scroll-controls:not([hidden]){display:flex}'));
  assert.ok(html.includes('id="board-scroll-left"')&&html.includes('id="board-scroll-right"'));
  assert.ok(css.includes('.story-entry-link{display:inline-flex;align-items:center;justify-content:center;min-height:44px'));
  assert.ok(css.includes('@media(prefers-color-scheme:dark){.story-entry-link'));
  assert.ok(html.includes('<a class="story-entry-link" href="./story.html">'));
});

test('P127 narrow-screen fallback does not replace standard board drag or backup controls',()=>{
  const css=read('../merge/style.css');
  const html=read('../merge/index.html');
  assert.ok(css.includes('touch-action:pan-y;user-select:none'));
  assert.ok(css.includes('@media(min-width:620px)'));
  assert.ok(css.includes('.save-actions #export-local-save,.save-actions #export-abnormal-reset-backup{'));
  for(const id of ['export-local-save','export-abnormal-reset-backup','reset']){
    assert.equal(html.split('id="'+id+'"').length-1,1,id);
  }
});
