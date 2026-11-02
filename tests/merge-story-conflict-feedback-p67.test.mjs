import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ui=readFileSync(new URL('../merge/story/workshop.mjs',import.meta.url),'utf8');
const between=(a,b)=>ui.slice(ui.indexOf(a),ui.indexOf(b,ui.indexOf(a)+a.length));

test('P67 a conflict invalidates the previous success notice only after rendering the blocked state',()=>{
  const helper=between('function blockWorkshopWithNotice(nextReason,notice){','// Storage events may arrive after a tap.');
  assert.ok(helper.includes('blocked=true;reason=nextReason;selected=-1;'));
  const render=helper.indexOf('  render();');
  const feedback=helper.indexOf("$('board-notice').textContent=notice;");
  assert.ok(render>=0&&feedback>render,'stale render must not overwrite the uncertainty notice');
  assert.equal((helper.match(/render\(\)/g)||[]).length,1);
});

test('P67 post-lock failure never silently retains an older success message',()=>{
  const commit=between('async function commit(result){','function touch(index){');
  const failed=between('  if(!publication.ok||blocked){','  state=result.state;raw=JSON.stringify(state);');
  assert.ok(failed.includes("blockWorkshopWithNotice(publication.ok?'WRITE_CONFLICT':publication.reason,"));
  assert.ok(failed.includes('可能已经写入'));
  assert.ok(failed.includes('请勿重复操作'));
  assert.ok(commit.indexOf('if(!publication.ok||blocked)')<commit.indexOf('state=result.state;raw=JSON.stringify(state);'));
});

test('P67 post-render invalidation retracts optimistic success rather than replaying a transaction',()=>{
  const commit=between('async function commit(result){','function touch(index){');
  const tail=commit.slice(commit.indexOf('if(!afterRender.ok||blocked)'));
  assert.ok(tail.includes("blockWorkshopWithNotice(afterRender.ok?'WRITE_CONFLICT':afterRender.reason,"));
  assert.ok(tail.includes('成功提示已撤回'));
  assert.equal((tail.match(/runStoryWriteWithLock/g)||[]).length,0);
});

test('P67 cross-tab and resume invalidation replace previous success feedback',()=>{
  const resume=between('function recheckWorkshopOnResume(){',"window.addEventListener('pageshow'");
  assert.ok(resume.includes('storageEpoch++;'));
  assert.ok(resume.includes('blockWorkshopWithNotice(check.reason,'));
  assert.ok(resume.includes('此前提示不再可信'));
  const storage=ui.slice(ui.indexOf("window.addEventListener('storage',event=>{"));
  assert.ok(storage.includes("blockWorkshopWithNotice('WRITE_CONFLICT',"));
  assert.ok(storage.includes('此前成功提示不再可信'));
  assert.ok(storage.includes('shouldRefreshWorkshopForStoryEvent(event,storage)'));
});

test('P67 warnings use the existing accessible live region and never modify another mode',()=>{
  const html=readFileSync(new URL('../merge/story-workshop.html',import.meta.url),'utf8');
  assert.match(html,/<p id="board-notice" role="status" aria-live="polite">/);
  assert.equal(ui.includes('innerHTML'),false);
  assert.equal(ui.includes('localStorage.setItem'),false);
  assert.equal(ui.includes('SAVE_KEY'),false);
});
