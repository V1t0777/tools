/** P2.28: no startup writes for blocked or unchanged recovered saves. */
import {advanceTime} from './engine.mjs';
import {commitNormalSnapshot} from './save-transaction.mjs';

/**
 * Prepare the first in-memory state without ever exposing unverified
 * startup regeneration as saved. Keep the last trusted raw baseline.
 * This is synchronous best-effort localStorage, NOT an atomic Web Lock.
 */
export function prepareNormalStartup(loaded,storage,now=Date.now()) {
  if(loaded.blocked)
    return Object.freeze({state:loaded.state,raw:loaded.raw,blocked:true,
      reason:loaded.reason,attempted:false});
  const advanced=advanceTime(loaded.state,now);
  if(loaded.recovered && advanced===loaded.state)
    return Object.freeze({state:loaded.state,raw:loaded.raw,
      blocked:false,attempted:false});
  const receipt=commitNormalSnapshot(storage,advanced,{expectedRaw:loaded.raw});
  if(receipt.ok)
    return Object.freeze({state:advanced,raw:receipt.raw,
      blocked:false,attempted:true,verifiedReadback:true});
  // A failed write can have reached storage. Never advance UI or retry.
  return Object.freeze({state:loaded.state,raw:loaded.raw,blocked:true,
    reason:receipt.reason,attempted:true,verifiedReadback:false});
}
