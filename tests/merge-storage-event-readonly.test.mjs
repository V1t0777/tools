import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState} from '../merge/engine.mjs';
import {SAVE_KEY,MAX_LOCAL_SAVE_BYTES,peekLocalV3} from '../merge/storage.mjs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';

const normal=revision=>JSON.stringify({...createInitialState(1_000_000),revision});
function storage(initial={}) {
  const map=new Map(Object.entries(initial)),writes=[];
  return {writes,map,
    getItem:key=>map.get(key)??null,
    setItem:(key,value)=>{writes.push([key,value]);map.set(key,value);},
    read:key=>map.get(key)??null};
}

test('valid V3 cross-tab inspection returns exact raw snapshot without writes',()=>{
  const raw=normal(3),story=JSON.stringify(createEmptyStoryProgress());
  const db=storage({[SAVE_KEY]:raw,[STORY_SAVE_KEY]:story});
  const result=peekLocalV3(db);
  assert.equal(result.ok,true);
  assert.equal(result.raw,raw);
  assert.equal(result.state.revision,3);
  assert.equal(Object.isFrozen(result),true);
  assert.deepEqual(db.writes,[]);
  assert.equal(db.read(STORY_SAVE_KEY),story);
});

test('missing or removed save is not treated as a new writable session',()=>{
  const db=storage();
  assert.deepEqual(peekLocalV3(db),{ok:false,reason:'SAVE_REMOVED'});
  assert.deepEqual(db.writes,[]);
});

test('malformed, oversized and legacy bytes are never migrated or overwritten',()=>{
  for(const raw of ['{broken','x'.repeat(MAX_LOCAL_SAVE_BYTES+1),
    JSON.stringify({schemaVersion:2}),JSON.stringify({schemaVersion:1})]){
    const db=storage({[SAVE_KEY]:raw});
    const result=peekLocalV3(db);
    assert.equal(result.ok,false);
    assert.ok(['CORRUPT_SAVE','UNSUPPORTED_OR_CORRUPT_SAVE'].includes(result.reason));
    assert.equal(db.read(SAVE_KEY),raw);
    assert.deepEqual(db.writes,[]);
    assert.equal(db.map.size,1,'no migration backup keys created');
  }
});

test('storage exceptions and absent storage access fail closed',()=>{
  assert.deepEqual(peekLocalV3(null),{ok:false,reason:'STORAGE_UNAVAILABLE'});
  const throwing={getItem(){throw Error('permission denied');},
    setItem(){throw Error('must not write');}};
  assert.deepEqual(peekLocalV3(throwing),
    {ok:false,reason:'STORAGE_UNAVAILABLE'});
});

test('cross-tab UI event handler is read-only and never auto-persists',()=>{
  const main=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
  const start=main.indexOf("window.addEventListener('storage', event => {");
  const end=main.indexOf('window.setInterval(() => {',start);
  assert.ok(start>=0&&end>start);
  const handler=main.slice(start,end);
  assert.ok(handler.includes('peekLocalV3(store)'));
  assert.ok(handler.includes('fresh.state.revision < state.revision'));
  assert.ok(handler.includes('fresh.raw === persistedRaw'));
  assert.ok(handler.includes('persistedRaw = fresh.raw'));
  assert.ok(handler.includes("saveIssue = 'CURRENT_SAVE_CHANGED'"));
  assert.equal(/\bpersist\s*\(/.test(handler.replace(/\/\/[^\n]*/g,'')),false);
  assert.equal(handler.includes('loadLocal(store)'),false);
  assert.equal(handler.includes('setItem('),false);
  assert.equal(handler.includes('removeItem('),false);
});

test('peek module has no UI, network or story-mode side effects',()=>{
  const source=readFileSync(new URL('../merge/storage.mjs',import.meta.url),'utf8');
  const begin=source.indexOf('export function peekLocalV3(');
  const end=source.indexOf('/** Refuse corrupt saves',begin);
  const section=source.slice(begin,end);
  assert.ok(begin>=0&&end>begin);
  for(const forbidden of ['setItem(', 'removeItem(', 'saveLocal(', 'fetch(', 'XMLHttpRequest', 'STORY_SAVE_KEY'])
    assert.equal(section.includes(forbidden),false,forbidden);
});
