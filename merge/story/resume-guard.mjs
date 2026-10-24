/** Recheck the exact story-only snapshot after a page returns from suspension.
 * This is a read-only stale-view guard, NOT an atomic multi-tab write lock.
 */
import {STORY_SAVE_KEY} from '../mode-boundaries.mjs';
import {STORY_WORKSHOP_KEY} from './workshop-storage.mjs';
export function checkStoryResumeSnapshot(storage,{key,expectedRaw}={}){
  if(key!==STORY_SAVE_KEY&&key!==STORY_WORKSHOP_KEY)
    return {ok:false,reason:'INVALID_KEY'};
  if(expectedRaw!==null&&typeof expectedRaw!=='string')
    return {ok:false,reason:'INVALID_SNAPSHOT'};
  try{
    if(typeof storage?.getItem!=='function')return {ok:false,reason:'STORAGE_UNAVAILABLE'};
    return storage.getItem(key)===expectedRaw
      ? {ok:true,reason:null}
      : {ok:false,reason:'WRITE_CONFLICT'};
  }catch{return {ok:false,reason:'STORAGE_UNAVAILABLE'};}
}
