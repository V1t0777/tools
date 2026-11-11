/**
 * Opt-in shared Web Locks serialization for BOTH story-only save keys.
 * A single lock coordinates cross-save prerequisites and writes, not just
 * concurrent writers of one key. The callback MUST still compare raw data
 * immediately before
 * localStorage.setItem: Web Locks only coordinate tabs that participate.
 * Browsers without Web Locks must remain read-only; localStorage CAS is not atomic.
 */
import {STORY_SAVE_KEY} from '../mode-boundaries.mjs';
import {STORY_IDB_MARKER} from './indexeddb-persistence.mjs';
import {STORY_WORKSHOP_KEY} from './workshop-storage.mjs';

export async function runStoryWriteWithLock(locks,key,write){
  if((key!==STORY_SAVE_KEY&&key!==STORY_WORKSHOP_KEY)||typeof write!=='function')
    return {ok:false,mode:'invalid',value:false};
  // No Web Locks means no cross-tab atomicity: never invoke a write callback.
  if(locks==null)return {ok:false,mode:'lock-unavailable',value:false};
  // An exposed but malformed/rejecting API is NOT silently downgraded.
  if(typeof locks.request!=='function')return {ok:false,mode:'lock-error',value:false};
  try{
    // Both story dialogue and workshop writes share one lock, so a workshop
    // prerequisite cannot change between a participating dialogue guard and
    // its save (or vice versa). Non-cooperating legacy tabs remain a risk.
    const value=await locks.request('toolbox.merge-isle.story.write.'+STORY_SAVE_KEY,{mode:'exclusive'},()=>{
      // A previously opened legacy tab must stop writing once another tab
      // switches this origin to the authoritative IndexedDB protocol.
      if(!locks.isIndexedDBStoryLock){
        try{
          const local=globalThis.window?.localStorage;
          if(local&&local.getItem(STORY_IDB_MARKER)!==null)return false;
        }catch{return false;}
      }
      return write();
    });
    return {ok:true,mode:locks.isIndexedDBStoryLock?'indexeddb':'web-lock',value};
  }catch{return {ok:false,mode:'lock-error',value:false};}
}
