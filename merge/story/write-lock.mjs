/**
 * Opt-in Web Locks serialization for story-only writes.
 * The callback MUST still perform an exact-raw compare immediately before
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
    const value=await locks.request('toolbox.merge-isle.story.write.'+key,{mode:'exclusive'},write);
    return {ok:true,mode:'web-lock',value};
  }catch{return {ok:false,mode:'lock-error',value:false};}
}
