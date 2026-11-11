/** Explicit opt-in cloud session, detached from P2 normal/story saves.
 * Auth identity is never supplied by a game nickname or request body.
 */
import {createAuthenticatedMergeTransport,verifyCloudIdentity} from './http-transport.mjs';
import {createDeadlineTransport} from './timeout-transport.mjs';
import {createCoordinatedCloudQueue} from './tab-coordinator.mjs';
export async function openPrivateCloudSession({
  projectUrl,publishableKey,auth,storage,locks,fetchImpl,clock,makeId
}={}){
  const {uid}=await verifyCloudIdentity(auth);
  const http=createAuthenticatedMergeTransport({
    projectUrl,publishableKey,auth,verifiedUid:uid,fetchImpl
  });
  const transport=createDeadlineTransport(http);
  const queue=createCoordinatedCloudQueue({uid,storage,locks,transport,clock,makeId});
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
