import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createInitialState} from '../merge/engine.mjs';
import {peekLocalV3, SAVE_KEY} from '../merge/storage.mjs';

const main=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
const start=main.indexOf('function revalidateResumedSave() {');
const end=main.indexOf("byId('store-selected').addEventListener",start);
assert.ok(start>=0&&end>start,'missing real resume handlers');
const handlers=main.slice(start,end);

function harness(actualRaw,options={}) {
  const baseline=JSON.stringify(createInitialState(1000));
  const listeners={},status={textContent:''},messages=[];
  let reads=0,writes=0,renders=0,removed=0;
  const store={
    getItem(key){assert.equal(key,SAVE_KEY);reads++;return actualRaw===undefined?baseline:actualRaw;},
    setItem(){writes++;throw Error('focus must never write');}
  };
  const ctx={
    window:{addEventListener(name,fn){listeners[name]=fn;}},
    document:{hidden:!!options.hidden,addEventListener(name,fn){listeners[name]=fn;}},
    store,peekLocalV3,saveIssue:options.saveIssue??null,
    persistedRaw:baseline,selected:2,activeGuidance:{boardSlots:[2]},
    drag:options.drag?{id:7,ghost:{remove(){removed++;}}}:null,
    ignoreNextClick:false,
    byId(id){assert.equal(id,'save-status');return status;},
    hint(message){messages.push(message);},render(){renders++;},
    completeDrag(){throw Error('unexpected drag completion');}
  };
  runInNewContext(handlers,ctx);
  assert.equal(typeof listeners.focus,'function','real page must register focus');
  return {ctx,focus:()=>listeners.focus(),status,messages,
    get reads(){return reads;},get writes(){return writes;},
    get renders(){return renders;},get removed(){return removed;}};
}

test('P2.61d focus with unchanged raw save is read-only and keeps selection',()=>{
  const h=harness();
  h.focus();
  assert.equal(h.reads,1);
  assert.equal(h.writes,0);
  assert.equal(h.ctx.saveIssue,null);
  assert.equal(h.ctx.selected,2);
  assert.equal(h.renders,0);
  assert.deepEqual(h.messages,[]);
});

test('P2.61d focus after remote save change cancels stale drag and blocks',()=>{
  const original=createInitialState(1000);
  const changed=JSON.stringify({...original,revision:original.revision+1});
  const h=harness(changed,{drag:true});
  const originalRaw=h.ctx.persistedRaw;
  h.focus();
  assert.equal(h.reads,1);
  assert.equal(h.writes,0);
  assert.equal(h.ctx.saveIssue,'CURRENT_SAVE_CHANGED');
  assert.equal(h.ctx.persistedRaw,originalRaw);
  assert.equal(h.ctx.drag,null);
  assert.equal(h.ctx.ignoreNextClick,true);
  assert.equal(h.removed,1);
  assert.equal(h.ctx.selected,-1);
  assert.equal(h.ctx.activeGuidance,null);
  assert.equal(h.renders,1);
  assert.match(h.status.textContent,/已暂停写入/);
});

test('P2.61d focus while hidden does not read until visible',()=>{
  const h=harness(null,{hidden:true});
  h.focus();
  assert.equal(h.reads,0);
  assert.equal(h.ctx.saveIssue,null);
  h.ctx.document.hidden=false;
  h.focus();
  assert.equal(h.reads,1);
  assert.equal(h.ctx.saveIssue,'SAVE_REMOVED');
  assert.equal(h.writes,0);
});

test('P2.61d blocked page focus cannot clear an existing save error',()=>{
  const h=harness(undefined,{saveIssue:'SAVE_OUTCOME_UNCERTAIN'});
  h.focus();
  assert.equal(h.reads,0);
  assert.equal(h.writes,0);
  assert.equal(h.ctx.saveIssue,'SAVE_OUTCOME_UNCERTAIN');
  assert.equal(h.renders,0);
});
