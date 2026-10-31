/** Pure P2.13 normal-mode projection: never persists or grants. */
import {validateSave} from './engine.mjs';
import {NORMAL_MILESTONE_RULES} from './normal-milestone-rules.mjs';
import {milestoneMetric} from './normal-milestone-metrics.mjs';
export function deriveNormalMilestones(state){
  if(!validateSave(state)||
    (Object.hasOwn(state,'mode')&&state.mode!=='normal')||
    Object.hasOwn(state,'packs'))
    throw new TypeError('Expected V3 normal-mode save');
  const milestones=NORMAL_MILESTONE_RULES.map(rule=>{
    const current=milestoneMetric(state,rule.metric);
    const progress=Math.min(current,rule.target);
    return Object.freeze({...rule,current,progress,remaining:rule.target-progress,
      percent:Math.floor(progress*100/rule.target),complete:current>=rule.target});
  });
  return Object.freeze({mode:'normal',projectionVersion:1,sourceRevision:state.revision,
    rewardPolicy:'NONE',completedCount:milestones.filter(x=>x.complete).length,
    totalCount:milestones.length,milestones:Object.freeze(milestones)});
}
