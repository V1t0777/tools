/**
 * Explicitly consented, read-only capture of a damaged story-workshop save.
 * Do not parse, rewrite, erase, repair or upload the stored content.
 * expectedRaw binds the export to the exact snapshot previously seen by UI.
 */
export const MAX_STORY_EVIDENCE_CHARS=2_000_000;
export function captureStoryWorkshopEvidence(storage,{key,expectedRaw,confirmedByUser=false}={}){
  if(!confirmedByUser)return {ok:false,code:'CONSENT_REQUIRED'};
  if(typeof key!=='string'||!key||typeof expectedRaw!=='string')
    return {ok:false,code:'NO_SNAPSHOT'};
  try{
    if(typeof storage?.getItem!=='function')return {ok:false,code:'STORAGE_UNAVAILABLE'};
    const current=storage.getItem(key);
    if(current!==expectedRaw)return {ok:false,code:'STALE_SNAPSHOT'};
    if(current.length>MAX_STORY_EVIDENCE_CHARS)return {ok:false,code:'TOO_LARGE'};
    return {ok:true,code:'OK',content:current};
  }catch{return {ok:false,code:'STORAGE_UNAVAILABLE'};}
}
