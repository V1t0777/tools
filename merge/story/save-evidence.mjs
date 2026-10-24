/**
 * Explicitly consented, read-only capture of a damaged story-workshop save.
 * Do not parse, rewrite, erase, repair or upload the stored content.
 * expectedRaw binds the export to the exact snapshot previously seen by UI.
 */
import {STORY_SAVE_KEY} from '../mode-boundaries.mjs';
import {STORY_WORKSHOP_KEY} from './workshop-storage.mjs';
export const MAX_STORY_EVIDENCE_CHARS=2_000_000;
export function captureStoryWorkshopEvidence(storage,{key,expectedRaw,confirmedByUser=false}={}){
  if(!confirmedByUser)return {ok:false,code:'CONSENT_REQUIRED'};
  if(typeof key!=='string'||!key||typeof expectedRaw!=='string')
    return {ok:false,code:'NO_SNAPSHOT'};
  // This helper must never be used to export the normal-mode or unrelated keys.
  if(key!==STORY_SAVE_KEY&&key!==STORY_WORKSHOP_KEY)return {ok:false,code:'INVALID_KEY'};
  try{
    if(typeof storage?.getItem!=='function')return {ok:false,code:'STORAGE_UNAVAILABLE'};
    const current=storage.getItem(key);
    if(current!==expectedRaw)return {ok:false,code:'STALE_SNAPSHOT'};
    if(current.length>MAX_STORY_EVIDENCE_CHARS)return {ok:false,code:'TOO_LARGE'};
    return {ok:true,code:'OK',content:current};
  }catch{return {ok:false,code:'STORAGE_UNAVAILABLE'};}
}
