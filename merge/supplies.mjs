/** P2.9 — offline-only supply economy. No accounts, cloud writes, clocks or cheat switches. */
export const SUPPLY_ITEMS=Object.freeze({
  soda:Object.freeze({name:'海风汽水',icon:'🧃',effect:'恢复25体力',energy:25,price:90,limit:4}),
  meal:Object.freeze({name:'海岛便当',icon:'🍱',effect:'恢复60体力',energy:60,price:210,limit:1}),
  speed:Object.freeze({name:'工坊加速卡',icon:'⏳',effect:'指定工坊剩余冷却减半',price:120,limit:3}),
  reset:Object.freeze({name:'星辉重启卡',icon:'✨',effect:'立即结束指定工坊冷却',price:260,limit:1})
});
export const ACHIEVEMENT_RULES=Object.freeze([
  Object.freeze({id:'orders3',counter:'orders',threshold:3,reward:'soda',title:'初识街坊'}),
  Object.freeze({id:'orders6',counter:'orders',threshold:6,reward:'speed',title:'熟客来了'}),
  Object.freeze({id:'merges30',counter:'merges',threshold:30,reward:'meal',title:'巧手匠人'}),
  Object.freeze({id:'orders20',counter:'orders',threshold:20,reward:'reset',title:'百物铺能手'})
]);
const itemKeys=Object.keys(SUPPLY_ITEMS);
const achievementKeys=ACHIEVEMENT_RULES.map(x=>x.id);
const counters=['merges','orders'];
const exactKeys=(x,keys)=>x && typeof x==='object' && !Array.isArray(x) &&
  Object.keys(x).length===keys.length && keys.every(k=>Object.hasOwn(x,k));
const counter=n=>Number.isSafeInteger(n)&&n>=0;

export function createSupplyFields(){
  return {
    bag:Object.fromEntries(itemKeys.map(x=>[x,0])),
    progress:{merges:0,orders:0},
    achievements:Object.fromEntries(achievementKeys.map(x=>[x,0])),
    shop:{purchases:Object.fromEntries(itemKeys.map(x=>[x,0]))}
  };
}

/** These fields are only locally trusted for gameplay, never for cloud grants. */
export function validateSupplyFields(s){
  if(!s||!exactKeys(s.bag,itemKeys)||!exactKeys(s.progress,counters)||
    !exactKeys(s.achievements,achievementKeys)||!s.shop||
    !exactKeys(s.shop.purchases,itemKeys))return false;
  for(const k of counters)if(!counter(s.progress[k]))return false;
  for(const k of itemKeys) {
    const purchased=s.shop.purchases[k];
    if(!counter(purchased)||purchased>SUPPLY_ITEMS[k].limit||!counter(s.bag[k]))return false;
    const awarded=ACHIEVEMENT_RULES.reduce((n,r)=>n+(r.reward===k?s.achievements[r.id]:0),0);
    if(s.bag[k]>purchased+awarded)return false;
  }
  return ACHIEVEMENT_RULES.every(r=>[0,1].includes(s.achievements[r.id]) &&
    s.achievements[r.id]===Number(s.progress[r.counter]>=r.threshold));
}

/** Called only after a successful merge or delivered order. No repeat claims. */
export function recordSupplyProgress(state,counterName){
  if(!counters.includes(counterName))throw Error('Invalid supply progress counter');
  state.progress[counterName]=Math.min(Number.MAX_SAFE_INTEGER,state.progress[counterName]+1);
  const awards=[];
  for(const rule of ACHIEVEMENT_RULES){
    if(rule.counter!==counterName||state.achievements[rule.id]||
      state.progress[counterName]<rule.threshold)continue;
    state.achievements[rule.id]=1;
    state.bag[rule.reward]++;
    awards.push({title:rule.title,item:rule.reward});
  }
  return awards;
}
