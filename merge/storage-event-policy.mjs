/** P2.29–P2.30: conservative cross-tab acceptance for equal-revision V3 saves.
 * Only monotonic clock progress may be adopted without a revision increase.
 * This policy never reads/writes storage and cannot replace a Web Lock.
 */
import {ENERGY_REGEN_MS,MAX_ENERGY,PRODUCER_CHARGES} from './engine.mjs';

function withoutClockFields(state) {
  return JSON.stringify({
    ...state,energy:null,energyAt:null,
    board:state.board.map(item=>item?.kind==='producer'
      ?{...item,charges:null,cooldownUntil:null}:item)
  });
}

/** Both states must already be validated V3 snapshots.
 * A changed economy/board at the same revision requires reconciliation.
 */
export function isSafeSameRevisionClockUpdate(local,remote,now=Date.now()) {
  if(!local||!remote||local.revision!==remote.revision)return false;
  if(!Number.isFinite(local.energy)||!Number.isFinite(remote.energy)||
      !Number.isFinite(local.energyAt)||!Number.isFinite(remote.energyAt)||
      remote.energy<local.energy||remote.energyAt<local.energyAt)return false;
  if(!Array.isArray(local.board)||!Array.isArray(remote.board)||
      local.board.length!==remote.board.length)return false;
  if(!Number.isFinite(now)||now<0)return false;
  // A remote tab cannot earn future clock ticks. If the local baseline was
  // already future-dated (e.g. device clock changed), identical clock fields
  // remain comparable, but any further forward jump must wait until due.
  if(remote.energyAt!==local.energyAt&&remote.energyAt>now)return false;
  // Never grant more energy than the elapsed whole regeneration ticks.
  const elapsed=Math.floor((remote.energyAt-local.energyAt)/ENERGY_REGEN_MS);
  if(remote.energy>local.energy) {
    if(elapsed<=0||remote.energy>Math.min(MAX_ENERGY,local.energy+elapsed))return false;
    if(remote.energy<MAX_ENERGY&&remote.energy!==local.energy+elapsed)return false;
  } else if(local.energy<MAX_ENERGY&&remote.energyAt!==local.energyAt) {
    return false;
  }
  try {
    if(withoutClockFields(local)!==withoutClockFields(remote))return false;
    let recharged=false;
    for(let i=0;i<local.board.length;i++) {
      const a=local.board[i],b=remote.board[i];
      if(a?.kind!=='producer')continue;
      if(a.charges===b.charges&&a.cooldownUntil===b.cooldownUntil)continue;
      // A clock tick refills an expired producer to its exact maximum.
      if(!(a.charges===0&&a.cooldownUntil>0&&a.cooldownUntil<=now&&
          b.charges===PRODUCER_CHARGES&&b.cooldownUntil===0))return false;
      recharged=true;
    }
    // At full energy, the engine moves energyAt only alongside a refill.
    if(local.energy===MAX_ENERGY&&remote.energyAt>local.energyAt&&
        (!recharged||elapsed<=0))return false;
    return true;
  }catch{return false;}
}
