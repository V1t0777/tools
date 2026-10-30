/**
 * P62: a successful localStorage readback is not a durable UI publication.
 * Another tab may replace the story-only workshop save after the Web Lock
 * callback returns. Fail closed rather than showing a stale success state.
 * This is a read-only guard, not an atomic multi-key transaction.
 */
import {STORY_WORKSHOP_KEY} from './workshop-storage.mjs';
import {checkStoryResumeSnapshot} from './resume-guard.mjs';
import {readStorySave} from './local-storage.mjs';

const reject=reason=>Object.freeze({ok:false,reason});
export function verifyStoryWorkshopPublication(storage,{
  expectedWorkshopRaw,expectedStoryRaw,buildingChanged=false,
  expectedEpoch,currentEpoch,suspended=false
}={}){
  if(!Number.isSafeInteger(expectedEpoch)||!Number.isSafeInteger(currentEpoch))
    return reject('INVALID_EPOCH');
  // An intervening StorageEvent is meaningful even if the bytes return to
  // the original value (an ABA replacement).
  if(expectedEpoch!==currentEpoch)return reject('WRITE_CONFLICT');
  // A visibility transition can precede its event handler on mobile browsers.
  // Do not publish a successful write from a hidden or BFCache-suspended page.
  if(suspended)return reject('WRITE_CONFLICT');
  if(typeof expectedWorkshopRaw!=='string')return reject('INVALID_SNAPSHOT');
  const workshop=checkStoryResumeSnapshot(storage,{
    key:STORY_WORKSHOP_KEY,expectedRaw:expectedWorkshopRaw
  });
  if(!workshop.ok)return reject(workshop.reason);
  // Only building actions consume a narrative prerequisite. Ordinary board
  // actions remain independent of the story progress key.
  if(buildingChanged){
    if(typeof expectedStoryRaw!=='string')return reject('INVALID_SNAPSHOT');
    const story=readStorySave(storage);
    if(story.blocked)return reject(story.reason??'STORAGE_UNAVAILABLE');
    if(story.raw!==expectedStoryRaw)return reject('WRITE_CONFLICT');
  }
  return Object.freeze({ok:true,reason:null});
}
