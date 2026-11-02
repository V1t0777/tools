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

/**
 * Preserve JavaScript UTF-16 code units in an explicitly requested local
 * evidence download. Blob UTF-8 encoding replaces isolated surrogates with
 * U+FFFD, which would silently alter a damaged localStorage record.
 * A well-formed record remains a plain .txt; a record containing an unpaired
 * surrogate becomes a reversible JSON evidence envelope (not an import file).
 */
function hasUnpairedStorySurrogate(raw){
  for(let i=0;i<raw.length;i++){
    const code=raw.charCodeAt(i);
    if(code>=0xD800&&code<=0xDBFF){
      const next=i+1<raw.length?raw.charCodeAt(i+1):-1;
      if(next>=0xDC00&&next<=0xDFFF){i++;continue;}
      return true;
    }
    if(code>=0xDC00&&code<=0xDFFF)return true;
  }
  return false;
}
export function prepareStoryEvidenceDownload(raw,baseName){
  if(typeof raw!=='string'||typeof baseName!=='string'||!/^[a-z0-9-]+$/i.test(baseName))
    throw new TypeError('Invalid story evidence download');
  const wrapped=hasUnpairedStorySurrogate(raw);
  return wrapped
    ? {content:JSON.stringify({format:'yunyu-story-evidence-utf16-v1',raw}),
      filename:baseName+'.utf16.json',wrapped:true}
    : {content:raw,filename:baseName+'.txt',wrapped:false};
}

/**
 * P87: final read-only exact-byte preflight for a prepared story evidence file.
 * A native confirmation and UTF-16 encoding do not reserve a storage snapshot.
 * This is not a cross-tab transaction and never modifies either mode's save.
 */
export function isPreparedStoryEvidenceCurrent(storage,{key,expectedRaw,download}={}){
  if(key!==STORY_SAVE_KEY&&key!==STORY_WORKSHOP_KEY)return false;
  if(typeof expectedRaw!=='string')return false;
  try{
    if(typeof download?.content!=='string'||typeof storage?.getItem!=='function')return false;
    let represented;
    if(download.wrapped===true){
      const envelope=JSON.parse(download.content);
      if(envelope?.format!=='yunyu-story-evidence-utf16-v1'||
        typeof envelope.raw!=='string')return false;
      represented=envelope.raw;
    }else if(download.wrapped===false){
      represented=download.content;
    }else return false;
    // Check the prepared file itself AND the current storage record, in that
    // order; no stale or malformed envelope may authorize a browser click.
    return represented===expectedRaw&&storage.getItem(key)===expectedRaw;
  }catch{return false;}
}
