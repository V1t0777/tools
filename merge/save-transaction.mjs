/** P2.26 ordinary local V3 snapshot is not accepted until exact readback. */
import {validateSave} from './engine.mjs';
import {SAVE_KEY,MAX_LOCAL_SAVE_BYTES,saveLocal} from './storage.mjs';
const reject=reason=>Object.freeze({ok:false,reason});
export function commitNormalSnapshot(storage,nextState,{expectedRaw,confirmedReset=false}={}) {
  if(expectedRaw===undefined||(expectedRaw!==null&&typeof expectedRaw!=='string'))
    return reject('NO_TRUSTED_BASELINE');
  if(typeof confirmedReset!=='boolean')return reject('INVALID_RESET_FLAG');
  if(!validateSave(nextState))return reject('INVALID_SAVE');
  try {
    const raw=JSON.stringify(nextState);
    if(raw.length>MAX_LOCAL_SAVE_BYTES)return reject('SAVE_TOO_LARGE');
    if(typeof storage?.getItem!=='function'||typeof storage?.setItem!=='function')
      return reject('STORAGE_UNAVAILABLE');
    if(!saveLocal(storage,nextState,{expectedRaw,allowReset:confirmedReset}))
      return reject('SAVE_REJECTED_OR_UNCERTAIN');
    if(storage.getItem(SAVE_KEY)!==raw)return reject('SAVE_VERIFY_FAILED');
    return Object.freeze({ok:true,status:'SAVE_VERIFIED',raw,verifiedReadback:true});
  } catch {return reject('SAVE_OUTCOME_UNCERTAIN');}
}
