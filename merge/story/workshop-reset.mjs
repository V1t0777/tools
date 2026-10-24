/**
 * Explicitly confirmed story-workshop reset under the SAME lock name as
 * ordinary workshop writes. The UI must obtain confirmation BEFORE calling.
 * The lock only coordinates participating same-origin tabs; exact-raw CAS
 * remains mandatory for older tabs and unsupported iOS/in-app browsers.
 */
import {createInitialState} from '../engine.mjs';
import {STORY_WORKSHOP_KEY,readStoryWorkshop,writeStoryWorkshop} from './workshop-storage.mjs';
import {runStoryWriteWithLock} from './write-lock.mjs';

export async function resetStoryWorkshopWithLock(locks,storage,{expectedRaw,now=Date.now(),isCurrent=()=>true}={}){
  if((expectedRaw!==null&&typeof expectedRaw!=='string')||typeof isCurrent!=='function')
    return {ok:false,mode:'invalid',value:null};
  return runStoryWriteWithLock(locks,STORY_WORKSHOP_KEY,()=>{
    // The page may have received a storage event while waiting for a lock.
    if(!isCurrent())return null;
    const current=readStoryWorkshop(storage,now);
    if(current.reason==='STORAGE_UNAVAILABLE'||current.raw!==expectedRaw)return null;
    const fresh=createInitialState(now);
    if(!isCurrent())return null;
    return writeStoryWorkshop(storage,fresh,{expectedRaw,confirmedReset:true})?fresh:null;
  });
}
