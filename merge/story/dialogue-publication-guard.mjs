/** Refuse stale story UI success after a Web Lock has returned.
 * This is read-only verification, not an atomic cross-tab transaction.
 */
import {STORY_SAVE_KEY} from '../mode-boundaries.mjs';
import {checkStoryResumeSnapshot} from './resume-guard.mjs';

export function verifyStoryDialoguePublication(storage,{
  expectedRaw,expectedEpoch,currentEpoch,suspended=false
}={}){
  if(!Number.isSafeInteger(expectedEpoch)||!Number.isSafeInteger(currentEpoch))
    return {ok:false,reason:'INVALID_EPOCH'};
  if(expectedEpoch!==currentEpoch||suspended)
    return {ok:false,reason:'WRITE_CONFLICT'};
  if(typeof expectedRaw!=='string')
    return {ok:false,reason:'INVALID_SNAPSHOT'};
  return checkStoryResumeSnapshot(storage,{key:STORY_SAVE_KEY,expectedRaw});
}
