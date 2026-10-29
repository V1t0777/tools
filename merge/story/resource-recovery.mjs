/** Read-only stalled-action guidance. No save writes, free supplies or auto actions. */
import {advanceTime,ENERGY_REGEN_MS,MAX_TIER,getWarehouseUpgrade,getLevel} from '../engine.mjs';
export function describeStoryWorkshopStall(state,now=Date.now()){
  if(!state||!Array.isArray(state.board)||!Array.isArray(state.warehouse?.slots)||
    !Number.isFinite(now)||now<0)return null;
  const board=state.board;
  if(board.every(Boolean)){
    // An existing deliverable order is a legal way to clear a full board.
    const canDeliver=Array.isArray(state.orders)&&state.orders.some(order=>
      board.some(item=>item?.kind==='material'&&item.chain===order.chain&&item.tier===order.tier));
    if(canDeliver)
      return {code:'BOARD_FULL_DELIVER',message:'棋盘已满：已有可交付的委托，请先交付对应材料腾出空间。'};
    const hasMaterial=board.some(x=>x?.kind==='material');
    const freeWarehouse=state.warehouse.slots.slice(0,state.warehouse.capacity).some(x=>!x);
    if(hasMaterial&&freeWarehouse)
      return {code:'BOARD_FULL_STORE',message:'棋盘已满：选中材料并收纳至临时仓库，腾出生产空间。'};
    const canMerge=board.some((x,i)=>x?.kind==='material'&&x.tier<MAX_TIER&&
      board.some((y,j)=>j>i&&y?.kind==='material'&&y.chain===x.chain&&y.tier===x.tier));
    if(canMerge)
      return {code:'BOARD_FULL_MERGE',message:'棋盘和仓库没有空位：请先合成两件同类同等级材料。'};
    // Expansion is an existing paid engine action, not a free recovery grant.
    const upgrade=getWarehouseUpgrade(state.warehouse.capacity);
    if(hasMaterial&&upgrade&&getLevel(state.xp)>=upgrade.minLevel&&state.coins>=upgrade.coins)
      return {code:'BOARD_FULL_UPGRADE',message:'棋盘与仓库均满：可花费'+upgrade.coins+'金币扩容仓库，再收纳材料腾出空间。请注意建设金币预算。'};
    return {code:'BOARD_FULL_BLOCKED',message:'棋盘与仓库已满且无可合成材料；请保留原始存档，不要反复生产或重置，并反馈卡关。'};
  }
  const live=advanceTime(state,now);
  if(live.energy===0){
    const seconds=Math.max(0,Math.ceil((state.energyAt+ENERGY_REGEN_MS-now)/1000));
    return {code:'ENERGY_WAIT',message:'体力耗尽，预计'+seconds+
      '秒后自然恢复1点；可手动使用已有补给，无需重置。'};
  }
  const producers=live.board.filter(x=>x?.kind==='producer');
  if(producers.length&&producers.every(x=>x.charges===0&&x.cooldownUntil>now)){
    const seconds=Math.max(0,Math.ceil((Math.min(...producers.map(x=>x.cooldownUntil))-now)/1000));
    return {code:'COOLDOWN_WAIT',message:'全部工坊冷却中，最快约'+seconds+
      '秒后恢复；已有冷却卡可手动使用，不会自动消耗。'};
  }
  return null;
}
