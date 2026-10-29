/**
 * P6: reproducible, offline simulation of the REAL 7x8 story workshop engine.
 *
 * This is an audit harness, not a game save writer, player bot or reward path.
 * It calls the actual produce/moveOrMerge/fulfillOrder/upgradeBuilding APIs.
 * Assumes the story dialogues have been read before each economic build gate.
 * Greedy policy: deliver available orders, merge matching pieces below the
 * current order-tier cap, then produce for the lowest-tier pending order.
 * Simulated clicks are instantaneous; elapsed time ONLY counts forced waits
 * for energy regeneration or producer recharge, not human play time.
 */
import {createInitialState,advanceTime,moveOrMerge,produce,fulfillOrder,
  upgradeBuilding,validateSave,ENERGY_REGEN_MS,useSupply,purchaseSupply,SUPPLY_ITEMS} from '../engine.mjs';
import {BUILDINGS,getLevel,getMaxOrderTier} from '../economy.mjs';

const START_TIME=1_000_000;
const BUILD_ORDER=Object.freeze(['garden','harbor','storefront']);
const STRATEGIES=new Set(['greedy','novice','novice-supplies']);
const PRODUCER_CHAINS=Object.freeze(['tea','bakery','floral']);
const NOVICE_MERGE_THRESHOLD=44;
const numberId=id=>Number(id.slice(1));
const usedSlots=state=>state.board.filter(Boolean).length;
const validSeed=value=>Number.isSafeInteger(value)&&value>=0&&value<=0xffffffff;

/** Return a bounded, deterministic report. Does not expose or persist a save. */
export function simulateStoryBoard({seed=1,maxActions=20_000,strategy='greedy',onMilestone=null,onConstructionReady=null}={}){
  if(!STRATEGIES.has(strategy)||!validSeed(seed)||!Number.isSafeInteger(maxActions)||
    maxActions<1||maxActions>50_000||
    (onMilestone!==null&&typeof onMilestone!=='function')||
    (onConstructionReady!==null&&typeof onConstructionReady!=='function'))
    throw new RangeError('Invalid board simulation options');

  let now=START_TIME,state=createInitialState(now),randomState=seed>>>0;
  let orders=0,productions=0,merges=0,waits=0,phase=0,actions=0;
  let offTargetProductions=0;
  let supplyPurchases=0,supplyUses=0,supplyCoinsSpent=0,cooldownCardsUsed=0;
  const purchaseAudit=[];
  let peakBoardUsed=usedSlots(state);
  let reason='action-cap';
  const milestones=[];
  const rng=()=>((randomState=(Math.imul(randomState,1664525)+1013904223)>>>0)/2**32);
  // Audit-only hook: never give observers the live engine state.
  const snapshot=id=>{
    const milestone=Object.freeze({
      id,orders,productions,merges,waits,supplyPurchases,supplyUses,
      elapsedMinutes:(now-START_TIME)/60_000,
      coins:state.coins,xp:state.xp,energy:state.energy,boardUsed:usedSlots(state)
    });
    milestones.push(milestone);
    if(onMilestone)onMilestone(milestone,structuredClone(state));
  };

  for(let step=0;step<maxActions;step++){
    actions=step+1;
    peakBoardUsed=Math.max(peakBoardUsed,usedSlots(state));
    if(!validateSave(state)){reason='invalid-state';break;}

    // Narrative prerequisites are assumed; only real engine level/coin rules
    // decide whether a construction is economically possible.
    if(phase<BUILD_ORDER.length){
      const id=BUILD_ORDER[phase],rule=BUILDINGS[id];
      if(getLevel(state.xp)>=rule.minLevel&&state.coins>=rule.coins){
        // Test-only observer receives a detached, genuinely earned PRE-build save.
        // It cannot alter the live engine or bypass a construction cost.
        if(onConstructionReady)onConstructionReady(id,structuredClone(state));
        const result=upgradeBuilding(state,id);
        if(!result.ok){reason='building-rejected';break;}
        state=result.state;phase++;snapshot(id);
        if(phase===BUILD_ORDER.length){reason='complete';break;}
        continue;
      }
    }

    // A requested item is delivered BEFORE merging, so exact order matches
    // cannot be accidentally consumed by the greedy merge strategy.
    const ready=state.orders
      .filter(o=>state.board.some(item=>item?.kind==='material'&&
        item.chain===o.chain&&item.tier===o.tier))
      .sort((a,b)=>numberId(a.id)-numberId(b.id))[0];
    if(ready){
      const result=fulfillOrder(state,ready.id);
      if(!result.ok){reason='order-rejected';break;}
      state=result.state;orders++;
      if(orders===1)snapshot('first-order');
      continue;
    }

    // Do not manufacture tier-6 clutter while level gating only allows
    // tier-2/3/4/5 orders. A full board with no legal merge is reported.
    let pair=null;
    const tierLimit=getMaxOrderTier(state.xp);
    for(let i=0;i<state.board.length&&!pair;i++){
      const item=state.board[i];
      if(item?.kind!=='material'||item.tier>=tierLimit)continue;
      const j=state.board.findIndex((other,k)=>k>i&&other?.kind==='material'&&
        other.chain===item.chain&&other.tier===item.tier);
      if(j>=0)pair=[i,j];
    }
    if(pair&&(strategy==='greedy'||usedSlots(state)>=NOVICE_MERGE_THRESHOLD)){
      const result=moveOrMerge(state,...pair);
      if(!result.ok){reason='merge-rejected';break;}
      state=result.state;merges++;
      continue;
    }

    if(usedSlots(state)===state.board.length){reason='board-full';break;}
    const target=state.orders.slice()
      .sort((a,b)=>a.tier-b.tier||numberId(a.id)-numberId(b.id))[0];
    const chain=strategy!=='greedy'
      ? PRODUCER_CHAINS[productions%PRODUCER_CHAINS.length]
      : target.chain;
    const slot=state.board.findIndex(item=>item?.kind==='producer'&&
      item.chain===chain);
    if(slot<0){reason='missing-producer';break;}

    if(state.energy===0){
      if(strategy==='novice-supplies'){
        // Consume earned finite supplies first; the real engine enforces bag
        // counts and revisions. Never fast-forward Date.now() in the harness.
        const id=state.bag.meal>0?'meal':state.bag.soda>0?'soda':null;
        if(id){
          const used=useSupply(state,id,null,now);
          if(!used.ok){reason='energy-supply-rejected';break;}
          state=used.state;supplyUses++;
          continue;
        }
        // A novice may buy finite soda only with coins ABOVE the entire
        // next construction cost. Never silently consume building reserves.
        const price=SUPPLY_ITEMS.soda.price;
        const building=BUILD_ORDER[phase],reserve=BUILDINGS[building].coins;
        if(state.shop.purchases.soda<SUPPLY_ITEMS.soda.limit&&
          state.coins>=reserve+price){
          const before=state.coins;
          const bought=purchaseSupply(state,'soda');
          if(!bought.ok){reason='supply-purchase-rejected';break;}
          state=bought.state;supplyPurchases++;supplyCoinsSpent+=price;
          purchaseAudit.push(Object.freeze({building,coinsBefore:before,price,reserve}));
          continue;
        }
      }
      now=Math.max(now+1,state.energyAt+ENERGY_REGEN_MS);
      state=advanceTime(state,now);waits++;
      continue;
    }
    if(state.board[slot].charges===0){
      if(strategy==='novice-supplies'&&state.board[slot].cooldownUntil>now){
        const id=state.bag.reset>0?'reset':state.bag.speed>0?'speed':null;
        if(id){
          const used=useSupply(state,id,state.board[slot].id,now);
          if(!used.ok){reason='cooldown-supply-rejected';break;}
          state=used.state;supplyUses++;cooldownCardsUsed++;
          continue;
        }
      }
      now=Math.max(now+1,state.board[slot].cooldownUntil);
      state=advanceTime(state,now);waits++;
      continue;
    }
    const result=produce(state,slot,now,rng);
    if(!result.ok){reason='production-rejected';break;}
    state=result.state;productions++;
    if(chain!==target.chain)offTargetProductions++;
  }

  return Object.freeze({
    seed,strategy,complete:reason==='complete',reason,actions,orders,productions,
    offTargetProductions,merges,waits,supplyPurchases,supplyUses,supplyCoinsSpent,
    cooldownCardsUsed,purchaseAudit:Object.freeze(purchaseAudit),elapsedMinutes:(now-START_TIME)/60_000,
    coins:state.coins,xp:state.xp,energy:state.energy,
    boardUsed:usedSlots(state),peakBoardUsed:Math.max(peakBoardUsed,usedSlots(state)),
    buildings:Object.freeze({...state.buildings}),
    milestones:Object.freeze(milestones),
    limitations:'真实引擎与7×8棋盘、种子随机掉落及冷却；补给策略仅使用一次性奖励和不动用下一处建设储备的限量汽水，忽略真实玩家点击耗时、故事阅读、仓库、其他金币消费、触控及存档冲突。模拟耗时绝非真实通关时间。'
  });
}
