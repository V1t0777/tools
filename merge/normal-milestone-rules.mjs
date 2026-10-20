/** P2.13 normal-mode display targets; no rewards or XP changes. */
import {BUILDINGS,WAREHOUSE_SLOTS} from './economy.mjs';
import {CHAINS} from './engine.mjs';
const rule=(id,metric,target)=>Object.freeze({id,metric,target});
export const NORMAL_MILESTONE_RULES=Object.freeze([
  rule('orders-50','orders',50),
  rule('orders-200','orders',200),
  rule('orders-800','orders',800),
  rule('merges-150','merges',150),
  rule('merges-600','merges',600),
  rule('merges-2400','merges',2400),
  rule('buildings-all','buildings',Object.keys(BUILDINGS).length),
  rule('warehouse-full','warehouse',WAREHOUSE_SLOTS),
  rule('workshops-mastered','masterWorkshops',Object.keys(CHAINS).length)
]);
