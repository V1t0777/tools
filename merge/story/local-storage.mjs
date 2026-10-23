/** Defensive, separated story save writer with sequential stale-tab detection. */
import {STORY_SAVE_KEY,MAX_STORY_SAVE_BYTES,createEmptyStoryProgress,validateStoryProgress} from '../mode-boundaries.mjs';
export function readStorySave(storage){
  let raw;
  try{
    if(typeof storage?.getItem!=='function'||typeof storage?.setItem!=='function')
      throw new Error('unavailable');
    raw=storage.getItem(STORY_SAVE_KEY);
  }catch{return {progress:createEmptyStoryProgress(),raw:null,blocked:true,reason:'STORAGE_UNAVAILABLE'};}
  if(raw===null)return {progress:createEmptyStoryProgress(),raw:null,blocked:false,reason:null};
  try{
    if(typeof raw!=='string'||raw.length>MAX_STORY_SAVE_BYTES)throw new Error('size');
    const progress=JSON.parse(raw);
    if(!validateStoryProgress(progress))throw new Error('schema');
    return {progress,raw,blocked:false,reason:null};
  }catch{return {progress:createEmptyStoryProgress(),raw,blocked:true,reason:'CORRUPT_SAVE'};}
}
/** confirmedReset may be passed ONLY after an explicit user-confirmed reset. */
export function writeStorySave(storage,progress,{expectedRaw,confirmedReset=false}={}){
  if(!validateStoryProgress(progress)||expectedRaw===undefined)return false;
  try{
    if(typeof storage?.getItem!=='function'||typeof storage?.setItem!=='function')return false;
    const current=storage.getItem(STORY_SAVE_KEY);
    if(!confirmedReset&&current!==expectedRaw)return false;
    if(!confirmedReset&&current!==null){
      if(typeof current!=='string'||current.length>MAX_STORY_SAVE_BYTES)return false;
      const previous=JSON.parse(current);
      if(!validateStoryProgress(previous)||progress.revision<=previous.revision)return false;
    }
    const serialized=JSON.stringify(progress);
    if(serialized.length>MAX_STORY_SAVE_BYTES)return false;
    storage.setItem(STORY_SAVE_KEY,serialized);
    return storage.getItem(STORY_SAVE_KEY)===serialized;
  }catch{return false;}
}
