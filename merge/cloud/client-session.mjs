/** Explicit opt-in cloud session, detached from P2 normal/story saves.
 * Auth identity is never supplied by a game nickname or request body.
 */
import {createAuthenticatedMergeTransport,verifyCloudIdentity} from './http-transport.mjs';
import {createDeadlineTransport} from './timeout-transport.mjs';
import {createCoordinatedCloudQueue} from './tab-coordinator.mjs';
import {openIndexedDBCloudQueue,cloudQueueIdbMarkerKey} from './indexeddb-queue.mjs';
export async function openPrivateCloudSession({
  projectUrl,publishableKey,auth,storage,locks,fetchImpl,clock,makeId,indexedDB=globalThis.indexedDB,Channel=globalThis.BroadcastChannel
}={}){
  const {uid}=await verifyCloudIdentity(auth);
  const http=createAuthenticatedMergeTransport({
    projectUrl,publishableKey,auth,verifiedUid:uid,fetchImpl
  });
  const transport=createDeadlineTransport(http);
  // Once migrated, NEVER return to localStorage/Web Locks even if the API
  // becomes available again. The marker and legacy bytes are IDB migration
  // evidence, not a second active journal.
  let marked;
  try{marked=storage.getItem(cloudQueueIdbMarkerKey(uid))}
  catch{throw Error('CLOUD_QUEUE_STORAGE_UNAVAILABLE')}
  const queue=(marked!==null||typeof locks?.request!=='function')
    ? await openIndexedDBCloudQueue({uid,legacyStorage:storage,indexedDB,
        transport,clock,makeId,Channel})
    : createCoordinatedCloudQueue({uid,storage,locks,transport,clock,makeId});
  return Object.freeze({
    mode:'private-cloud-draft',uid,
    preview:()=>queue.preview(),
    connect:()=>queue.connect(),
    enqueue:action=>queue.enqueue(action),
    flush:options=>queue.flush(options),
    inspectConflict:()=>queue.inspectConflict(),
    discardUnsent:()=>queue.discardUnsent(),
    discardConflicted:options=>queue.discardConflicted(options),
    replaceConflicted:options=>queue.replaceConflicted(options)
  });
}
