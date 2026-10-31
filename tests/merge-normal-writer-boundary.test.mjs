import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../merge/'+path,import.meta.url),'utf8');
const html=read('index.html');
const locked=read('main-locked.mjs');
const legacy=read('main.mjs');
const runtime=read('normal-page-runtime.mjs');
const lock=read('normal-save-lock.mjs');
const action=read('normal-action-transaction.mjs');
const reset=read('normal-reset-transaction.mjs');
const startup=read('normal-startup-transaction.mjs');

test('P2.61u/P2.64f all four locked transaction entrypoints exist',()=>{
  assert.match(startup,/export async function prepareNormalStartupWithLock\(/);
  assert.match(action,/export async function commitNormalActionWithLock\(/);
  assert.match(action,/export async function commitNormalClockWithLock\(/);
  assert.match(reset,/export async function commitNormalResetWithLock\(/);
});

test('P2.61u/P2.64f all writers share one fail-closed exclusive Web Lock',()=>{
  assert.match(lock,/export const NORMAL_SAVE_LOCK_NAME\s*=/);
  assert.match(lock,/mode:'exclusive',ifAvailable:true/);
  for(const [name,source] of [['startup',startup],['action and clock',action],['reset',reset]]){
    assert.match(source,/import \{withNormalSaveLock\} from '\.\/normal-save-lock\.mjs'/,name);
    assert.match(source,/return withNormalSaveLock\(locks,\(\)=>\{/,name);
  }
  assert.equal((action.match(/return withNormalSaveLock\(locks,\(\)=>\{/g)||[]).length,2);
});

test('P2.64f actual HTML loads exactly the reviewed locked page, never legacy CAS',()=>{
  const scripts=[...html.matchAll(/<script\b[^>]*type="module"[^>]*src="\.\/([^"]+)"[^>]*><\/script>/g)];
  assert.deepEqual(scripts.map(match=>match[1]),['main-locked.mjs']);
  assert.doesNotMatch(html,/src="\.\/main\.mjs"/);
  assert.match(legacy,/function persist\(nextState=state,/);
  assert.match(legacy,/This remains a synchronous CAS path, not a cross-tab Web Lock/);
});

test('P2.64f active page delegates startup, actions, clock and reset to one runtime',()=>{
  assert.match(locked,/import \{ createNormalPageRuntime \} from '\.\/normal-page-runtime\.mjs'/);
  assert.match(locked,/const runtime=createNormalPageRuntime\(/);
  assert.match(locked,/locks:window\.navigator\?\.locks\?\?null/);
  for(const name of ['start','action','clock','reset'])
    assert.match(locked,new RegExp('runtime\\.'+name+'\\('));
  assert.match(locked,/attachNormalPageLifecycle\(\{/);
  assert.match(runtime,/prepareNormalStartupWithLock\(locks,storage/);
  assert.match(runtime,/commitNormalActionWithLock\(locks,storage/);
  assert.match(runtime,/commitNormalClockWithLock\(locks,storage/);
  assert.match(runtime,/commitNormalResetWithLock\(locks,storage/);
});

test('P2.64f active page cannot bypass the lock with a legacy write path',()=>{
  for(const unsafe of [
    'loadLocal(store)','prepareNormalStartup(loaded,store)',
    'commitNormalSnapshot(store,','persist(result.state)',
    'persist(resetState','advanceTime(state,now)',
    'localStorage.setItem(','store.setItem(','saveLocal('
  ])assert.equal(locked.includes(unsafe),false,unsafe);
  assert.doesNotMatch(locked,/from '\.\/save-transaction\.mjs'/);
  assert.doesNotMatch(locked,/from '\.\/startup-persist\.mjs'/);
  assert.doesNotMatch(locked,/from '\.\/reset-backup\.mjs'/);
});
