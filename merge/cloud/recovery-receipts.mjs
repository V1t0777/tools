/**
 * P3.15 read-only recovery receipt review for a DAMAGED future cloud journal.
 *
 * This is an advisory tool, NOT an execution/recovery API. An authenticated
 * server-side caller must supply findOperation(uid, operationId); no browser
 * receipt can be considered authoritative. No reset/replay/write is exposed.
 * Retained server receipts may expire; absence is NEVER evidence of non-execution.
 */
import {inspectCloudJournal} from './journal-diagnostics.mjs';
import {queueStorageKey,MAX_STORED_BYTES} from './offline-queue.mjs';
import {normalizeCommand} from './authority.mjs';
import {hashOperation} from './db-authority.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const safeCount = n => Number.isSafeInteger(n) && n >= 0 && n <= 100_000;
const counts = () => ({total:0,attempted:0,unattempted:0,applied:0,rejected:0,unresolved:0});
const outcome = (code, stats=counts()) => Object.freeze({
  code, ...stats,
  // Receipt matching is a point-in-time observation, not an authorization to
  // repair, replay, overwrite, or trust a client-supplied remote response.
  readyToReset:false,readyToReplay:false,canResumeCloudWrites:false,
  remoteVerified:false,recommendation:'PRESERVE_EVIDENCE_AND_REVIEW'
});

/** No reading of raw evidence or server operations until explicitly confirmed.
 * findOperation must be a trusted server-side READ-ONLY operation. It must NOT
 * call execute(), upsert an operation, or initialize a missing player save.
 */
export async function reviewDamagedJournalReceipts({
  uid,storage,findOperation,confirmedByUser=false
}={}) {
  if (confirmedByUser !== true) return outcome('USER_CONFIRMATION_REQUIRED');
  const key=queueStorageKey(uid);
  if (!storage || typeof storage.getItem !== 'function')
    return outcome('LOCAL_STORAGE_UNAVAILABLE');
  let raw;
  try {raw=storage.getItem(key);} catch {return outcome('LOCAL_STORAGE_UNAVAILABLE');}
  if (typeof raw !== 'string' || raw.length===0 || raw.length>MAX_STORED_BYTES)
    return outcome('NO_SAFE_PARSEABLE_EVIDENCE');

  // Reuse the actual queue schema validator to disallow bypassing a healthy
  // queue. Even if damaged, only operation entries meeting the strict command
  // contract can be considered for a read-only receipt lookup.
  const diagnosis=inspectCloudJournal({uid,storage:{
    getItem: requested => requested===key ? raw : null,
    setItem: () => {throw Error('Read-only evidence inspection')}
  }});
  if (!diagnosis.damaged) return outcome('JOURNAL_NOT_DAMAGED');
  if (diagnosis.code !== 'JOURNAL_INVALID_SCHEMA')
    return outcome('NO_SAFE_PARSEABLE_EVIDENCE');
  let decoded;
  try {decoded=JSON.parse(raw);} catch {return outcome('NO_SAFE_PARSEABLE_EVIDENCE');}
  if (!plain(decoded) || decoded.version !== 1 || decoded.uid !== uid.toLowerCase() ||
      !Array.isArray(decoded.pending) || decoded.pending.length>32)
    return outcome('UNTRUSTWORTHY_JOURNAL_STRUCTURE');

  const operations=[];
  const seen=new Set();
  for (const entry of decoded.pending) {
    if (!plain(entry) || typeof entry.operationId!=='string' || !UUID.test(entry.operationId) ||
        !safeCount(entry.attempts) ||
        (entry.expectedRevision!==null &&
          (!Number.isSafeInteger(entry.expectedRevision) || entry.expectedRevision<0)))
      return outcome('UNTRUSTWORTHY_OPERATION_EVIDENCE');
    const id=entry.operationId.toLowerCase();
    if (seen.has(id)) return outcome('DUPLICATE_OPERATION_IDS');
    seen.add(id);
    if (entry.attempts>0 && entry.expectedRevision===null)
      return outcome('UNPINNED_ATTEMPT');
    const command=normalizeCommand({operationId:id,
      expectedRevision:entry.expectedRevision??0,action:entry.action});
    if (!command) return outcome('UNTRUSTWORTHY_OPERATION_EVIDENCE');
    operations.push({command,attempted:entry.attempts>0});
  }
  const totals=counts();
  totals.total=operations.length;
  totals.attempted=operations.filter(op=>op.attempted).length;
  totals.unattempted=totals.total-totals.attempted;
  if (totals.attempted===0)
    return outcome('NO_RECORDED_SEND_ATTEMPTS',totals);
  if (typeof findOperation!=='function')
    return outcome('TRUSTED_LEDGER_UNAVAILABLE',totals);

  for (const {command,attempted} of operations) {
    if (!attempted) continue; // Never claim an unsent tail was not executed.
    let expectedHash,record;
    try {
      expectedHash=await hashOperation(command);
      record=await findOperation(uid.toLowerCase(),command.operationId);
    } catch {
      return outcome('TRUSTED_LEDGER_READ_FAILED',totals);
    }
    if (record===null) {
      totals.unresolved++;
      continue; // A pruned/missing receipt does not prove non-execution.
    }
    if (!plain(record) || !SHA256.test(record.request_hash) ||
        !['applied','rejected'].includes(record.status))
      return outcome('INVALID_LEDGER_RECORD',totals);
    if (record.request_hash!==expectedHash)
      return outcome('OPERATION_FINGERPRINT_MISMATCH',totals);
    totals[record.status]++;
  }
  // Local evidence can change across async reads. Never present a matched
  // result for bytes that were changed/removed by another tab during review.
  let after;
  try {after=storage.getItem(key);} catch {return outcome('LOCAL_EVIDENCE_CHANGED',counts());}
  if (after!==raw) return outcome('LOCAL_EVIDENCE_CHANGED',counts());
  return outcome(totals.unresolved>0?'LEDGER_ENTRIES_MISSING':'MATCHED_RECEIPTS_REVIEW_REQUIRED',totals);
}
