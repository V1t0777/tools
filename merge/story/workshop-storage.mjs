/**
 * A playable story-only workshop. It reuses the vetted V3 merge engine,
 * but NEVER reads or writes the normal-mode save key.
 * All coins, energy and awards remain local to this story workshop.
 */
import {createInitialState,validateSave} from '../engine.mjs';
import {MAX_LOCAL_SAVE_BYTES} from '../storage.mjs';
export const STORY_WORKSHOP_KEY='toolbox.merge-isle.story.workshop.local.v1';

export function readStoryWorkshop(storage,now=Date.now()){
  let raw;
  try{
    if(typeof storage?.getItem!=='function'||typeof storage?.setItem!=='function')
      throw new Error('unavailable');
    raw=storage.getItem(STORY_WORKSHOP_KEY);
  }catch{return {state:createInitialState(now),raw:null,blocked:true,reason:'STORAGE_UNAVAILABLE'};}
  if(raw===null)return {state:createInitialState(now),raw:null,blocked:false,reason:null};
  try{
    if(typeof raw!=='string'||raw.length>MAX_LOCAL_SAVE_BYTES)throw new Error('size');
    const state=JSON.parse(raw);
    if(!validateSave(state))throw new Error('schema');
    return {state,raw,blocked:false,reason:null};
  }catch{return {state:createInitialState(now),raw,blocked:true,reason:'CORRUPT_SAVE'};}
}
/** Compare-before-write detects sequential stale tabs, not simultaneous writes. */
export function writeStoryWorkshop(storage,state,{expectedRaw,confirmedReset=false}={}){
  if(!validateSave(state)||expectedRaw===undefined)return false;
  try{
    if(typeof storage?.getItem!=='function'||typeof storage?.setItem!=='function')return false;
    const current=storage.getItem(STORY_WORKSHOP_KEY);
    if(current!==expectedRaw)return false;
    if(!confirmedReset&&current!==null){
      if(typeof current!=='string'||current.length>MAX_LOCAL_SAVE_BYTES)return false;
      const prev=JSON.parse(current);
      if(!validateSave(prev)||state.revision<=prev.revision)return false;
    }
    const next=JSON.stringify(state);
    if(next.length>MAX_LOCAL_SAVE_BYTES)return false;
    // Serialization may take time while another tab writes. Narrow the race window;
    // this is still NOT an atomic cross-tab compare-and-swap.
    if(storage.getItem(STORY_WORKSHOP_KEY)!==expectedRaw)return false;
    storage.setItem(STORY_WORKSHOP_KEY,next);
    return storage.getItem(STORY_WORKSHOP_KEY)===next;
  }catch{return false;}
}
