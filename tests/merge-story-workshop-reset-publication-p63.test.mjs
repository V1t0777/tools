import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState,validateSave} from '../merge/engine.mjs';
import {STORY_WORKSHOP_KEY,writeStoryWorkshop} from '../merge/story/workshop-storage.mjs';
import {resetStoryWorkshopWithLock} from '../merge/story/workshop-reset.mjs';
import {verifyStoryWorkshopPublication} from '../merge/story/workshop-publication-guard.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';

function fixture(){
  const map=new Map([[STORY_SAVE_KEY,'story-sentinel'],[SAVE_KEY,'normal-sentinel']]);
  let writes=0,denyReads=false;
  const storage={
    getItem(key){
      if(denyReads)throw Error('storage blocked after lock release');
      return map.has(key)?map.get(key):null;
    },
    setItem(key,value){writes++;map.set(key,value);}
  };
  const initial=createInitialState(1000000);
  assert.equal(writeStoryWorkshop(storage,initial,{expectedRaw:null}),true);
  return {map,storage,initial,get writes(){return writes;},
    deny(){denyReads=true;}};
}
const verify=(f,raw,epoch=7,currentEpoch=7)=>verifyStoryWorkshopPublication(f.storage,{
  expectedWorkshopRaw:raw,expectedEpoch:epoch,currentEpoch
});

test('P63 confirmed reset publishes only after two exact read-only checks',async()=>{
  const f=fixture(),original=f.map.get(STORY_WORKSHOP_KEY);
  const result=await resetStoryWorkshopWithLock(null,f.storage,{expectedRaw:original,now:1000001});
  assert.equal(result.ok,true);
  assert.ok(validateSave(result.value));
  const raw=JSON.stringify(result.value);
  assert.equal(f.map.get(STORY_WORKSHOP_KEY),raw);
  const writes=f.writes;
  assert.deepEqual(verify(f,raw),{ok:true,reason:null});
  assert.deepEqual(verify(f,raw),{ok:true,reason:null});
  assert.equal(f.writes,writes,'publication must never write');
  assert.equal(f.map.get(STORY_SAVE_KEY),'story-sentinel');
  assert.equal(f.map.get(SAVE_KEY),'normal-sentinel');
});

test('P63 another tab replacing reset save after Web Lock release blocks success',async()=>{
  const f=fixture(),original=f.map.get(STORY_WORKSHOP_KEY);
  const locks={request:async(_name,_options,write)=>{
    const result=await write();
    f.map.set(STORY_WORKSHOP_KEY,'{"revision":1,"changedByOtherTab":true}');
    return result;
  }};
  const result=await resetStoryWorkshopWithLock(locks,f.storage,{expectedRaw:original,now:1000001});
  assert.equal(result.ok,true);
  assert.ok(result.value,'reset itself may already have committed');
  assert.equal(verify(f,JSON.stringify(result.value)).reason,'WRITE_CONFLICT');
  assert.equal(f.map.get(SAVE_KEY),'normal-sentinel');
});

test('P63 reset publication catches an ABA storage event despite identical bytes',async()=>{
  const f=fixture(),original=f.map.get(STORY_WORKSHOP_KEY);
  const result=await resetStoryWorkshopWithLock(null,f.storage,{expectedRaw:original,now:1000001});
  const raw=JSON.stringify(result.value);
  assert.equal(verify(f,raw,7,8).reason,'WRITE_CONFLICT');
  assert.deepEqual(verify(f,raw,8,8),{ok:true,reason:null});
});

test('P63 a storage read failure after reset commit cannot publish success',async()=>{
  const f=fixture(),original=f.map.get(STORY_WORKSHOP_KEY);
  const locks={request:async(_name,_options,write)=>{
    const result=await write();
    f.deny();
    return result;
  }};
  const result=await resetStoryWorkshopWithLock(locks,f.storage,{expectedRaw:original,now:1000001});
  assert.ok(result.value);
  assert.equal(verify(f,JSON.stringify(result.value)).reason,'STORAGE_UNAVAILABLE');
});

test('P63 reset UI rechecks after lock release and after render, before announcing stable success',()=>{
  const ui=readFileSync(new URL('../merge/story/workshop.mjs',import.meta.url),'utf8');
  const handler=ui.slice(ui.indexOf("$('reset-workshop').addEventListener('click',async()=>{"));
  assert.ok(handler.startsWith("$('reset-workshop').addEventListener"));
  const lock=handler.indexOf('const attempt=await resetStoryWorkshopWithLock(');
  const first=handler.indexOf('const publication=verifyStoryWorkshopPublication(');
  const publish=handler.indexOf('state=attempt.value;raw=expectedWorkshopRaw;');
  const render=handler.indexOf('  render();\n  // Rendering or a synchronous storage event',publish);
  const second=handler.indexOf('const afterResetRender=verifyStoryWorkshopPublication(',render);
  assert.ok(lock>=0&&lock<first&&first<publish&&publish<render&&render<second);
  assert.equal(handler.match(/verifyStoryWorkshopPublication\(storage,\{/g)?.length,2);
  assert.ok(handler.includes('if(!publication.ok||blocked)'));
  assert.ok(handler.includes('if(!afterResetRender.ok||blocked)'));
  assert.ok(ui.includes('请勿重复重置，先重新打开页面核对金币、建筑和订单'));
  for(const unsafe of ['innerHTML','insertAdjacentHTML','fetch(','sendBeacon(','localStorage.setItem','SAVE_KEY'])
    assert.equal(ui.includes(unsafe),false,unsafe);
});
