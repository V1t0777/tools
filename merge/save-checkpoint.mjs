/**
 * P2.24 — track unsaved V3 normal-mode snapshots across asynchronous writes.
 * Standalone engineering adapter; NOT connected to the gameplay UI.
 * Every gameplay mutation must call stage() to be tracked.
 */
import {validateSave} from './engine.mjs';
import {MAX_LOCAL_SAVE_BYTES} from './storage.mjs';
import {createNormalSaveFlight} from './save-write-flight.mjs';

const rejected=reason=>Object.freeze({ok:false,reason});
const needsReconciliation=new Set([
  'CURRENT_SAVE_CHANGED','SAVE_REJECTED_OR_UNCERTAIN',
  'SAVE_VERIFY_FAILED','SAVE_OUTCOME_UNCERTAIN','LOCK_RESULT_INVALID'
]);

/**
 * expectedRaw must be the trusted last-read bytes, or null for known absence.
 * This adapter handles ORDINARY saves only; confirmed resets and restores
 * must retain their separate explicit user-consent and backup workflows.
 */
export function createNormalSaveCheckpoint(storage,lockManager,{expectedRaw}={}) {
  const flight=createNormalSaveFlight(storage,lockManager);
  let baseline=expectedRaw;
  let stagedRaw=null;
  let version=0;
  let pending=false;
  let blocked=false;

  return Object.freeze({
    get pending(){return pending;},
    get dirty(){return stagedRaw!==null;},
    get blocked(){return blocked;},
    get version(){return version;},

    stage(state) {
      // Freeze the logical snapshot by serializing it NOW; later mutations of
      // the caller's object must never alter the in-flight write.
      let encoded;
      try {
        if(!validateSave(state))return rejected('INVALID_SAVE');
        encoded=JSON.stringify(state);
        if(typeof encoded!=='string'||encoded.length>MAX_LOCAL_SAVE_BYTES)
          return rejected('SAVE_TOO_LARGE');
      } catch {return rejected('INVALID_SAVE');}
      stagedRaw=encoded;
      version++;
      return Object.freeze({ok:true,
        status:blocked?'STAGED_AWAITING_RECONCILIATION':'STAGED',
        version,dirty:true});
    },

    async flush() {
      if(pending)return rejected('SAVE_IN_FLIGHT');
      if(blocked)return rejected('RECONCILIATION_REQUIRED');
      if(stagedRaw===null)return rejected('NOTHING_STAGED');
      if(baseline===undefined||
          (baseline!==null&&typeof baseline!=='string'))
        return rejected('NO_TRUSTED_BASELINE');

      const snapshot=stagedRaw;
      const snapshotVersion=version;
      pending=true;
      try {
        const result=await flight.write(JSON.parse(snapshot),{expectedRaw:baseline});
        if(result?.ok===true&&result.status==='SAVE_VERIFIED'&&
            result.verifiedReadback===true) {
          // Only the committed snapshot becomes the new trusted baseline.
          // A newer staged mutation must remain visibly unsaved.
          baseline=snapshot;
          if(version===snapshotVersion)stagedRaw=null;
          const newerPending=stagedRaw!==null;
          return Object.freeze({ok:true,
            status:newerPending?'NEWER_STATE_UNSAVED':'SAVE_VERIFIED',
            version:snapshotVersion,dirty:newerPending,
            verifiedReadback:true});
        }
        const reason=typeof result?.reason==='string'
          ?result.reason:'SAVE_OUTCOME_UNCERTAIN';
        if(needsReconciliation.has(reason))blocked=true;
        return Object.freeze({ok:false,reason,dirty:true,blocked});
      } catch {
        blocked=true;
        return Object.freeze({ok:false,reason:'SAVE_OUTCOME_UNCERTAIN',
          dirty:true,blocked:true});
      } finally {
        pending=false;
      }
    }
  });
}
