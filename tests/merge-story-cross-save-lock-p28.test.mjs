import test from 'node:test';
import assert from 'node:assert/strict';
import {runStoryWriteWithLock} from '../merge/story/write-lock.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';

function exclusiveLocks(){
  const tails=new Map(),names=[];
  return {names,request(name,{mode},callback){
    assert.equal(mode,'exclusive');
    names.push(name);
    const before=tails.get(name)??Promise.resolve();
    const result=before.catch(()=>{}).then(callback);
    tails.set(name,result.catch(()=>{}));
    return result;
  }};
}

test('P28 dialogue and workshop writes share a single lock and never overlap',async()=>{
  const locks=exclusiveLocks(),events=[];
  let release;
  const held=new Promise(resolve=>{release=resolve;});
  const dialogue=runStoryWriteWithLock(locks,STORY_SAVE_KEY,async()=>{
    events.push('dialogue-start');
    await held;
    events.push('dialogue-end');
    return true;
  });
  const workshop=runStoryWriteWithLock(locks,STORY_WORKSHOP_KEY,()=>{
    events.push('workshop-start');
    return true;
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(events,['dialogue-start'],'workshop cannot enter during dialogue validation/write');
  release();
  const [first,second]=await Promise.all([dialogue,workshop]);
  assert.deepEqual(events,['dialogue-start','dialogue-end','workshop-start']);
  assert.deepEqual(locks.names,[
    'toolbox.merge-isle.story.write.'+STORY_SAVE_KEY,
    'toolbox.merge-isle.story.write.'+STORY_SAVE_KEY
  ]);
  assert.deepEqual([first.value,second.value],[true,true]);
});

test('P28 reverse order also serializes a queued dialogue completion',async()=>{
  const locks=exclusiveLocks(),events=[];
  let release;
  const held=new Promise(resolve=>{release=resolve;});
  const workshop=runStoryWriteWithLock(locks,STORY_WORKSHOP_KEY,async()=>{
    events.push('workshop-start');await held;events.push('workshop-end');return true;
  });
  const dialogue=runStoryWriteWithLock(locks,STORY_SAVE_KEY,()=>{
    events.push('dialogue-start');return true;
  });
  await Promise.resolve();await Promise.resolve();
  assert.deepEqual(events,['workshop-start']);
  release();
  await Promise.all([workshop,dialogue]);
  assert.deepEqual(events,['workshop-start','workshop-end','dialogue-start']);
  assert.equal(locks.names[0],locks.names[1]);
});

test('P28 lock failure stays fail-closed and ordinary mode never joins story lock',async()=>{
  const locks={request(){throw Error('denied');}};
  let writes=0;
  for(const key of [STORY_SAVE_KEY,STORY_WORKSHOP_KEY]){
    const result=await runStoryWriteWithLock(locks,key,()=>{writes++;return true;});
    assert.deepEqual(result,{ok:false,mode:'lock-error',value:false});
  }
  assert.deepEqual(await runStoryWriteWithLock(null,SAVE_KEY,()=>{writes++;return true;}),
    {ok:false,mode:'invalid',value:false});
  assert.equal(writes,0);
});
