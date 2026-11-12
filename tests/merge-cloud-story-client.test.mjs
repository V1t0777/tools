import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState} from '../merge/engine.mjs';
import {createEmptyStoryProgress,STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';
import {captureLocalStoryPair,restoreDownloadedStoryPair} from '../merge/cloud/story-private-sync.mjs';

const progress=()=>createEmptyStoryProgress(),workshop=()=>createInitialState(1000000);
function p(backend='indexeddb'){
  const data=new Map([[STORY_SAVE_KEY,JSON.stringify(progress())],
    [STORY_WORKSHOP_KEY,JSON.stringify(workshop())]]);
  let calls=0;
  const persistence={
    backend,storage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)},
    locks:{async request(name,options,cb){
      assert.match(name,/story\.write/);
      assert.equal(options.mode,'exclusive');
      calls++;return cb();
    }}
  };
  return {persistence,data,get calls(){return calls}};
}
test('capture reviews two distinct story-only keys inside the same transaction',async()=>{
  const env=p(),r=await captureLocalStoryPair(env.persistence);
  assert.equal(r.ok,true);
  assert.equal(r.pair.progress.revision,0);
  assert.equal(r.pair.workshop.revision,0);
  assert.equal(env.calls,1);
  assert.equal(env.data.has('toolbox.merge-isle.local.v1'),false);
});
test('cloud restore demands user confirmation and original file backup',async()=>{
  const env=p(),review=await captureLocalStoryPair(env.persistence);
  const next={progress:progress(),workshop:workshop()};
  next.progress.revision=1;next.workshop.revision=1;
  const args={persistence:env.persistence,pair:next,expectedRaw:review.raw};
  assert.equal((await restoreDownloadedStoryPair(args)).ok,false);
  assert.equal((await restoreDownloadedStoryPair({...args,confirmedByUser:true})).ok,false);
  assert.equal(env.calls,1);
  assert.equal((await restoreDownloadedStoryPair({...args,
    confirmedByUser:true,backupDownloaded:true})).ok,true);
  assert.equal(JSON.parse(env.data.get(STORY_SAVE_KEY)).revision,1);
  assert.equal(JSON.parse(env.data.get(STORY_WORKSHOP_KEY)).revision,1);
});
test('stale local bytes and non-atomic legacy backend never restore cloud snapshots',async()=>{
  const env=p(),review=await captureLocalStoryPair(env.persistence);
  const pair={progress:progress(),workshop:workshop()};
  env.data.set(STORY_SAVE_KEY,JSON.stringify({...progress(),revision:4}));
  const a=await restoreDownloadedStoryPair({persistence:env.persistence,pair,
    expectedRaw:review.raw,confirmedByUser:true,backupDownloaded:true});
  assert.equal(a.ok,false);
  assert.equal(JSON.parse(env.data.get(STORY_SAVE_KEY)).revision,4);
  const legacy=p('legacy');
  assert.equal((await restoreDownloadedStoryPair({persistence:legacy.persistence,
    pair,expectedRaw:review.raw,confirmedByUser:true,backupDownloaded:true})).code,
    'STORY_ATOMIC_BACKEND_REQUIRED');
});
