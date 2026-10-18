/** P3.4 offline report; deterministic stress scenarios, not actual player data. */
import { simulateFriction } from '../merge/economy-friction-simulator.mjs';
const seeds=[11,42,2026,8192,314159], days=30;
const rows=[];
for(const behavior of ['organized','casual','cluttered']) {
  for(const policy of ['save-coins','warehouse-only','balanced']) {
    const runs=seeds.map(seed=>simulateFriction({seed,days,behavior,policy}));
    const mean=fn=>+(runs.reduce((sum,r)=>sum+fn(r),0)/runs.length).toFixed(1);
    rows.push({behavior,policy,runs:runs.length,
      ordersMean:mean(r=>r.totals.orders),blockedSessionsMean:mean(r=>r.totals.blockedSessions),
      fullBoardSessionsMean:mean(r=>r.totals.fullBoardSessions),
      hardDeadlockSessionsMean:mean(r=>r.totals.hardDeadlockSessions),
      highPressureSessionsMean:mean(r=>r.totals.highPressureSessions),
      warehouseFullSessionsMean:mean(r=>r.totals.warehouseFullSessions),
      storedMean:mean(r=>r.totals.stored),withdrawnMean:mean(r=>r.totals.withdrawn),
      finalCoinsMean:mean(r=>r.final.coins),upgradesMean:mean(r=>r.totals.upgrades)});
  }
}
console.log(JSON.stringify({kind:'offline-heuristic-friction-stress',days,seeds,
  sessionsPerDay:2,sessionMinutes:12,warning:'Not empirical player data or a retention forecast',rows},null,2));