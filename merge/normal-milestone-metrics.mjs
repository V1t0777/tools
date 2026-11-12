/** Read only existing V3 fields; no additional progress counters. */
import {BUILDINGS,MAX_PRODUCER_LEVEL} from './economy.mjs';
export function milestoneMetric(state,metric){
  switch(metric){
    case 'orders':return state.progress.orders;
    case 'merges':return state.progress.merges;
    case 'buildings':return Object.keys(BUILDINGS).reduce(
      (n,id)=>n+Number(state.buildings[id]===1),0);
    case 'warehouse':return state.warehouse.capacity;
    case 'masterWorkshops':return state.board.reduce(
      (n,item)=>n+Number(item?.kind==='producer'&&item.level===MAX_PRODUCER_LEVEL),0);
    default:throw new RangeError('Unknown milestone metric');
  }
}
