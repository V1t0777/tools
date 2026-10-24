/** P2.29: conservative cross-tab acceptance for equal-revision V3 saves.
 * Only monotonic clock progress may be adopted without a revision increase.
 * This policy never reads/writes storage and cannot replace a Web Lock.
 */
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
export function isSafeSameRevisionClockUpdate(local,remote) {
  if(!local||!remote||local.revision!==remote.revision)return false;
  if(!Number.isFinite(local.energy)||!Number.isFinite(remote.energy)||
      !Number.isFinite(local.energyAt)||!Number.isFinite(remote.energyAt)||
      remote.energy<local.energy||remote.energyAt<local.energyAt)return false;
  if(!Array.isArray(local.board)||!Array.isArray(remote.board)||
      local.board.length!==remote.board.length)return false;
  try {
    if(withoutClockFields(local)!==withoutClockFields(remote))return false;
    for(let i=0;i<local.board.length;i++) {
      const a=local.board[i],b=remote.board[i];
      if(a?.kind!=='producer')continue;
      if(a.charges===b.charges&&a.cooldownUntil===b.cooldownUntil)continue;
      // advanceTime() can only replenish an exhausted producer after cooldown.
      if(!(a.charges===0&&a.cooldownUntil>0&&
          b.charges>a.charges&&b.cooldownUntil===0))return false;
    }
    return true;
  }catch{return false;}
}
