/** P3.2 — exclusive, cross-tab coordination for the future cloud queue.
 * This adapter ONLY coordinates cloud operation journals, never P2 sandbox saves.
 * No localStorage spin-lock fallback: atomic read-modify-write cannot be proven
 * with localStorage alone across simultaneous browser tabs.
 */
import { createOfflineCommandQueue, queueStorageKey } from './offline-queue.mjs';

export const cloudQueueLockName = uid => `toolbox.merge-isle.cloud-lock.${queueStorageKey(uid)}`;

/**
 * All mutating queue operations, including a slow HTTP send, run inside one
 * same-origin Web Lock. A FRESH journal is loaded after lock acquisition.
 * Other tabs therefore cannot overwrite each other's pending commands or
 * run the same queue head concurrently. A tab crash releases the Web Lock;
 * the durable journal still contains the original operationId for replay.
 *
 * Browser integration must use this adapter exclusively for cloud commands.
 */
export function createCoordinatedCloudQueue({uid, storage, transport,
  locks = globalThis.navigator?.locks, clock, makeId, maxPending} = {}) {
  const key = queueStorageKey(uid);
  // Check storage and transport synchronously. This constructor never sends.
  const create = () => createOfflineCommandQueue({uid, storage, transport, clock, makeId, maxPending});
  create();
  const name = cloudQueueLockName(uid);
  const capable = !!locks && typeof locks.request === 'function';
  let active = null;
  let verifiedRevision = null;
  let lastPhase = 'unverified';

  function preview() {
    const result = create().preview();
    // A cached snapshot is NOT evidence that this tab has read it remotely.
    const verified = verifiedRevision !== null && verifiedRevision === result.revision;
    return { ...result, verified, phase:verified ? lastPhase : result.phase,
      lockAvailable:capable };
  }
  const unavailable = () => ({ok:false,code:'MULTITAB_LOCK_UNAVAILABLE',
    phase:'blocked',...{pending:preview().pending}});

  async function exclusive(callback) {
    if (!capable) return unavailable();
    // Serialize calls issued by this SAME adapter as well as between tabs.
    if (active) await active.catch(()=>{});
    let operation;
    try {
      operation = Promise.resolve(locks.request(name,{mode:'exclusive'}, async () => {
        // IMPORTANT: never reuse an instance created before waiting for lock.
        const queue = create();
        const response = await callback(queue);
        if (response?.verified === true && Number.isSafeInteger(response.revision))
          verifiedRevision = response.revision;
        lastPhase = response?.phase || 'unverified';
        return response;
      }));
    } catch {
      return {ok:false,code:'LOCK_REQUEST_FAILED',phase:'blocked'};
    }
    active = operation;
    try {return await operation;}
    catch {return {ok:false,code:'LOCK_REQUEST_FAILED',phase:'blocked'};}
    finally {if (active === operation) active = null;}
  }

  return Object.freeze({
    key, lockName:name,
    preview,
    enqueue(action) {return exclusive(queue => queue.enqueue(action));},
    connect() {return exclusive(queue => queue.connect());},
    flush(options) {return exclusive(queue => queue.flush(options));},
    discardUnsent() {return exclusive(queue => queue.discardUnsent());},
    discardConflicted(options) {return exclusive(queue => queue.discardConflicted(options));}
  });
}