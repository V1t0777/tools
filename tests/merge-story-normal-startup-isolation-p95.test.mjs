import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,validateSave} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';
import {prepareNormalStartupWithLock} from '../merge/normal-startup-transaction.mjs';

const NOW=1_000_000;
function fixture(){
  const storyRaw=JSON.stringify(createEmptyStoryProgress());
  const workshopRaw=JSON.stringify(createInitialState(NOW));
  const values=new Map([[STORY_SAVE_KEY,storyRaw],[STORY_WORKSHOP_KEY,workshopRaw]]);
  const writes=[];
  const storage={
    getItem:key=>values.has(key)?values.get(key):null,
    setItem(key,value){writes.push(key);values.set(key,value);}
  };
  return {storage,values,writes,storyRaw,workshopRaw};
}
const immediateLock={
  request:(_name,options,callback)=>{
    assert.equal(options.mode,'exclusive');
    assert.equal(options.ifAvailable,true);
    return Promise.resolve(callback({name:'normal-startup',mode:'exclusive'}));
  }
};
function assertStoryUnchanged(h){
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),h.storyRaw);
  assert.equal(h.storage.getItem(STORY_WORKSHOP_KEY),h.workshopRaw);
  assert.equal(h.writes.includes(STORY_SAVE_KEY),false);
  assert.equal(h.writes.includes(STORY_WORKSHOP_KEY),false);
}

test('P95 delayed normal startup revoked during lock wait cannot write either story namespace',async()=>{
  const h=fixture();let release;
  const locks={request:(_name,options,callback)=>{
    assert.equal(options.mode,'exclusive');
    return new Promise(resolve=>{release=()=>resolve(callback({name:'normal-startup',mode:'exclusive'}));});
  }};
  let visible=true;
  const pending=prepareNormalStartupWithLock(locks,h.storage,{
    now:NOW,canStart:()=>visible
  });
  assert.equal(typeof release,'function');
  visible=false; // pagehide/BFCache while another tab holds the normal lock
  release();
  const result=await pending;
  assert.equal(result.ok,false);
  assert.equal(result.reason,'STARTUP_INVALIDATED');
  assert.equal('state' in result,false);
  assert.equal(h.storage.getItem(SAVE_KEY),null);
  assert.deepEqual(h.writes,[]);
  assertStoryUnchanged(h);
});

test('P95 successful normal startup cannot mutate valid narrative or workshop saves',async()=>{
  const h=fixture();
  const result=await prepareNormalStartupWithLock(immediateLock,h.storage,{now:NOW});
  assert.equal(result.ok,true);
  assert.equal(result.verifiedBaseline,true);
  assert.equal(validateSave(JSON.parse(h.storage.getItem(SAVE_KEY))),true);
  assert.deepEqual(h.writes,[SAVE_KEY]);
  assertStoryUnchanged(h);
});

test('P95 synchronous pagehide during ordinary read protects corrupt story evidence',async()=>{
  const h=fixture(),broken='{story-evidence'+String.fromCharCode(0xd800);
  h.values.set(STORY_SAVE_KEY,broken);
  let visible=true,reads=0;
  const storage={
    getItem(key){
      const value=h.storage.getItem(key);
      if(key===SAVE_KEY&&++reads===1)visible=false;
      return value;
    },
    setItem:(key,value)=>h.storage.setItem(key,value)
  };
  const result=await prepareNormalStartupWithLock(immediateLock,storage,{
    now:NOW,canStart:()=>visible
  });
  assert.equal(result.ok,false);
  assert.equal(result.reason,'STARTUP_INVALIDATED');
  assert.equal('state' in result,false);
  assert.equal(h.storage.getItem(SAVE_KEY),null);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),broken);
  assert.equal(h.storage.getItem(STORY_WORKSHOP_KEY),h.workshopRaw);
  assert.deepEqual(h.writes,[]);
});
