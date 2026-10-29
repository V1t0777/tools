import {XP_THRESHOLDS,getLevel} from '../economy.mjs';

// Read-only feedback; upgradeBuilding remains the sole authority for costs.
export function describeStoryConstructionResources(state,rule){
  const targetXp=XP_THRESHOLDS[rule?.minLevel-1];
  if(!Number.isSafeInteger(targetXp)||!Number.isSafeInteger(rule?.coins)||
    rule.coins<0||!Number.isSafeInteger(state?.xp)||state.xp<0||
    !Number.isSafeInteger(state?.coins)||state.coins<0){
    return '无法核对建设资源，请重新打开剧情工作台。';
  }
  const missingXp=Math.max(0,targetXp-state.xp);
  const missingCoins=Math.max(0,rule.coins-state.coins);
  const summary='需要 '+rule.minLevel+' 级和 '+rule.coins+' 金币；当前 '+
    getLevel(state.xp)+' 级、'+state.coins+' 金币。';
  if(!missingXp&&!missingCoins)return summary+'等级与金币均已达标，可以修建。';
  return summary+
    (missingXp?'距离等级要求还差 '+missingXp+' 经验。':'等级已达标。')+
    (missingCoins?'距离金币要求还差 '+missingCoins+' 金币。':'金币已达标。');
}
