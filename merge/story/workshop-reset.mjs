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
    // Preserve a monotonically increasing revision even after a reset.
    // Reusing revision 0 could recreate an identical snapshot (ABA) when
    // a deterministic clock is reused, allowing an old tab to replay it.
    if(!current.blocked&&current.raw!==null){
      if(current.state.revision===Number.MAX_SAFE_INTEGER)return null;
      fresh.revision=current.state.revision+1;
    }
    if(!isCurrent())return null;
    return writeStoryWorkshop(storage,fresh,{expectedRaw,confirmedReset:true})?fresh:null;
  });
}
