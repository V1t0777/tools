import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(`../merge/${path}`,import.meta.url),'utf8');
const page=read('main.mjs');
const lock=read('normal-save-lock.mjs');
const action=read('normal-action-transaction.mjs');
const reset=read('normal-reset-transaction.mjs');
const startup=read('normal-startup-transaction.mjs');

const entrypoints=[
  'prepareNormalStartupWithLock',
  'commitNormalActionWithLock',
  'commitNormalClockWithLock',
  'commitNormalResetWithLock'
];
const legacyWriters=[
  /const loaded\s*=\s*loadLocal\(store\)/,
  /const startup\s*=\s*prepareNormalStartup\(loaded,store\)/,
  /commitNormalSnapshot\(store,nextState/,
  /persist\(result\.state\)/,
  /persist\(resetState,\{confirmedReset:true\}\)/,
  /advanceTime\(state,now\)/
];

test('P2.61u all four future ordinary-mode writer entrypoints exist',()=>{
  assert.match(startup,/export async function prepareNormalStartupWithLock\(/);
  assert.match(action,/export async function commitNormalActionWithLock\(/);
  assert.match(action,/export async function commitNormalClockWithLock\(/);
  assert.match(reset,/export async function commitNormalResetWithLock\(/);
});

test('P2.61u future writers share one fail-closed exclusive lock boundary',()=>{
  assert.match(lock,/export const NORMAL_SAVE_LOCK_NAME\s*=/);
  assert.match(lock,/mode:'exclusive',ifAvailable:true/);
  for(const [name,source] of [['startup',startup],['action and clock',action],['reset',reset]]) {
    assert.match(source,/import \{withNormalSaveLock\} from '\.\/normal-save-lock\.mjs'/,name);
    assert.match(source,/return withNormalSaveLock\(locks,\(\)=>\{/,name);
  }
  assert.equal((action.match(/return withNormalSaveLock\(locks,\(\)=>\{/g)||[]).length,2);
});

test('P2.61u actual page must not partially adopt locked writers',()=>{
  const installed=entrypoints.filter(name=>new RegExp(`\\b${name}\\b`).test(page));
  if(installed.length===0) {
    // The current synchronous page is still an acknowledged uncoordinated
    // writer. This guard prevents a later one-path-only lock migration.
    for(const writer of legacyWriters)assert.match(page,writer);
    assert.doesNotMatch(page,/\bwithNormalSaveLock\b|\bNORMAL_SAVE_LOCK_NAME\b|navigator\.locks/);
    return;
  }
  assert.deepEqual(installed,entrypoints,
    'startup, action, clock and reset must migrate together in one reviewed change');
  for(const writer of legacyWriters)assert.doesNotMatch(page,writer,
    'old uncoordinated writer remains after lock integration');
});

test('P2.61u current page preserves CAS rather than falsely claiming lock protection',()=>{
  if(entrypoints.some(name=>new RegExp(`\\b${name}\\b`).test(page)))return;
  assert.match(page,/function persist\(nextState=state,/);
  assert.match(page,/commitNormalSnapshot\(store,nextState,\{expectedRaw:persistedRaw,confirmedReset\}\)/);
  assert.match(page,/This remains a synchronous CAS path, not a cross-tab Web Lock/);
});

test('P2.61u lock helpers remain disconnected from current synchronous page',()=>{
  if(entrypoints.some(name=>new RegExp(`\\b${name}\\b`).test(page)))return;
  assert.doesNotMatch(page,/from '\.\/normal-action-transaction\.mjs'/);
  assert.doesNotMatch(page,/from '\.\/normal-reset-transaction\.mjs'/);
  assert.doesNotMatch(page,/from '\.\/normal-startup-transaction\.mjs'/);
});
