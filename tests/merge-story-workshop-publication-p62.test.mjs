import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyStoryWorkshopPublication} from '../merge/story/workshop-publication-guard.mjs';
import {STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';

function fixture(){
  const workshop='{"revision":4,"coins":20}';
  const story=JSON.stringify(createEmptyStoryProgress());
  const map=new Map([[STORY_WORKSHOP_KEY,workshop],[STORY_SAVE_KEY,story],[SAVE_KEY,'normal-unchanged']]);
  let writes=0;
  const storage={
    getItem(key){return map.has(key)?map.get(key):null;},
    setItem(){writes++;throw Error('publication guard must be read-only');}
  };
  return {workshop,story,map,storage,get writes(){return writes;}};
}
function verify(f,extra={}){
  return verifyStoryWorkshopPublication(f.storage,{
    expectedWorkshopRaw:f.workshop,expectedStoryRaw:f.story,
    expectedEpoch:3,currentEpoch:3,...extra
  });
}
test('P62 unchanged committed workshop can publish without any save writes',()=>{
  const f=fixture();
  assert.deepEqual(verify(f),{ok:true,reason:null});
  assert.deepEqual(verify(f,{buildingChanged:true}),{ok:true,reason:null});
  assert.equal(f.writes,0);
  assert.equal(f.map.get(SAVE_KEY),'normal-unchanged');
});
test('P62 stale post-lock readback is blocked even with same revision',()=>{
  const f=fixture();
  f.map.set(STORY_WORKSHOP_KEY,'{"revision":4,"coins":21}');
  assert.equal(verify(f).reason,'WRITE_CONFLICT');
  f.map.delete(STORY_WORKSHOP_KEY);
  assert.equal(verify(f).reason,'WRITE_CONFLICT');
  assert.equal(f.writes,0);
});
test('P62 intervening storage event rejects an ABA return to identical bytes',()=>{
  const f=fixture();
  assert.equal(verify(f,{currentEpoch:4}).reason,'WRITE_CONFLICT');
  assert.equal(verify(f,{expectedEpoch:undefined}).reason,'INVALID_EPOCH');
  assert.equal(verify(f,{expectedWorkshopRaw:null}).reason,'INVALID_SNAPSHOT');
  assert.equal(f.writes,0);
});
test('P62 building publication also rechecks the exact narrative prerequisite',()=>{
  const f=fixture();
  const changed=JSON.parse(f.story);changed.revision++;
  f.map.set(STORY_SAVE_KEY,JSON.stringify(changed));
  assert.equal(verify(f,{buildingChanged:true}).reason,'WRITE_CONFLICT');
  assert.equal(verify(f,{buildingChanged:false}).ok,true);
  f.map.set(STORY_SAVE_KEY,'{bad-json');
  assert.equal(verify(f,{buildingChanged:true}).reason,'CORRUPT_SAVE');
  f.map.delete(STORY_SAVE_KEY);
  assert.equal(verify(f,{buildingChanged:true}).reason,'WRITE_CONFLICT');
  assert.equal(f.writes,0);
});
test('P62 unreadable workshop and narrative storage fail closed',()=>{
  const f=fixture();
  const denied={getItem(){throw Error('blocked');}};
  assert.equal(verifyStoryWorkshopPublication(denied,{
    expectedWorkshopRaw:f.workshop,expectedEpoch:1,currentEpoch:1
  }).reason,'STORAGE_UNAVAILABLE');
  const narrativeDenied={
    getItem(key){
      if(key===STORY_SAVE_KEY)throw Error('denied');
      return f.map.get(key)??null;
    },
    setItem(){throw Error('read-only');}
  };
  assert.equal(verifyStoryWorkshopPublication(narrativeDenied,{
    expectedWorkshopRaw:f.workshop,expectedStoryRaw:f.story,
    expectedEpoch:1,currentEpoch:1,buildingChanged:true
  }).reason,'STORAGE_UNAVAILABLE');
});
test('P62 workshop UI checks the released-lock snapshot before and after rendering',()=>{
  const ui=readFileSync(new URL('../merge/story/workshop.mjs',import.meta.url),'utf8');
  assert.ok(ui.includes("import {verifyStoryWorkshopPublication} from './workshop-publication-guard.mjs';"));
  assert.ok(ui.includes('const expectedEpoch=storageEpoch;'));
  assert.ok(ui.includes('const buildingChanged='));
  const commitHandler=ui.slice(ui.indexOf('async function commit(result){'),ui.indexOf('function touch(index){'));
  assert.equal(commitHandler.match(/verifyStoryWorkshopPublication\(storage,\{/g)?.length,2);
  const lock=ui.indexOf('const attempt=await runStoryWriteWithLock(');
  const guard=ui.indexOf('const publication=expectedWorkshopRaw===null');
  const publish=ui.indexOf('state=result.state;raw=JSON.stringify(state);');
  const second=ui.indexOf('const afterRender=verifyStoryWorkshopPublication(');
  assert.ok(lock>=0&&lock<guard&&guard<publish&&publish<second);
  for(const unsafe of ['innerHTML','insertAdjacentHTML','fetch(','sendBeacon(','localStorage.setItem','SAVE_KEY'])
    assert.equal(ui.includes(unsafe),false,unsafe);
});
