import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('mobile toast only mirrors status, cannot intercept touches or double-announce',()=>{
  const html=read('merge/index.html'),js=read('merge/mobile-quick-nav.mjs');
  const css=read('merge/mobile-quick-nav.css');
  assert.match(html,/id="mobile-action-feedback"[^>]*aria-hidden="true"/);
  assert.match(js,/sourceNotice\.textContent\?\.trim\(\)/);
  assert.match(js,/new MutationObserver\(updateFeedback\)/);
  assert.match(css,/pointer-events:none/);
  assert.doesNotMatch(js,/localStorage|indexedDB|setItem|\.enqueue\(|\.execute\(/);
});
test('cloud read-only board navigation remains enabled while writes are blocked',()=>{
  const js=read('merge/cloud-preview.mjs');
  assert.match(js,/button\.id==='cloud-board-left'\|\|button\.id==='cloud-board-right'/);
  const part=js.slice(js.indexOf('function toggleControls()'),
    js.indexOf('function stateStatus('));
  assert.match(part,/if\(button\.id==='cloud-board-left'/);
  assert.doesNotMatch(part,/\.enqueue\(|\.flush\(/);
});
