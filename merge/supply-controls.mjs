/** P2.10 — read-only UI eligibility for offline consumables.
 * This module neither spends items nor changes the canonical game state.
 * The engine is still the sole authority for all actual use attempts.
 */
import {CHAINS,MAX_ENERGY} from './engine.mjs';
import {SUPPLY_ITEMS} from './supplies.mjs';

export function getSupplyControlSnapshot(state, requestedProducerId, now=Date.now()){
  if(!Number.isFinite(now)||now<0)throw Error('Invalid supply UI time');
  const producers=state.board.filter(item=>item?.kind==='producer');
  const chosen=producers.find(p=>p.id===requestedProducerId)??producers[0]??null;
  const targetCooling=chosen?.charges===0 && chosen.cooldownUntil>now;
  const remainingSeconds=targetCooling
    ? Math.max(1,Math.ceil((chosen.cooldownUntil-now)/1000)) : 0;
  const options=producers.map(p=>Object.freeze({
    id:p.id,
    label:`${CHAINS[p.chain].name}工坊 · ${p.charges===0 && p.cooldownUntil>now?'冷却中':'可生产'}`
  }));
  const usable=Object.fromEntries(Object.entries(SUPPLY_ITEMS).map(([id,def])=>
    [id,state.bag[id]>0 && (def.energy?state.energy<MAX_ENERGY:!!targetCooling)]));
  return Object.freeze({
    producerId:chosen?.id??null,
    producerName:chosen?CHAINS[chosen.chain].name+'工坊':null,
    options:Object.freeze(options),
    cooling:!!targetCooling,
    remainingSeconds,
    usable:Object.freeze(usable)
  });
}
