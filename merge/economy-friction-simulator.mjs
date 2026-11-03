/** P3.4: deterministic, non-ideal player heuristics for offline research only.
 * All economic mutations use real P2 engine transitions. Not player telemetry.
 */
import { createInitialState, advanceTime, moveOrMerge, produce, fulfillOrder,
  storeItem, withdrawItem, upgradeWarehouse, upgradeProducer, upgradeBuilding,
  getLevelProgress, validateSave, CELL_COUNT, MAX_ENERGY, ENERGY_REGEN_MS } from './engine.mjs';
import { BUILDINGS, getWarehouseUpgrade, getProducerUpgrade } from './economy.mjs';
import { diagnoseBoard } from './board-diagnostics.mjs';

const DAY = 86_400_000, MINUTE = 60_000, ACTION_MS = 4_000;
const PROFILES = Object.freeze({
  organized: Object.freeze({merge:0.85, deliver:0.95, store:0.85, upgrade:0.85, mistake:0.01, keep:0}),
  casual: Object.freeze({merge:0.24, deliver:0.55, store:0.35, upgrade:0.55, mistake:0.04, keep:0.08}),
  cluttered: Object.freeze({merge:0.06, deliver:0.35, store:0.10, upgrade:0.25, mistake:0.08, keep:0.18})
});
const POLICIES = new Set(['balanced','expand-first','save-coins','warehouse-only']);
const integer = (value,min,max,name) => {
  if (!Number.isSafeInteger(value) || value<min || value>max) throw Error(`Invalid ${name}`);
};
const seeded = seed => {
  let s=seed>>>0;
  return () => ((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);
};
const occupied = state => state.board.reduce((n,item)=>n+Number(item!==null),0);
const warehouseUsed = state => state.warehouse.slots.slice(0,state.warehouse.capacity).filter(Boolean).length;
const hasOrder = (state,item) => state.orders.some(o=>o.chain===item.chain && o.tier===item.tier);
const deliverable = state => state.orders.find(o=>state.board.some(item=>item?.kind==='material' && item.chain===o.chain && item.tier===o.tier));
const warehouseOrder = state => state.warehouse.slots.findIndex((item,i)=>i<state.warehouse.capacity && item?.kind==='material' && hasOrder(state,item));
function mergePair(state) {
  const seen=new Map();
  for(let i=0;i<state.board.length;i++) {
    const item=state.board[i];
    if(item?.kind!=='material'||item.tier>=6) continue;
    const key=`${item.chain}:${item.tier}`;
    if(seen.has(key)) return [seen.get(key),i];
    seen.set(key,i);
  }
  return null;
}
function producerSlot(state) {
  return state.board.findIndex(item=>item?.kind==='producer' && item.charges>0 && state.orders.some(o=>o.chain===item.chain));
}
function upgrade(state,policy) {
  if(policy==='save-coins') return null;
  const level=getLevelProgress(state.xp).level, choices=[];
  const w=getWarehouseUpgrade(state.warehouse.capacity);
  if(w&&level>=w.minLevel&&state.coins>=w.coins) choices.push({kind:'warehouse',apply:()=>upgradeWarehouse(state)});
  if(policy!=='warehouse-only') for(const item of state.board) if(item?.kind==='producer') {
    const rule=getProducerUpgrade(item.level);
    if(rule&&level>=rule.minLevel&&state.coins>=rule.coins)
      choices.push({kind:'producer',apply:()=>upgradeProducer(state,item.id)});
  }
  if(policy!=='warehouse-only') for(const [id,rule] of Object.entries(BUILDINGS))
    if(!state.buildings[id]&&level>=rule.minLevel&&state.coins>=rule.coins)
      choices.push({kind:id,apply:()=>upgradeBuilding(state,id)});
  const priority=policy==='expand-first' ? ['warehouse','producer','storefront','garden','harbor']
    : ['producer','storefront','warehouse','garden','harbor'];
  choices.sort((a,b)=>priority.indexOf(a.kind)-priority.indexOf(b.kind));
  return choices[0]??null;
}
/** A bounded, intentionally simplified model of missed merges, manual warehouse
 * use, optional collecting, and mistaken swaps. It is not a retention forecast.
 */
export function simulateFriction({seed=1,days=30,sessionsPerDay=2,sessionMinutes=12,
  behavior='casual',policy='balanced'}={}) {
  integer(seed,0,0xffffffff,'seed');integer(days,1,90,'days');
  integer(sessionsPerDay,1,8,'sessionsPerDay');integer(sessionMinutes,1,60,'sessionMinutes');
  if(!Object.hasOwn(PROFILES,behavior)||!POLICIES.has(policy)||sessionsPerDay*sessionMinutes>480)
    throw Error('Invalid behavior, policy or play schedule');
  const profile=PROFILES[behavior], random=seeded(seed), start=1_000_000;
  let state=createInitialState(start);
  const totals={produced:0,merged:0,orders:0,earned:0,spent:0,upgrades:0,
    stored:0,withdrawn:0,mistakes:0,actions:0,energySpent:0,
    fullBoardSessions:0,warehouseFullSessions:0,blockedSessions:0,hardDeadlockSessions:0,
    behaviorBlockedSessions:0,recoverableFullSessions:0,
    highPressureSessions:0,orderInWarehouseSessions:0,maxOccupied:occupied(state),
    maxWarehouseUsed:warehouseUsed(state)};
  const daily=[];
  for(let day=0;day<days;day++) {
    const beforeDay={...totals};
    for(let session=0;session<sessionsPerDay;session++) {
      let now=start+day*DAY+Math.floor((session+1)*DAY/(sessionsPerDay+1));
      const end=now+sessionMinutes*MINUTE;
      let blocked=false, warehouseFull=false, full=false, high=false, hidden=false;
      state=advanceTime(state,now);
      while(now<end) {
        state=advanceTime(state,now);
        const fill=occupied(state), used=warehouseUsed(state);
        high ||= fill>=Math.ceil(CELL_COUNT*0.8);
        full ||= fill===CELL_COUNT;
        warehouseFull ||= used===state.warehouse.capacity;
        hidden ||= warehouseOrder(state)>=0;
        let result=null,kind='';
        const order=deliverable(state), pair=mergePair(state), hiddenSlot=warehouseOrder(state);
        const chance=random();
        // A fraction of items is deliberately retained; these are never deleted
        // or fabricated, but can crowd the board and reduce merge frequency.
        if(order&&chance<profile.deliver) {result=fulfillOrder(state,order.id);kind='order';}
        else if(pair&&chance<profile.merge) {result=moveOrMerge(state,...pair);kind='merge';}
        else if(hiddenSlot>=0&&fill<CELL_COUNT&&chance<profile.store) {
          result=withdrawItem(state,hiddenSlot);kind='withdraw';
        }
        else if(fill>=Math.floor(CELL_COUNT*0.7)&&used<state.warehouse.capacity&&chance<profile.store) {
          const slot=state.board.findIndex(item=>item?.kind==='material' && !hasOrder(state,item) && random()>=profile.keep);
          if(slot>=0) {result=storeItem(state,slot);kind='store';}
        }
        if(!result&&chance<profile.upgrade) {
          const candidate=upgrade(state,policy);
          if(candidate) {result=candidate.apply();kind='upgrade';}
        }
        if(!result&&chance<profile.mistake) {
          const src=state.board.findIndex(item=>item?.kind==='material');
          const dst=state.board.findIndex((item,i)=>i!==src&&item?.kind==='material' && (item.chain!==state.board[src]?.chain||item.tier!==state.board[src]?.tier));
          if(src>=0&&dst>=0) {result=moveOrMerge(state,src,dst);kind='mistake';}
        }
        if(!result&&fill<CELL_COUNT&&state.energy>0) {
          const slot=producerSlot(state);
          if(slot>=0) {result=produce(state,slot,now,random);kind='produce';}
        }
        if(!result&&fill===CELL_COUNT) {
          // The model does not silently discard items to escape a full board.
          if(pair&&random()<profile.merge) {result=moveOrMerge(state,...pair);kind='merge';}
          else if(order&&random()<profile.deliver) {result=fulfillOrder(state,order.id);kind='order';}
          else if(used<state.warehouse.capacity) {
            const slot=state.board.findIndex(item=>item?.kind==='material');
            if(slot>=0&&random()<profile.store) {result=storeItem(state,slot);kind='store';}
          }
          if(!result) {
            blocked=true;
            break;
          }
        }
        if(!result) {
          const energyTick=state.energy<MAX_ENERGY?state.energyAt+ENERGY_REGEN_MS:Infinity;
          const recharge=Math.min(Infinity,...state.board.filter(item=>item?.kind==='producer'&&item.charges===0).map(item=>item.cooldownUntil));
          const next=Math.min(energyTick,recharge,end);
          if(next>now&&next<end&&Number.isFinite(next)) {now=next;continue;}
          break;
        }
        if(!result.ok) throw Error(`Illegal simulated ${kind} at day ${day+1}: ${result.message}`);
        const previous=state;state=result.state;
        totals.actions++;
        if(kind==='produce') {totals.produced++;totals.energySpent+=previous.energy-state.energy;}
        if(kind==='merge') totals.merged++;
        if(kind==='order') {totals.orders++;totals.earned+=state.coins-previous.coins;}
        if(kind==='upgrade') {totals.upgrades++;totals.spent+=previous.coins-state.coins;}
        if(kind==='store') totals.stored++;
        if(kind==='withdraw') totals.withdrawn++;
        if(kind==='mistake') totals.mistakes++;
        totals.maxOccupied=Math.max(totals.maxOccupied,occupied(state));
        totals.maxWarehouseUsed=Math.max(totals.maxWarehouseUsed,warehouseUsed(state));
        now+=ACTION_MS;
      }
      // A player's failed choice is not a rules-level deadlock. Recheck the
      // actual post-session engine state, including affordable warehouse upgrades.
      const diagnosis=diagnoseBoard(state);
      const rulesDeadlocked=diagnosis.recovery==='hard-deadlock';
      totals.behaviorBlockedSessions+=Number(blocked&&!rulesDeadlocked);
      totals.recoverableFullSessions+=Number(diagnosis.recovery==='recoverable');
      totals.fullBoardSessions+=Number(full);
      totals.warehouseFullSessions+=Number(warehouseFull);
      totals.blockedSessions+=Number(blocked);
      totals.hardDeadlockSessions+=Number(rulesDeadlocked);
      totals.highPressureSessions+=Number(high);
      totals.orderInWarehouseSessions+=Number(hidden);
    }
    if(!validateSave(state)) throw Error(`Invalid save after day ${day+1}`);
    if(state.coins!==totals.earned-totals.spent) throw Error('Currency conservation failed');
    daily.push({day:day+1,level:getLevelProgress(state.xp).level,coins:state.coins,
      orders:totals.orders-beforeDay.orders,blockedSessions:totals.blockedSessions-beforeDay.blockedSessions,
      highPressureSessions:totals.highPressureSessions-beforeDay.highPressureSessions,
      hardDeadlockSessions:totals.hardDeadlockSessions-beforeDay.hardDeadlockSessions,
      behaviorBlockedSessions:totals.behaviorBlockedSessions-beforeDay.behaviorBlockedSessions,
      recoverableFullSessions:totals.recoverableFullSessions-beforeDay.recoverableFullSessions,
      occupied:occupied(state),warehouseUsed:warehouseUsed(state)});
  }
  return {scenario:{seed,days,sessionsPerDay,sessionMinutes,behavior,policy},totals,daily,
    final:{coins:state.coins,xp:state.xp,level:getLevelProgress(state.xp).level,
      boardOccupied:occupied(state),warehouseUsed:warehouseUsed(state),
      warehouseCapacity:state.warehouse.capacity,energy:state.energy,
      recovery:diagnoseBoard(state).recovery}};
}