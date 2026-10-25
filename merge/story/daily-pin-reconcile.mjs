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
