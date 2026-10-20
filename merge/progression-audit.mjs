/** P2.11 read-only economy pacing comparison. No gameplay mutations or cloud I/O.
 * Three models differ in player efficiency and action cadence and MUST NOT be
 * interpreted as an observational estimate of actual player behavior.
 */
import {XP_THRESHOLDS} from './economy.mjs';
import {MAX_ENERGY} from './engine.mjs';
import {simulateEconomy} from './economy-simulator.mjs';
import {simulateFriction} from './economy-friction-simulator.mjs';
import {simulateSupplyEconomy} from './supply-economy-simulator.mjs';

const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const maxLevel=XP_THRESHOLDS.length;
const firstCapDay=daily=>daily.find(row=>row.level===maxLevel)?.day??null;
const firstDay=daily=>daily[0];

/** Scenarios explicitly list their separate heuristic assumptions.
 * There are no hidden multiplier settings or post-hoc reward adjustments.
 */
export function auditProgression({
  seed=42,days=30,sessionsPerDay=2,sessionMinutes=12,behavior='casual'
}={}){
  if(!integer(seed,0,0xffffffff)||!integer(days,1,90)||
    !integer(sessionsPerDay,1,6)||!integer(sessionMinutes,1,50)||
    !['organized','casual','cluttered'].includes(behavior)||
    sessionsPerDay*sessionMinutes>300)
    throw Error('Invalid progression audit inputs');
  // The supply simulator advances a virtual clock by 10s per action.
  const supplyActionsPerSession=Math.min(300,sessionMinutes*6);
  const ideal=simulateEconomy({seed,days,sessionsPerDay,sessionMinutes,policy:'balanced'});
  const friction=simulateFriction({seed,days,sessionsPerDay,sessionMinutes,behavior,policy:'balanced'});
  const supplies=simulateSupplyEconomy({seed,days,sessionsPerDay,
    actionsPerSession:supplyActionsPerSession});
  const describe=(result,{kind,notes})=>{
    const dayOne=firstDay(result.daily);
    return {
      kind,notes,capReachedDay:firstCapDay(result.daily),
      dayOneLevel:dayOne.level,
      dayOneOrders:dayOne.orders,
      finalLevel:result.final.level,
      finalXp:result.final.xp,
      finalCoins:result.final.coins,
      completedOrders:result.totals.orders,
      produced:result.totals.produced,
      earnedCoins:result.totals.earned,
      spentCoins:result.totals.spent
    };
  };
  const scenarios={
    ideal:describe(ideal,{kind:'ideal',
      notes:'优先交付与合成，尽量购买建筑/生产器升级；无玩家失误或补给消费'}),
    friction:describe(friction,{kind:'friction',
      notes:`非理想模拟：${behavior} 操作习惯、漏合成、仓库拥堵；不使用补给`}),
    supply:describe(supplies,{kind:'supply',
      notes:'每动作 10 秒、按存档永久限购自动购买并使用补给；无其他升级投资'})
  };
  const cautions=[];
  if(scenarios.ideal.capReachedDay===1)cautions.push('IDEAL_CAP_DAY_ONE');
  if(scenarios.friction.capReachedDay===1)cautions.push('FRICTION_CAP_DAY_ONE');
  if(scenarios.supply.capReachedDay===1)cautions.push('SUPPLY_CAP_DAY_ONE');
  if(scenarios.ideal.capReachedDay!==null&&scenarios.friction.capReachedDay===null)
    cautions.push('PROFILE_SENSITIVITY');
  const supplyBalance={
    purchased:sum(supplies.final.purchases),
    consumed:sum(supplies.final.consumed),
    remaining:sum(supplies.final.bag),
    shopCoinsSpent:supplies.totals.spent,
    achievementsClaimed:sum(supplies.final.achievements)
  };
  // The same seed does not mean policies model the same actions: never use
  // cross-scenario coin or XP differences as a controlled causal estimate.
  return {
    assumptions:{
      seed,days,sessionsPerDay,sessionMinutes,behavior,
      supplyActionsPerSession,energyCap:MAX_ENERGY,
      maximumLevel:maxLevel,maximumLevelXp:XP_THRESHOLDS.at(-1),
      saveCompatibility:'NO_RULE_CHANGES'
    },
    scenarios,
    supplyBalance,
    cautions,
    conclusion:'模型仅能提示潜在节奏风险；不得据此直接修改存档等级、金币或实际玩家奖励'
  };
}
function sum(record){return Object.values(record).reduce((acc,value)=>acc+value,0);}
