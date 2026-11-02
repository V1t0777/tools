import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('P127 320px native pan and 44px board coexist with the story entry link',()=>{
  const css=read('../merge/style.css');
  const html=read('../merge/index.html');
  assert.match(css,/\/\* P2\.65bf: 320px fallback/);
  assert.ok(css.includes('.board-section{overflow-x:auto;overscroll-behavior-x:contain}'));
  assert.ok(css.includes('.board{width:max-content;grid-template-columns:repeat(7,44px);touch-action:auto}'));
  assert.ok(css.includes('.board .cell{touch-action:auto}'));
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
