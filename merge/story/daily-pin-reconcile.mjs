/** P49: recognize only the *identical* daily pin another tab just committed.
 * Never auto-merge chapter choices, workshop changes, corrupt saves or DLC data.
 * This is a read-only byte-exact proof, not a general conflict resolver.
 */
import {validateStoryProgress} from '../mode-boundaries.mjs';
import {pinDailyStoryIncident} from './runtime.mjs';

export function isMatchingConcurrentDailyPin({expectedRaw,observedRaw,proposed,day,pack}={}){
  if(typeof expectedRaw!=='string'||typeof observedRaw!=='string'||
    observedRaw===expectedRaw||!proposed||!pack)return false;
  try{
    const baseline=JSON.parse(expectedRaw);
    if(!validateStoryProgress(baseline))return false;
    const pinned=pinDailyStoryIncident(baseline,pack,day);
    if(pinned===baseline)return false;
    // A second tab can only be adopted if it wrote precisely the bytes
    // this tab would have written from the same validated raw baseline.
    return JSON.stringify(pinned)===observedRaw&&
      JSON.stringify(proposed)===observedRaw;
  }catch{
    return false;
  }
}

/** P50: a passive tab may observe a peer's identical daily pin even when it
 * did not attempt a write itself. Only the original key's exact StorageEvent,
 * an actual readback, and the sole deterministic pin transition authorize it.
 * Never adopt a general chapter/choice update or a localStorage.clear().
 */
import {STORY_SAVE_KEY} from '../mode-boundaries.mjs';
import {readStorySave} from './local-storage.mjs';

export function adoptConcurrentDailyPinStorageEvent(event,{storage,expectedRaw,day,pack}={}){
  if(!event||event.key!==STORY_SAVE_KEY||!storage||
    event.storageArea!==storage||typeof expectedRaw!=='string'||
    event.oldValue!==expectedRaw||typeof event.newValue!=='string')return null;
  const observed=readStorySave(storage);
  if(observed.blocked||observed.raw!==event.newValue)return null;
  try{
    const baseline=JSON.parse(expectedRaw);
    if(!validateStoryProgress(baseline))return null;
    const proposed=pinDailyStoryIncident(baseline,pack,day);
    if(!isMatchingConcurrentDailyPin({expectedRaw,observedRaw:observed.raw,
      proposed,day,pack}))return null;
    return {progress:observed.progress,raw:observed.raw};
  }catch{return null;}
}
