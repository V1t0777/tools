/** P3.1 offline-safe command journal for the *future* authenticated cloud client.
 * No network calls are made unless connect()/flush() is invoked. Not wired to P2 local saves.
 * The browser never submits its own wallet, RNG, or nextState to the server.
 */
import { normalizeCommand } from './authority.mjs';
import { validateSave } from '../engine.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION = 1;
const MAX_PENDING = 32;
export const MAX_STORED_BYTES = 160_000;
const RETRY_BASE_MS = 1_000;
const RETRY_CEILING_MS = 60_000;
const copy = value => structuredClone(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validSnapshot = reply => plain(reply) && validateSave(reply.state) &&
  Number.isSafeInteger(reply.revision) && reply.revision >= 0 && reply.revision === reply.state.revision;

export const queueStorageKey = uid => {
  if (typeof uid !== 'string' || !UUID.test(uid)) throw Error('Valid account ID required');
  return `toolbox.merge-isle.cloud-queue.v1.${uid.toLowerCase()}`;
};

export function createOfflineCommandQueue({ uid, storage, transport, clock = () => Date.now(),
  makeId = () => globalThis.crypto.randomUUID(), maxPending = MAX_PENDING } = {}) {
  const key = queueStorageKey(uid);
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function')
    throw Error('Durable storage is required; cloud commands may not be queued in memory only');
  if (!transport || typeof transport.read !== 'function' || typeof transport.execute !== 'function')
    throw Error('Authenticated transport required');
  if (!Number.isInteger(maxPending) || maxPending < 1 || maxPending > MAX_PENDING)
    throw Error('Invalid queue capacity');

  function validJournal(value) {
    if (!plain(value) || value.version !== VERSION || value.uid !== uid.toLowerCase() ||
      !Array.isArray(value.pending) || value.pending.length > maxPending ||
      !['conflict','rejected','protocol-error'].includes(value.blocked) && value.blocked !== null) return false;
    if (value.confirmed !== null && !validSnapshot(value.confirmed)) return false;
    // The queue can only block an existing unresolved head. Do not silently
    // accept impossible persisted states after a crash or external mutation.
    if (value.blocked !== null && value.pending.length === 0) return false;
    const ids = new Set();
    return value.pending.every((entry, index) => {
      if (!plain(entry) || !UUID.test(entry.operationId) ||
        (entry.expectedRevision !== null && (!Number.isSafeInteger(entry.expectedRevision) || entry.expectedRevision < 0)) ||
        !Number.isSafeInteger(entry.attempts) || entry.attempts < 0 || entry.attempts > 100_000 ||
        !Number.isSafeInteger(entry.nextRetryAt) || entry.nextRetryAt < 0) return false;
      // UUIDs are case-insensitive; the server normalizes them to lowercase.
      // Two differently cased entries must never alias the same remote action.
      const operationId = entry.operationId.toLowerCase();
      if (ids.has(operationId)) return false;
      ids.add(operationId);
      if (entry.attempts > 0 && entry.expectedRevision === null) return false;
      if (entry.nextRetryAt > 0 && entry.attempts === 0) return false;
      // Only the first pending command may be pinned/sent. All later commands
      // remain completely unsent until the earlier outcome is durable.
      if (index > 0 && (entry.expectedRevision !== null ||
          entry.attempts !== 0 || entry.nextRetryAt !== 0)) return false;
      // A pinned or attempted operation requires a remotely confirmed base.
      if (value.confirmed === null && (entry.expectedRevision !== null ||
          entry.attempts !== 0 || entry.nextRetryAt !== 0)) return false;
      return normalizeCommand({operationId:entry.operationId, expectedRevision:entry.expectedRevision ?? 0,
        action:entry.action}) !== null;
    });
  }

  const empty = () => ({version:VERSION,uid:uid.toLowerCase(),confirmed:null,pending:[],blocked:null});
  let journal;
  let damaged = false;
  try {
    const raw = storage.getItem(key);
    // Only the actual absence of a key is a new journal. An existing key with
    // an empty or non-string value is damaged, not permission to reset the
    // queue and discard an operation whose server outcome may be unknown.
    if (raw === null) journal = empty();
    else if (typeof raw !== 'string' || raw.length === 0 ||
        raw.length > MAX_STORED_BYTES) damaged = true;
    else {
      const parsed = JSON.parse(raw);
      if (validJournal(parsed)) journal = parsed;
      else damaged = true;
    }
  } catch { damaged = true; }
  if (!journal) journal = empty();
  let running = null;
  let phase = damaged ? 'storage-error' : 'unverified';
  let verifiedSinceStart = false;

  function write(next) {
    if (damaged) return false;
    const raw = JSON.stringify(next);
    if (raw.length > MAX_STORED_BYTES || !validJournal(next)) return false;
    try { storage.setItem(key, raw); journal = next; return true; }
    catch { phase = 'storage-error'; return false; }
  }
  const status = (extra = {}) => ({ phase, blocked:journal.blocked, pending:journal.pending.length,
    // This survives reloads in the journal. An attempt is NOT proof of either
    // success or failure; the server might have committed without an ACK.
    attemptedPending:journal.pending.filter(entry => entry.attempts > 0).length,
    firstOperationId:journal.pending[0]?.operationId ?? null,
    nextRetryAt:journal.pending[0]?.nextRetryAt ?? 0,
    revision:journal.confirmed?.revision ?? null,
    // Cached snapshots remain unverified until this session reads from the server.
    verified:verifiedSinceStart,
    ...extra });
  function preview() { return { ...status(), state:journal.confirmed ? copy(journal.confirmed.state) : null }; }
  function isValidAction(action) {
    return normalizeCommand({operationId:'00000000-0000-4000-8000-000000000001',expectedRevision:0,action}) !== null;
  }
  function enqueue(action) {
    if (damaged || phase === 'storage-error') return {ok:false,code:'STORAGE_ERROR'};
    if (!isValidAction(action)) return {ok:false,code:'BAD_COMMAND'};
    if (journal.pending.length >= maxPending) return {ok:false,code:'QUEUE_FULL'};
    let id;
    try {id=makeId()?.toLowerCase();} catch {return {ok:false,code:'ID_UNAVAILABLE'};}
    if (!UUID.test(id) || journal.pending.some(e=>e.operationId===id)) return {ok:false,code:'INVALID_ID'};
    const next = copy(journal);
    next.pending.push({operationId:id,action:copy(action),expectedRevision:null,attempts:0,nextRetryAt:0});
    if (!write(next)) return {ok:false,code:'STORAGE_ERROR'};
    phase = journal.blocked ? 'blocked' : 'pending';
    return {ok:true,operationId:id,...status()};
  }

  // Never downgrade a newer confirmed state when stale HTTP responses arrive late.
  function adopt(reply) {
    if (!validSnapshot(reply)) return false;
    if (journal.confirmed && reply.revision < journal.confirmed.revision) return false;
    const next=copy(journal);
    next.confirmed={revision:reply.revision,state:copy(reply.state)};
    return write(next);
  }
  function networkFailure(head) {
    const next=copy(journal);
    const item=next.pending.find(e=>e.operationId===head.operationId);
    if (!item) { phase='storage-error'; return false; }
    // Retry using the SAME operation ID and pinned revision: outcome may be unknown.
    item.nextRetryAt=clock()+Math.min(RETRY_CEILING_MS,RETRY_BASE_MS * 2 ** Math.min(item.attempts-1,6));
    if (!write(next)) { phase='storage-error'; return false; }
    phase='offline';
    return true;
  }
  async function readRemote() {
    let reply;
    try { reply=await transport.read(); }
    catch {phase='offline'; return {ok:false,code:'NETWORK_UNAVAILABLE',...status()};}
    if (!validSnapshot(reply) || reply.ok !== true || reply.status !== 'ok') {
      phase='protocol-error';return {ok:false,code:'INVALID_SNAPSHOT',...status()};
    }
    if (journal.confirmed && reply.revision < journal.confirmed.revision) {
      phase='protocol-error';return {ok:false,code:'STALE_SNAPSHOT',...status()};
    }
    if (!adopt(reply)) {phase='storage-error';return {ok:false,code:'STORAGE_ERROR',...status()};}
    verifiedSinceStart = true;
    phase=journal.blocked?'blocked':journal.pending.length?'pending':'synced';
    return {ok:true,...status()};
  }
  async function process({force=false,connectOnly=false}={}) {
    if (damaged || phase==='storage-error') return {ok:false,code:'STORAGE_ERROR',...status()};
    phase='syncing';
    const refreshed=await readRemote();
    if (!refreshed.ok || connectOnly) return refreshed;
    if (journal.blocked) {phase='blocked';return {ok:false,code:'ACTION_NEEDS_REVIEW',...status()};}
    while (journal.pending.length) {
      let head=journal.pending[0];
      if (!force && head.nextRetryAt > clock()) {phase='offline';return {ok:false,code:'RETRY_LATER',...status()};}
      if (head.expectedRevision === null) {
        const next=copy(journal);
        next.pending[0].expectedRevision=journal.confirmed.revision;
        if (!write(next)) {phase='storage-error';return {ok:false,code:'STORAGE_ERROR',...status()};}
        head=journal.pending[0];
      }
      const outbound={operationId:head.operationId,expectedRevision:head.expectedRevision,action:copy(head.action)};
      // Persist attempt *before* transmission. A rejected browser write must prevent sending.
      const sending=copy(journal);
      sending.pending[0].attempts++;
      sending.pending[0].nextRetryAt=0;
      if (!write(sending)) {phase='storage-error';return {ok:false,code:'STORAGE_ERROR',...status()};}
      let reply;
      try {reply=await transport.execute(outbound);}
      catch {
        // The command may already be committed remotely. If the durable retry
        // plan cannot be saved, report STORAGE_ERROR rather than hiding the
        // persistence failure behind an ordinary connectivity warning.
        if (!networkFailure(outbound))
          return {ok:false,code:'STORAGE_ERROR',...status()};
        return {ok:false,code:'NETWORK_UNAVAILABLE',...status()};
      }
      const canonical=validSnapshot(reply);
      if (!canonical || journal.confirmed && reply.revision < journal.confirmed.revision) {
        const next=copy(journal);next.blocked='protocol-error';
        if (!write(next)) phase='storage-error'; else phase='blocked';
        return {ok:false,code:'INVALID_RESPONSE',...status()};
      }
      if (['applied','replayed'].includes(reply.status) && reply.ok === true) {
        if (reply.revision < outbound.expectedRevision+1) {
          const next=copy(journal);next.blocked='protocol-error';
          if (!write(next)) phase='storage-error'; else phase='blocked';
          return {ok:false,code:'INVALID_RESPONSE',...status()};
        }
        const next=copy(journal);
        next.confirmed={revision:reply.revision,state:copy(reply.state)};
        next.pending.shift();
        if (!write(next)) {phase='storage-error';return {ok:false,code:'STORAGE_ERROR',...status()};}
        continue;
      }
      if (reply.status==='conflict' || reply.status==='rejected' || reply.status==='replayed' && reply.ok===false) {
        const next=copy(journal);
        next.confirmed={revision:reply.revision,state:copy(reply.state)};
        next.blocked=reply.status==='conflict'?'conflict':'rejected';
        if (!write(next)) phase='storage-error'; else phase='blocked';
        return {ok:false,code:reply.code||'ACTION_NEEDS_REVIEW',...status()};
      }
      const next=copy(journal);next.blocked='protocol-error';
          if (!write(next)) phase='storage-error'; else phase='blocked';
      return {ok:false,code:'INVALID_RESPONSE',...status()};
    }
    phase='synced';return {ok:true,...status()};
  }
  /** Conflict review is view-only. A cached snapshot is not an authenticated
   * confirmation after a page restart; callers must connect() first.
   */
  function inspectConflict() {
    if (damaged || phase === 'storage-error') return {ok:false,code:'STORAGE_ERROR'};
    if (journal.blocked !== 'conflict' || !journal.pending.length)
      return {ok:false,code:'NO_CONFLICT'};
    if (!verifiedSinceStart || phase !== 'blocked' || !journal.confirmed)
      return {ok:false,code:'REMOTE_VERIFICATION_REQUIRED'};
    return {ok:true,originalOperationId:journal.pending[0].operationId,
      action:copy(journal.pending[0].action),revision:journal.confirmed.revision,
      state:copy(journal.confirmed.state),pending:journal.pending.length,
      followingUnsent:journal.pending.slice(1).every(e=>e.attempts===0)};
  }

  /** A conflict response is definitive: that operation was not committed.
   * Do NOT silently rebase its slot-based intent. The player must inspect the
   * current server state and explicitly choose a NEW action, which receives a
   * NEW ID. A reviewedState snapshot is required and rechecked before creating
   * the replacement, even if revision is unchanged. No command is sent until
   * a separate flush().
   */
  async function replaceConflicted({confirmedByUser=false,originalOperationId,
    expectedRevision,reviewedState,newAction,discardFollowing=false}={}) {
    if (damaged || phase === 'storage-error') return {ok:false,code:'STORAGE_ERROR',...status()};
    if (journal.blocked !== 'conflict' || !journal.pending.length)
      return {ok:false,code:'NO_CONFLICT',...status()};
    // A revision is not an exact view of the state: energy regeneration and
    // other authoritative time updates can change a snapshot at equal revision.
    // The caller MUST supply the detached state shown at inspectConflict().
    if (!confirmedByUser || !journal.confirmed || !validateSave(reviewedState) ||
        originalOperationId !== journal.pending[0].operationId ||
        expectedRevision !== journal.confirmed.revision)
      return {ok:false,code:'REVIEW_CONFIRMATION_REQUIRED',...status()};
    // Take the comparison bytes before the first await. A different tab can
    // refresh this durable journal (same revision) after the user reviews it.
    const reviewedBytes=JSON.stringify(reviewedState);
    if (JSON.stringify(journal.confirmed.state) !== reviewedBytes) {
      phase='blocked';
      return {ok:false,code:'REVIEW_STALE',...status()};
    }
    if (!isValidAction(newAction)) return {ok:false,code:'BAD_COMMAND',...status()};
    if (journal.pending.slice(1).some(e=>e.attempts!==0))
      return {ok:false,code:'FOLLOWING_OUTCOME_UNKNOWN',...status()};
    if (journal.pending.length > 1 && !discardFollowing)
      return {ok:false,code:'FOLLOWING_ACTIONS_NEED_REVIEW',...status()};
    // Re-read under the coordinator's exclusive Web Lock before accepting
    // the confirmation; another device may have changed the server meanwhile.
    const fresh=await readRemote();
    if (!fresh.ok) return fresh;
    if (journal.confirmed.revision !== expectedRevision ||
        JSON.stringify(journal.confirmed.state) !== reviewedBytes) {
      phase='blocked';
      return {ok:false,code:'REVIEW_STALE',...status()};
    }
    let id;
    try {id=makeId()?.toLowerCase();} catch {return {ok:false,code:'ID_UNAVAILABLE',...status()};}
    if (!UUID.test(id) || journal.pending.some(e=>e.operationId===id))
      return {ok:false,code:'INVALID_ID',...status()};
    const discarded=journal.pending.length;
    const next=copy(journal);
    next.pending=[{operationId:id,action:copy(newAction),expectedRevision:null,
      attempts:0,nextRetryAt:0}];
    next.blocked=null;
    if (!write(next)) {phase='storage-error';return {ok:false,code:'STORAGE_ERROR',...status()};}
    phase='pending';
    return {ok:true,operationId:id,discarded,...status()};
  }

  function serialize(task) {
    if (running) return running;
    running=Promise.resolve().then(task).finally(()=>{running=null;});
    return running;
  }
  return {
    preview,
    inspectConflict,
    replaceConflicted(options) {
      if (running) return Promise.resolve({ok:false,code:'BUSY_OR_UNSAFE',...status()});
      return serialize(()=>replaceConflicted(options));
    },
    enqueue,
    // Only verified server read updates this cache. No merging from local P2 sandbox saves.
    connect() {return serialize(()=>process({connectOnly:true}));},
    flush(options={}) {return serialize(()=>process(options));},
    // Unsent commands are safe to cancel, transmitted/ambiguous commands are not.
    discardUnsent() {
      if (running || damaged || phase==='storage-error') return {ok:false,code:'BUSY_OR_UNSAFE'};
      if (journal.pending.some(e=>e.attempts!==0)) return {ok:false,code:'OUTCOME_MAY_BE_UNKNOWN'};
      const next=copy(journal);next.pending=[];
      if(!write(next))return {ok:false,code:'STORAGE_ERROR'};
      phase=next.blocked?'blocked':'unverified';return {ok:true,...status()};
    },
    // On a definitive conflict/rejection, explicit user confirmation is required.
    // Clears the ENTIRE following unsent chain rather than reinterpreting old commands.
    discardConflicted({confirmedByUser=false}={}) {
      if (running || !confirmedByUser || !['conflict','rejected'].includes(journal.blocked) ||
          journal.pending.slice(1).some(item=>item.attempts!==0))
        return {ok:false,code:'CONFIRMATION_REQUIRED'};
      const next=copy(journal);next.pending=[];next.blocked=null;
      if(!write(next))return {ok:false,code:'STORAGE_ERROR'};
      phase='unverified';return {ok:true,...status()};
    }
  };
}