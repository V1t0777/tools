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

/** P51: a byte-identical daily pin changes no chapter completion/choices.
 * Keep an already open main/side dialogue only if its *actual core-pack
 * object* remains unlocked or completed. Never keep a daily event, forged
 * DLC lookalike, or dialogue with malformed/unknown progress.
 */
import {availableStoryEntries,completedStoryEntries} from './runtime.mjs';

export function canKeepDialogueAfterDailyPin(entry,progress,pack){
  if(!entry||!pack||!Array.isArray(pack.entries)||
    !pack.entries.includes(entry)||
    (entry.kind!=='main'&&entry.kind!=='side')||
    !validateStoryProgress(progress))return false;
  try{
    return availableStoryEntries(progress,pack,entry.kind).includes(entry)||
      completedStoryEntries(progress,pack,entry.kind).includes(entry);
  }catch{return false;}
}

/** P52: BFCache/foreground resumes may miss a peer StorageEvent entirely.
 * Recover ONLY the same byte-exact deterministic pin as P50, after a fresh
 * localStorage readback. Never reconcile unrelated changes or write a save.
 */
export function adoptConcurrentDailyPinOnResume(storage,{expectedRaw,day,pack}={}){
  if(typeof expectedRaw!=='string'||!storage||!pack)return null;
  const observed=readStorySave(storage);
  if(observed.blocked||typeof observed.raw!=='string')return null;
  try{
    const baseline=JSON.parse(expectedRaw);
    if(!validateStoryProgress(baseline))return null;
    const proposed=pinDailyStoryIncident(baseline,pack,day);
    if(!isMatchingConcurrentDailyPin({
      expectedRaw,observedRaw:observed.raw,proposed,day,pack
    }))return null;
    return {progress:observed.progress,raw:observed.raw};
  }catch{return null;}
}
