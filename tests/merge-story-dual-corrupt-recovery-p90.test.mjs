import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,validateSave} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {createEmptyStoryProgress,STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {readStorySave,writeStorySave} from '../merge/story/local-storage.mjs';
import {STORY_WORKSHOP_KEY,readStoryWorkshop} from '../merge/story/workshop-storage.mjs';
import {resetStoryWorkshopWithLock} from '../merge/story/workshop-reset.mjs';
import {saveStoryDialogueWithLock} from '../merge/story/dialogue-write.mjs';
import {captureStoryWorkshopEvidence,prepareStoryEvidenceDownload,
  isPreparedStoryEvidenceCurrent} from '../merge/story/save-evidence.mjs';

const now=1_000_000;
const dialogueRaw='{broken-dialogue'+String.fromCharCode(0xD800);
const workshopRaw='{broken-workshop'+String.fromCharCode(0xDC00);
const normalRaw=JSON.stringify(createInitialState(now));
const locks={request:async(_name,_options,callback)=>callback()};

function fixture(){
  const data=new Map([[SAVE_KEY,normalRaw],[STORY_SAVE_KEY,dialogueRaw],
    [STORY_WORKSHOP_KEY,workshopRaw]]);
  const writes=[];
  const storage={
    getItem:key=>data.has(key)?data.get(key):null,
    setItem(key,value){writes.push(key);data.set(key,value);}
  };
  return {data,writes,storage};
}
function evidence(storage,key,raw){
  const captured=captureStoryWorkshopEvidence(storage,{
    key,expectedRaw:raw,confirmedByUser:true
  });
  assert.equal(captured.ok,true);
  const download=prepareStoryEvidenceDownload(captured.content,'yunyu-story-p90');
  assert.equal(download.wrapped,true);
  assert.equal(JSON.parse(download.content).raw,raw);
  assert.equal(isPreparedStoryEvidenceCurrent(storage,{key,expectedRaw:raw,download}),true);
  return download;
}

test('P90 simultaneous damaged story keys block silently continuing and preserve both UTF-16 evidence files',()=>{
  const {storage,writes}=fixture();
  assert.equal(readStorySave(storage).reason,'CORRUPT_SAVE');
  assert.equal(readStoryWorkshop(storage,now).reason,'CORRUPT_SAVE');
  for(const [key,raw] of [[STORY_SAVE_KEY,dialogueRaw],[STORY_WORKSHOP_KEY,workshopRaw]]){
    assert.equal(captureStoryWorkshopEvidence(storage,{key,expectedRaw:raw}).code,'CONSENT_REQUIRED');
    evidence(storage,key,raw);
  }
  assert.equal(writeStorySave(storage,createEmptyStoryProgress(),{
    expectedRaw:dialogueRaw
  }),false,'damaged dialogue must not be silently repaired');
  assert.deepEqual(writes,[]);
  assert.equal(storage.getItem(STORY_SAVE_KEY),dialogueRaw);
  assert.equal(storage.getItem(STORY_WORKSHOP_KEY),workshopRaw);
  assert.equal(storage.getItem(SAVE_KEY),normalRaw);
});

test('P90 consented workshop reset leaves damaged dialogue evidence intact until its own reset',async()=>{
  const {storage,writes}=fixture();
  const dialogueDownload=evidence(storage,STORY_SAVE_KEY,dialogueRaw);
  const workshopDownload=evidence(storage,STORY_WORKSHOP_KEY,workshopRaw);
  const workshop=await resetStoryWorkshopWithLock(locks,storage,{
    expectedRaw:workshopRaw,now
  });
  assert.equal(workshop.ok,true);
  assert.equal(validateSave(workshop.value),true);
  assert.equal(readStoryWorkshop(storage,now).blocked,false);
  assert.equal(readStorySave(storage).reason,'CORRUPT_SAVE');
  assert.equal(isPreparedStoryEvidenceCurrent(storage,{
    key:STORY_WORKSHOP_KEY,expectedRaw:workshopRaw,download:workshopDownload
  }),false,'a reset must invalidate the old workshop evidence snapshot');
  assert.equal(isPreparedStoryEvidenceCurrent(storage,{
    key:STORY_SAVE_KEY,expectedRaw:dialogueRaw,download:dialogueDownload
  }),true,'other damaged story key must remain independently exportable');
  assert.equal(storage.getItem(SAVE_KEY),normalRaw);
  const dialogue=await saveStoryDialogueWithLock(locks,storage,createEmptyStoryProgress(),{
    expectedRaw:dialogueRaw,confirmedReset:true
  });
  assert.equal(dialogue.value,true);
  assert.equal(readStorySave(storage).blocked,false);
  assert.equal(readStoryWorkshop(storage,now).blocked,false);
  assert.deepEqual(writes,[STORY_WORKSHOP_KEY,STORY_SAVE_KEY]);
  assert.equal(storage.getItem(SAVE_KEY),normalRaw);
});

test('P90 peer update during workshop reset lock rejects stale consent without touching either other save',async()=>{
  const {storage,data,writes}=fixture();
  const peerState={...createInitialState(now),revision:9};
  assert.equal(validateSave(peerState),true);
  const peerRaw=JSON.stringify(peerState);
  const racingLocks={request:async(_name,_options,callback)=>{
    data.set(STORY_WORKSHOP_KEY,peerRaw); // non-participating peer tab
    return callback();
  }};
  const result=await resetStoryWorkshopWithLock(racingLocks,storage,{
    expectedRaw:workshopRaw,now
  });
  assert.equal(result.value,null);
  assert.deepEqual(writes,[]);
  assert.equal(storage.getItem(STORY_WORKSHOP_KEY),peerRaw);
  assert.equal(storage.getItem(STORY_SAVE_KEY),dialogueRaw);
  assert.equal(storage.getItem(SAVE_KEY),normalRaw);
  assert.equal(isPreparedStoryEvidenceCurrent(storage,{
    key:STORY_WORKSHOP_KEY,expectedRaw:workshopRaw,
    download:prepareStoryEvidenceDownload(workshopRaw,'yunyu-story-p90')
  }),false);
});

test('P90 failed localStorage writes cannot turn either damaged key into a reported successful reset',async()=>{
  const {storage,data}=fixture();
  const denied={
    getItem:key=>storage.getItem(key),
    setItem(){throw new Error('quota or private-mode write denied');}
  };
  const workshop=await resetStoryWorkshopWithLock(locks,denied,{
    expectedRaw:workshopRaw,now
  });
  const dialogue=await saveStoryDialogueWithLock(locks,denied,createEmptyStoryProgress(),{
    expectedRaw:dialogueRaw,confirmedReset:true
  });
  assert.equal(workshop.value,null);
  assert.equal(dialogue.value,false);
  assert.equal(data.get(STORY_WORKSHOP_KEY),workshopRaw);
  assert.equal(data.get(STORY_SAVE_KEY),dialogueRaw);
  assert.equal(data.get(SAVE_KEY),normalRaw);
});
