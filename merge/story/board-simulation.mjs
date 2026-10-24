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
  upgradeBuilding,validateSave,ENERGY_REGEN_MS} from '../engine.mjs';
import {BUILDINGS,getLevel,getMaxOrderTier} from '../economy.mjs';

const START_TIME=1_000_000;
const BUILD_ORDER=Object.freeze(['garden','harbor','storefront']);
const numberId=id=>Number(id.slice(1));
const usedSlots=state=>state.board.filter(Boolean).length;
const validSeed=value=>Number.isSafeInteger(value)&&value>=0&&value<=0xffffffff;

/** Return a bounded, deterministic report. Does not expose or persist a save. */
export function simulateStoryBoard({seed=1,maxActions=20_000}={}){
  if(!validSeed(seed)||!Number.isSafeInteger(maxActions)||
    maxActions<1||maxActions>50_000)
    throw new RangeError('Invalid board simulation options');

  let now=START_TIME,state=createInitialState(now),randomState=seed>>>0;
  let orders=0,productions=0,merges=0,waits=0,phase=0,actions=0;
  let peakBoardUsed=usedSlots(state);
  let reason='action-cap';
  const milestones=[];
  const rng=()=>((randomState=(Math.imul(randomState,1664525)+1013904223)>>>0)/2**32);
  const snapshot=id=>milestones.push(Object.freeze({
    id,orders,productions,merges,waits,
    elapsedMinutes:(now-START_TIME)/60_000,
    coins:state.coins,xp:state.xp,energy:state.energy,boardUsed:usedSlots(state)
  }));

  for(let step=0;step<maxActions;step++){
    actions=step+1;
    peakBoardUsed=Math.max(peakBoardUsed,usedSlots(state));
    if(!validateSave(state)){reason='invalid-state';break;}

    // Narrative prerequisites are assumed; only real engine level/coin rules
    // decide whether a construction is economically possible.
    if(phase<BUILD_ORDER.length){
      const id=BUILD_ORDER[phase],rule=BUILDINGS[id];
      if(getLevel(state.xp)>=rule.minLevel&&state.coins>=rule.coins){
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
    if(pair){
      const result=moveOrMerge(state,...pair);
      if(!result.ok){reason='merge-rejected';break;}
      state=result.state;merges++;
      continue;
    }

    if(usedSlots(state)===state.board.length){reason='board-full';break;}
    const target=state.orders.slice()
      .sort((a,b)=>a.tier-b.tier||numberId(a.id)-numberId(b.id))[0];
    const slot=state.board.findIndex(item=>item?.kind==='producer'&&
      item.chain===target.chain);
    if(slot<0){reason='missing-producer';break;}

    if(state.energy===0){
      now=Math.max(now+1,state.energyAt+ENERGY_REGEN_MS);
      state=advanceTime(state,now);waits++;
      continue;
    }
    if(state.board[slot].charges===0){
      now=Math.max(now+1,state.board[slot].cooldownUntil);
      state=advanceTime(state,now);waits++;
      continue;
    }
    const result=produce(state,slot,now,rng);
    if(!result.ok){reason='production-rejected';break;}
    state=result.state;productions++;
  }

  return Object.freeze({
    seed,complete:reason==='complete',reason,actions,orders,productions,
    merges,waits,elapsedMinutes:(now-START_TIME)/60_000,
    coins:state.coins,xp:state.xp,energy:state.energy,
    boardUsed:usedSlots(state),peakBoardUsed:Math.max(peakBoardUsed,usedSlots(state)),
    buildings:Object.freeze({...state.buildings}),
    milestones:Object.freeze(milestones),
    limitations:'真实引擎与7×8棋盘、种子随机掉落及冷却；单一贪心策略，忽略玩家点击耗时、故事阅读、仓库、升级、补给、付费和存档冲突。模拟耗时绝非真实通关时间。'
  });
}
