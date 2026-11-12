/** Read-only first-volume construction reserve guidance, not an economy gate. */
import {BUILDINGS} from '../economy.mjs';
const ORDER=Object.freeze(['garden','harbor','storefront']);
export function nextStoryConstructionBudget(state){
  if(!state||!Number.isSafeInteger(state.coins)||state.coins<0||
    !state.buildings||ORDER.some(id=>![0,1].includes(state.buildings[id])))
    return Object.freeze({ok:false,reason:'INVALID_STATE'});
  const id=ORDER.find(name=>state.buildings[name]===0);
  if(!id)return Object.freeze({ok:true,complete:true,
    description:'首卷三处建设已完成；补给购买仍受限量库存约束。'});
  const rule=BUILDINGS[id],shortfall=Math.max(0,rule.coins-state.coins);
  return Object.freeze({ok:true,complete:false,id,cost:rule.coins,
    coins:state.coins,shortfall,
    description:shortfall>0
      ? '下一处规划建设「'+rule.name+'」需 ◈'+rule.coins+'，目前 ◈'+
        state.coins+'，还差 ◈'+shortfall+
        '；购买补给会增加需要积累的金币。仍需满足等级和剧情条件。'
      : '下一处规划建设「'+rule.name+'」需 ◈'+rule.coins+'，目前 ◈'+
        state.coins+'；购买补给可能使建设金币不足。仍需满足等级和剧情条件。'});
}
export function wouldSpendStoryConstructionReserve(budget,price){
  return budget?.ok===true&&!budget.complete&&
    Number.isSafeInteger(price)&&price>0&&
    budget.coins>=budget.cost&&budget.coins-price<budget.cost;
}
