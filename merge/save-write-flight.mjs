/**
 * P2.23 — single-flight guard for future asynchronous normal-mode UI saves.
 * NOT connected to gameplay. Never queues a stale state, retries, or falls
 * back to an unlocked write when Web Locks are unavailable.
 */
import {coordinateNormalSaveWrite} from './save-write-lock.mjs';

const rejected=reason=>Object.freeze({ok:false,reason});

/**
 * One instance per normal-mode page/session. A second save while the first is
 * unresolved is explicitly rejected; the caller MUST retain unsaved in-memory
 * state and show an error, not assume the second mutation was persisted.
 * A confirmed reset must be confirmed by the real UI before calling write().
 */
export function createNormalSaveFlight(storage,lockManager) {
  let pending=false;
  return Object.freeze({
    get pending(){return pending;},
    async write(state,options={}) {
      if(pending)return rejected('SAVE_IN_FLIGHT');
      pending=true;
      try {
        return await coordinateNormalSaveWrite(state,storage,lockManager,options);
      } catch {
        // A provider can fail after writing; never claim the old bytes survived.
        return rejected('SAVE_OUTCOME_UNCERTAIN');
      } finally {
        pending=false;
      }
    }
  });
}
