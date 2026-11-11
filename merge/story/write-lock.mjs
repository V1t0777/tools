/**
 * Opt-in shared Web Locks serialization for BOTH story-only save keys.
 * A single lock coordinates cross-save prerequisites and writes, not just
 * concurrent writers of one key. The callback MUST still compare raw data
 * immediately before
 * localStorage.setItem: Web Locks only coordinate tabs that participate.
 * Older tabs and browsers without Web Locks remain CAS-only.
 */
import {STORY_SAVE_KEY} from '../mode-boundaries.mjs';
import {STORY_WORKSHOP_KEY} from './workshop-storage.mjs';

export async function runStoryWriteWithLock(locks,key,write){
  if((key!==STORY_SAVE_KEY&&key!==STORY_WORKSHOP_KEY)||typeof write!=='function')
    return {ok:false,mode:'invalid',value:false};
  // iOS/in-app browsers without navigator.locks retain existing CAS behavior.
  if(locks==null){
    try{return {ok:true,mode:'cas-fallback',value:await write()};}
    catch{return {ok:false,mode:'cas-error',value:false};}
  }
  // An exposed but malformed/rejecting API is NOT silently downgraded.
  if(typeof locks.request!=='function')return {ok:false,mode:'lock-error',value:false};
  try{
    // Both story dialogue and workshop writes share one lock, so a workshop
    // prerequisite cannot change between a participating dialogue guard and
    // its save (or vice versa). Older tabs / CAS fallback remain unprotected.
    const value=await locks.request('toolbox.merge-isle.story.write.'+STORY_SAVE_KEY,{mode:'exclusive'},write);
    return {ok:true,mode:'web-lock',value};
  }catch{return {ok:false,mode:'lock-error',value:false};}
}
