/** P3.14: inspect a damaged cloud command journal without changing evidence.
 * Future authenticated cloud client only. Never wired to P2 local gameplay.
 * No persistence writes, server requests, recovery reset, or console logging.
 */
import {createOfflineCommandQueue, queueStorageKey, MAX_STORED_BYTES} from './offline-queue.mjs';

const MAX_EVIDENCE_CHARS = 1_000_000;
const forbiddenTransport = Object.freeze({
  read: async () => {throw Error('Read-only inspection may not access a server');},
  execute: async () => {throw Error('Read-only inspection may not submit operations');}
});
const report = (code, {damaged=true, characters=null, pending=null,
  attemptedPending=null, blocked=null}={}) => Object.freeze({
  code, damaged, characters, pending, attemptedPending, blocked,
  verified:false, canAutoRepair:false, canResumeCloudWrites:false,
  recommendation:damaged ? 'PRESERVE_AND_REVIEW' : 'VERIFY_SERVER_BEFORE_SYNC'
});

function scan({uid, storage}={}) {
  const key=queueStorageKey(uid);
  if (!storage || typeof storage.getItem !== 'function')
    return {result:report('STORAGE_READ_UNAVAILABLE'),raw:null};
  let raw;
  try { raw=storage.getItem(key); }
  catch { return {result:report('STORAGE_READ_FAILED'),raw:null}; }
  if (raw === null)
    return {result:report('JOURNAL_ABSENT',{damaged:false}),raw};
  if (typeof raw !== 'string')
    return {result:report('JOURNAL_NON_STRING'),raw};
  const characters=raw.length;
  if (characters === 0)
    return {result:report('JOURNAL_EMPTY',{characters}),raw};
  if (characters > MAX_STORED_BYTES)
    return {result:report('JOURNAL_OVERSIZED',{characters}),raw};
  try { JSON.parse(raw); }
  catch { return {result:report('JOURNAL_INVALID_JSON',{characters}),raw}; }

  // A captured, immutable read is passed to the SAME validator used by the
  // real queue. A storage shim with a rejecting setter prohibits writes.
  const readOnlyStorage={
    getItem: requestedKey => requestedKey === key ? raw : null,
    setItem: () => {throw Error('Read-only journal inspection');}
  };
  const queue=createOfflineCommandQueue({uid,storage:readOnlyStorage,
    transport:forbiddenTransport});
  const state=queue.preview();
  if (state.phase === 'storage-error')
    return {result:report('JOURNAL_INVALID_SCHEMA',{characters}),raw};
  return {result:report('JOURNAL_VALID',{
    damaged:false,characters,pending:state.pending,
    attemptedPending:state.attemptedPending,blocked:state.blocked
  }),raw};
}

/** Diagnostic-only metadata: NEVER returns the journal or operation IDs. */
export function inspectCloudJournal(options) {
  return scan(options).result;
}

/** User-confirmed local evidence extraction, NOT a recovery or a server sync.
 * The raw content may contain private account/game data. Callers must offer a
 * local download, not telemetry, automatic upload, or console logging.
 */
export function exportDamagedCloudJournal({uid,storage,confirmedByUser=false}={}) {
  if (confirmedByUser !== true)
    return Object.freeze({ok:false,code:'USER_CONFIRMATION_REQUIRED'});
  const {result,raw}=scan({uid,storage});
  if (!result.damaged)
    return Object.freeze({ok:false,code:'NO_DAMAGED_JOURNAL'});
  if (typeof raw !== 'string')
    return Object.freeze({ok:false,code:'NO_READABLE_EVIDENCE'});
  if (raw.length > MAX_EVIDENCE_CHARS)
    return Object.freeze({ok:false,code:'EVIDENCE_TOO_LARGE'});
  // Evidence preserves exact JS string content (including invalid JSON).
  // Never "repair" or normalize the original localStorage key.
  return Object.freeze({ok:true,code:'EVIDENCE_READY',
    filename:'yunyu-cloud-queue-evidence.txt',
    mimeType:'text/plain;charset=utf-8',content:raw,diagnosis:result.code});
}
