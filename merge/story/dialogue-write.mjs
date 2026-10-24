/**
 * Shared Web Locks protocol for the story dialogue save only.
 * Initialization, completed choices and confirmed reset MUST use this path.
 * The lock coordinates participating same-origin tabs; the exact-raw
 * compare in writeStorySave remains mandatory for older/unlocked tabs.
 */
import {STORY_SAVE_KEY} from '../mode-boundaries.mjs';
import {readStorySave,writeStorySave} from './local-storage.mjs';
import {runStoryWriteWithLock} from './write-lock.mjs';

export async function saveStoryDialogueWithLock(locks,storage,next,{
  expectedRaw,confirmedReset=false,isCurrent=()=>true
}={}){
  if((expectedRaw!==null&&typeof expectedRaw!=='string')||typeof isCurrent!=='function')
    return {ok:false,mode:'invalid',value:false};
  return runStoryWriteWithLock(locks,STORY_SAVE_KEY,()=>{
    // A page may be invalidated by storage/BFCache while waiting for the lock.
    if(!isCurrent())return false;
    const current=readStorySave(storage);
    if(current.reason==='STORAGE_UNAVAILABLE'||current.raw!==expectedRaw)return false;
    // Reject ABA on a valid save: a confirmed reset must advance revision,
    // otherwise an older tab with the same raw snapshot could still commit.
    if(confirmedReset&&!current.blocked&&current.raw!==null&&
      next?.revision<=current.progress.revision)return false;
    if(!isCurrent())return false;
    return writeStorySave(storage,next,{expectedRaw,confirmedReset});
  });
}
