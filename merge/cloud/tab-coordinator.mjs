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
  // An in-memory, session-only proof of the EXACT remote-confirmed snapshot.
  // Revision alone is insufficient: time-based regeneration may change state
  // without advancing the command revision.
  let verifiedSnapshot = null;
  let lastPhase = 'unverified';
  let lastFailure = null;
  const snapshotToken = snapshot => snapshot.state !== null &&
    Number.isSafeInteger(snapshot.revision)
    ? JSON.stringify([snapshot.revision, snapshot.state]) : null;

  function preview() {
    const result = create().preview();
    // A persisted cache, or another tab's same-revision update, is unverified.
    // Never show a green "synced" status during an unfinished lock operation.
    const verified = capable && active === null && verifiedSnapshot !== null &&
      verifiedSnapshot === snapshotToken(result);
    return { ...result, verified,
      phase:verified ? lastPhase : lastFailure?.phase ?? result.phase,
      ...(lastFailure?.code ? {code:lastFailure.code} : {}),
      lockAvailable:capable };
  }
  const unavailable = () => ({ok:false,code:'MULTITAB_LOCK_UNAVAILABLE',
    phase:'blocked',...{pending:preview().pending}});

  async function exclusive(callback) {
    if (!capable) {
      verifiedSnapshot = null;
      return unavailable();
    }
    // Serialize calls issued by this SAME adapter as well as between tabs.
    if (active) await active.catch(()=>{});
    // A pending lock, a failed remote read, or a write must never continue to
    // advertise a previous successful verification.
    verifiedSnapshot = null;
    const lockFailed = () => {
      verifiedSnapshot = null;
      lastPhase = 'blocked';
      lastFailure = {code:'LOCK_REQUEST_FAILED',phase:'blocked'};
      return {ok:false,code:'LOCK_REQUEST_FAILED',phase:'blocked'};
    };
    let operation;
    try {
      operation = Promise.resolve(locks.request(name,{mode:'exclusive'}, async () => {
        // IMPORTANT: never reuse an instance created before waiting for lock.
        const queue = create();
        const response = await callback(queue);
        const snapshot = queue.preview();
        // Only a successful operation that actually read the remote server in
        // this locked queue instance can verify these exact state bytes.
        verifiedSnapshot = response?.ok === true && snapshot.verified === true
          ? snapshotToken(snapshot) : null;
        lastPhase = response?.phase || snapshot.phase || 'unverified';
        lastFailure = response?.ok === true ? null :
          {code:response?.code,phase:response?.phase || snapshot.phase};
        return response;
      }));
    } catch {
      return lockFailed();
    }
    active = operation;
    try {return await operation;}
    catch {return lockFailed();}
    finally {if (active === operation) active = null;}
  }

  return Object.freeze({
    key, lockName:name,
    preview,
    enqueue(action) {return exclusive(queue => queue.enqueue(action));},
    connect() {return exclusive(queue => queue.connect());},
    flush(options) {return exclusive(queue => queue.flush(options));},
    discardUnsent() {return exclusive(queue => queue.discardUnsent());},
    discardConflicted(options) {return exclusive(queue => queue.discardConflicted(options));},
    // Review under the same lock; a new queue instance must first verify
    // the latest remote state instead of trusting a cached snapshot.
    inspectConflict() {return exclusive(async queue => {
      const connected=await queue.connect();
      return connected.ok ? queue.inspectConflict() : connected;
    });},
    replaceConflicted(options) {return exclusive(queue => queue.replaceConflicted(options));}
  });
}