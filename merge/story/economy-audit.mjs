/**
 * Deterministic, optimistic story economy audit — NOT a player simulator.
 *
 * Replays the same makeOrder/XP/coins/building rules as the shipped V3 engine.
 * The model assumes each order can be fulfilled immediately, without board
 * congestion, RNG, producer charge/cooldown, or optional purchases. Production
 * energy is an ESTIMATE from the economy definition, not observed consumption.
 * Never use this analysis output to grant or modify in-game resources.
 */
import {BUILDINGS,getLevel,makeOrder} from '../economy.mjs';
import {MAX_ENERGY,ENERGY_REGEN_MS} from '../engine.mjs';

const MODES=new Set(['fifo','lowest-energy']);
const PHASES=Object.freeze([
  {id:'garden',requiredLevel:BUILDINGS.garden.minLevel,cost:BUILDINGS.garden.coins},
  {id:'harbor',requiredLevel:BUILDINGS.harbor.minLevel,cost:BUILDINGS.harbor.coins},
  {id:'storefront',requiredLevel:BUILDINGS.storefront.minLevel,cost:BUILDINGS.storefront.coins}
]);

/**
 * @returns {object} Frozen summary; milestones describe AFTER paying build cost.
 * Projection is specifically for the story order (garden → harbor → storefront),
 * not the normal mode's unrestricted building order.
 */
export function projectStoryEconomy({selection='fifo',maxOrders=250}={}){
  if(!MODES.has(selection)||!Number.isSafeInteger(maxOrders)||maxOrders<1||maxOrders>1000)
    throw new RangeError('Invalid story economy projection options');
  let xp=0,coins=0,orderCount=0,estimatedEnergy=0,coinsEarned=0;
  let nextOrderIndex=3,phaseIndex=0;
  const buildings={storefront:0,garden:0,harbor:0};
  const active=[0,1,2].map(i=>makeOrder(i,xp,buildings));
  const snapshots=[];
  function snapshot(id,buildCost){
    snapshots.push(Object.freeze({
      id,orders:orderCount,level:getLevel(xp),xp,coins,
      coinsEarned,coinsSpent:coinsEarned-coins,
      estimatedEnergy,
      estimatedPassiveRegenMinutes:Math.max(0,estimatedEnergy-MAX_ENERGY)*ENERGY_REGEN_MS/60_000,
      buildCost
    }));
  }
  function buildAvailable(){
    while(phaseIndex<PHASES.length){
      const rule=PHASES[phaseIndex];
      if(getLevel(xp)<rule.requiredLevel||coins<rule.cost)break;
      coins-=rule.cost;
      buildings[rule.id]=1;
      snapshot(rule.id,rule.cost);
      phaseIndex++;
    }
  }
  for(;orderCount<maxOrders;){
    buildAvailable();
    if(phaseIndex===PHASES.length)break;
    const position=selection==='fifo'
      ? active.reduce((best,o,i)=>Number(o.id.slice(1))<Number(active[best].id.slice(1))?i:best,0)
      : active.reduce((best,o,i)=>
        o.estimatedEnergy<active[best].estimatedEnergy ||
        (o.estimatedEnergy===active[best].estimatedEnergy &&
         Number(o.id.slice(1))<Number(active[best].id.slice(1))) ? i : best,0);
    const order=active[position];
    estimatedEnergy+=order.estimatedEnergy;
    coins+=order.coins;
    coinsEarned+=order.coins;
    xp+=order.xp;
    orderCount++;
    if(orderCount===1)snapshot('first-order',0);
    active[position]=makeOrder(nextOrderIndex++,xp,buildings);
  }
  buildAvailable();
  return Object.freeze({
    selection,complete:phaseIndex===PHASES.length,
    orders:orderCount,xp,coins,estimatedEnergy,
    coinsEarned,coinsSpent:coinsEarned-coins,
    estimatedPassiveRegenMinutes:Math.max(0,estimatedEnergy-MAX_ENERGY)*ENERGY_REGEN_MS/60_000,
    milestones:Object.freeze(snapshots),
    limitations:'订单物品即时可得的乐观模型；生产体力为估算，未模拟棋盘、随机掉落、冷却、道具、仓库、用户操作或实际游玩时间。'
  });
}
