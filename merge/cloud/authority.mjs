/** P3 reference authority: no network, DB, browser or Supabase side effects.
 * Only a verified server should supply actorUid, time, randomness and persistence.
 */
import { createInitialState, validateSave, advanceTime, moveOrMerge, produce,
  fulfillOrder, storeItem, withdrawItem, upgradeWarehouse, upgradeProducer,
  upgradeBuilding } from '../engine.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED = Object.freeze({
  move: ['from', 'to'], produce: ['slot'], order: ['orderId'], store: ['slot'],
  withdraw: ['slot'], upgradeWarehouse: [], upgradeProducer: ['producerId'],
  upgradeBuilding: ['buildingId']
});
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const keysAre = (value, expected) => plain(value) &&
  Object.keys(value).length === expected.length && expected.every(k=>own(value,k));
const positiveRevision = x => Number.isSafeInteger(x) && x >= 0;
const invalid = code => ({ status: 'rejected', code, ok: false });
const clone = value => structuredClone(value);

/** Validation is intentionally strict. Ignore no extra, client-provided monetary fields. */
export function normalizeCommand(raw) {
  if (!keysAre(raw, ['operationId','expectedRevision','action'])) return null;
  if (typeof raw.operationId !== 'string' || !UUID.test(raw.operationId) ||
      !positiveRevision(raw.expectedRevision) || !plain(raw.action)) return null;
  const {type, ...args} = raw.action;
  if (!own(ALLOWED, type) || !keysAre(args, ALLOWED[type])) return null;
  if (['move','produce','store','withdraw'].includes(type)) {
    for (const v of Object.values(args)) if (!Number.isInteger(v) || v < 0 || v > 55 && type !== 'withdraw') return null;
    if (type === 'withdraw' && args.slot > 7) return null;
  }
  if (type === 'order' && (typeof args.orderId !== 'string' || !/^o\d{1,14}$/.test(args.orderId))) return null;
  if (type === 'upgradeProducer' && (typeof args.producerId !== 'string' || !/^m[1-9]\d{0,13}$/.test(args.producerId))) return null;
  if (type === 'upgradeBuilding' && !['storefront','garden','harbor'].includes(args.buildingId)) return null;
  return { operationId: raw.operationId.toLowerCase(), expectedRevision: raw.expectedRevision,
    action: {type,...args} };
}

/** Server-derived transition. Client never provides a nextState or rewards. */
export function planTrustedTransition(state, command, {now, rng}) {
  if (!validateSave(state) || !positiveRevision(now) || typeof rng !== 'function') throw Error('Invalid trusted context');
  const current = advanceTime(state, now);
  const action = command.action;
  let result;
  switch (action.type) {
    case 'move': result = moveOrMerge(current, action.from, action.to); break;
    case 'produce': result = produce(current, action.slot, now, rng); break;
    case 'order': result = fulfillOrder(current, action.orderId); break;
    case 'store': result = storeItem(current, action.slot); break;
    case 'withdraw': result = withdrawItem(current, action.slot); break;
    case 'upgradeWarehouse': result = upgradeWarehouse(current); break;
    case 'upgradeProducer': result = upgradeProducer(current, action.producerId); break;
    case 'upgradeBuilding': result = upgradeBuilding(current, action.buildingId); break;
    default: throw Error('Unrecognized trusted action');
  }
  if (result.ok && (!validateSave(result.state) || result.state.revision !== state.revision + 1))
    throw Error('Invalid authority transition');
  return result;
}

/** Reference in-memory transaction adapter for tests only; NOT a deployed backend. */
export function createInMemoryAuthority({clock = () => Date.now(), rng = secureRandom} = {}) {
  const records = new Map();
  const lane = new Map();
  async function locked(uid, task) {
    const before = lane.get(uid) ?? Promise.resolve();
    let unlock;
    const pending = new Promise(resolve => { unlock = resolve; });
    lane.set(uid, pending);
    await before;
    try {return await task();}
    finally { unlock(); if (lane.get(uid) === pending) lane.delete(uid); }
  }
  function getRecord(uid, now) {
    let entry = records.get(uid);
    if (!entry) { entry = {state:createInitialState(now), journal: new Map()}; records.set(uid,entry); }
    return entry;
  }
  const checkUid = uid => typeof uid === 'string' && UUID.test(uid);
  return {
    async read(actorUid) {
      if (!checkUid(actorUid)) return invalid('AUTH_REQUIRED');
      return locked(actorUid, () => {
        const now = clock();
        if (!positiveRevision(now)) throw Error('Invalid server clock');
        const entry = getRecord(actorUid, now);
        entry.state = advanceTime(entry.state, now);
        return {status:'ok', ok:true, revision:entry.state.revision, state:clone(entry.state)};
      });
    },
    async execute(actorUid, rawCommand) {
      if (!checkUid(actorUid)) return invalid('AUTH_REQUIRED');
      const command = normalizeCommand(rawCommand);
      if (!command) return invalid('BAD_COMMAND');
      return locked(actorUid, () => {
        const now = clock();
        if (!positiveRevision(now)) throw Error('Invalid server clock');
        const entry = getRecord(actorUid, now);
        entry.state = advanceTime(entry.state, now);
        const fingerprint = JSON.stringify(command);
        const previous = entry.journal.get(command.operationId);
        // Return the *latest* snapshot: returning the old operation's saved state would rewind another device.
        if (previous) return { status: previous.fingerprint === fingerprint ? 'replayed' : 'rejected',
          code: previous.fingerprint === fingerprint ? previous.code : 'OPERATION_ID_REUSE',
          ok: previous.fingerprint === fingerprint && previous.ok,
          revision:entry.state.revision, state:clone(entry.state) };
        if (command.expectedRevision !== entry.state.revision)
          return {status:'conflict', code:'REVISION_CONFLICT', ok:false,
            revision:entry.state.revision, state:clone(entry.state)};
        const result = planTrustedTransition(entry.state, command, {now, rng});
        if (result.ok) entry.state = result.state;
        const status = result.ok ? 'applied' : 'rejected';
        const code = result.ok ? result.kind : 'ACTION_NOT_ALLOWED';
        entry.journal.set(command.operationId, {fingerprint, ok:result.ok, code});
        return {status, code, ok:result.ok, revision:entry.state.revision,
          state:clone(entry.state), message:result.message};
      });
    }
  };
}

export function secureRandom() {
  if (!globalThis.crypto?.getRandomValues) throw Error('Secure random source unavailable');
  return globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
}