/**
 * P2.9 deterministic offline supply economy stress test (NOT player telemetry).
 * Each simulated transition calls the real engine. No network / time globals.
 */
import {createInitialState,advanceTime,moveOrMerge,produce,fulfillOrder,
  purchaseSupply,useSupply,validateSave,SUPPLY_ITEMS,ACHIEVEMENT_RULES,
  MAX_ENERGY,CELL_COUNT} from './engine.mjs';
import {getLevel} from './economy.mjs';

const DAY=86_400_000;
function random(seed){
  let v=seed>>>0;
  return ()=>((v=(Math.imul(v,1664525)+1013904223)>>>0)/2**32);
}
function countEarned(state,id){
  return ACHIEVEMENT_RULES.reduce((n,r)=>n+(r.reward===id?state.achievements[r.id]:0),0);
}
function findOrder(state){
  return state.orders.find(o=>state.board.some(p=>p?.kind==='material'&&p.chain===o.chain&&p.tier===o.tier));
}
function findMerge(state){
  const positions=new Map();
  for(let i=0;i<state.board.length;i++){
    const p=state.board[i];
    if(p?.kind!=='material'||p.tier>=6)continue;
    const k=`${p.chain}:${p.tier}`;
    if(positions.has(k))return [positions.get(k),i];
    positions.set(k,i);
  }
  return null;
}
function pickProducer(state){
  for(const order of state.orders){
    const slot=state.board.findIndex(p=>p?.kind==='producer'&&p.chain===order.chain&&p.charges>0);
    if(slot>=0)return slot;
  }
  return state.board.findIndex(p=>p?.kind==='producer'&&p.charges>0);
}
function activeCooldown(state,now){
  return state.board.find(p=>p?.kind==='producer'&&p.charges===0&&p.cooldownUntil>now);
}
function checkConservation(state,consumed,earned,spent){
  if(!validateSave(state)||state.coins!==earned-spent)throw Error('Supply economy conservation failed');
  for(const [id,def] of Object.entries(SUPPLY_ITEMS)){
    if(state.shop.purchases[id]>def.limit||
      state.bag[id]+consumed[id]!==state.shop.purchases[id]+countEarned(state,id))
      throw Error('Supply inventory created or spent without a legal transition');
  }
}
/** A reproducible finite-action scenario with exact item and currency conservation.
 * Local lifetime purchase limits intentionally do NOT renew with the device clock.
 */
export function simulateSupplyEconomy({seed=1,days=30,sessionsPerDay=3,actionsPerSession=120}={}){
  if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff||
    !Number.isInteger(days)||days<1||days>90||
    !Number.isInteger(sessionsPerDay)||sessionsPerDay<1||sessionsPerDay>6||
    !Number.isInteger(actionsPerSession)||actionsPerSession<1||actionsPerSession>300)
    throw Error('Invalid supply simulation parameters');
  const rng=random(seed),start=1_000_000;
  let s=createInitialState(start),earned=0,spent=0;
  const consumed={soda:0,meal:0,speed:0,reset:0};
  const totals={actions:0,produced:0,merges:0,orders:0,purchases:0,used:0,
    earned:0,spent:0,blocked:0};
  const daily=[];
  for(let day=0;day<days;day++){
    for(let session=0;session<sessionsPerDay;session++){
      let now=start+day*DAY+Math.floor((session+1)*DAY/(sessionsPerDay+1));
      s=advanceTime(s,now);
      // At most one attempt to buy each shop item per day. This allows every
      // tested day to exercise sold-out limits without a clock reset loophole.
      if(session===0)for(const id of Object.keys(SUPPLY_ITEMS)){
        if(s.coins>=SUPPLY_ITEMS[id].price){
          const before=s;
          const r=purchaseSupply(s,id);
          if(r.ok){
            s=r.state;spent+=before.coins-s.coins;
            totals.purchases++;totals.actions++;
          }
        }
      }
      for(let action=0;action<actionsPerSession;action++){
        let r=null,kind='';
        const order=findOrder(s),pair=findMerge(s);
        if(order){r=fulfillOrder(s,order.id);kind='order';}
        else if(pair){r=moveOrMerge(s,...pair);kind='merge';}
        else if(s.energy<MAX_ENERGY-25&&s.bag.soda>0){
          r=useSupply(s,'soda',null,now);kind='soda';
        }else if(s.energy<MAX_ENERGY-60&&s.bag.meal>0){
          r=useSupply(s,'meal',null,now);kind='meal';
        }else{
          const cooling=activeCooldown(s,now);
          if(cooling&&s.bag.speed>0){
            r=useSupply(s,'speed',cooling.id,now);kind='speed';
          }else if(cooling&&s.bag.reset>0){
            r=useSupply(s,'reset',cooling.id,now);kind='reset';
          }else{
            const slot=pickProducer(s);
            if(slot<0||s.energy===0||s.board.every(Boolean)){
              totals.blocked++;break;
            }
            r=produce(s,slot,now,rng);kind='produce';
          }
        }
        if(!r?.ok)throw Error(`Simulator selected invalid supply action: ${kind}`);
        const before=s;s=r.state;
        totals.actions++;
        if(kind==='order'){totals.orders++;earned+=s.coins-before.coins;}
        if(kind==='merge')totals.merges++;
        if(kind==='produce')totals.produced++;
        if(Object.hasOwn(consumed,kind)){consumed[kind]++;totals.used++;}
        if(s.revision!==before.revision+1)throw Error('Unexpected revision step');
        now+=10_000;
      }
      checkConservation(s,consumed,earned,spent);
    }
    daily.push({day:day+1,coins:s.coins,xp:s.xp,level:getLevel(s.xp),
      energy:s.energy,orders:totals.orders,merges:totals.merges,
      purchases:totals.purchases,consumed:totals.used});
  }
  totals.earned=earned;totals.spent=spent;
  checkConservation(s,consumed,earned,spent);
  return {scenario:{seed,days,sessionsPerDay,actionsPerSession},totals,daily,
    final:{coins:s.coins,xp:s.xp,level:getLevel(s.xp),energy:s.energy,bag:{...s.bag},
      purchases:{...s.shop.purchases},achievements:{...s.achievements},
      consumed:{...consumed},revision:s.revision}};
}
