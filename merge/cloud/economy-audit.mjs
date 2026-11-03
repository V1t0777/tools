/** P3.7 offline-only reward audit; NOT a deployed security boundary. */
import {validateSave} from '../engine.mjs';
import {BUILDINGS,getProducerUpgrade,getWarehouseUpgrade} from '../economy.mjs';
const KNOWN=new Set(['move','produce','order','store','withdraw',
  'upgradeProducer','upgradeWarehouse','upgradeBuilding']);
function expected(s,a){
  if(a.type==='order'){
    const o=s.orders.find(x=>x.id===a.orderId);
    if(!o)throw Error('Reward audit: missing pre-operation order');
    return {coins:o.coins,xp:o.xp};
  }
  if(a.type==='upgradeWarehouse'){
    const rule=getWarehouseUpgrade(s.warehouse.capacity);
    if(!rule)throw Error('Reward audit: warehouse max level');
    return {coins:-rule.coins,xp:0};
  }
  if(a.type==='upgradeProducer'){
    const p=s.board.find(x=>x?.kind==='producer'&&x.id===a.producerId);
    const rule=p&&getProducerUpgrade(p.level);
    if(!rule)throw Error('Reward audit: producer not upgradeable');
    return {coins:-rule.coins,xp:0};
  }
  if(a.type==='upgradeBuilding'){
    if(!Object.hasOwn(BUILDINGS,a.buildingId))throw Error('Reward audit: unknown building');
    return {coins:-BUILDINGS[a.buildingId].coins,xp:0};
  }
  return {coins:0,xp:0};
}
export function auditEconomyTransition(before,command,result){
  if(!validateSave(before)||!result||!validateSave(result.state)||
    !command?.action||!KNOWN.has(command.action.type)||typeof result.ok!=='boolean')
    throw Error('Reward audit: malformed transition');
  const want=result.ok?expected(before,command.action):{coins:0,xp:0};
  const coins=result.state.coins-before.coins,xp=result.state.xp-before.xp;
  if(coins!==want.coins||xp!==want.xp)throw Error('Reward audit: mismatched currency or experience delta');
  if(result.state.revision-before.revision!==Number(result.ok))
    throw Error('Reward audit: invalid revision increment');
  return {action:command.action.type,ok:result.ok,coins,xp,
    beforeRevision:before.revision,afterRevision:result.state.revision};
}
