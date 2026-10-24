/** Offline P3.3 report: run from repository root with node scripts/merge-economy-sim.mjs */
import { simulateEconomy } from '../merge/economy-simulator.mjs';
const scenarios = [
  {name:'轻度',sessionsPerDay:1,sessionMinutes:8},
  {name:'中度',sessionsPerDay:2,sessionMinutes:12},
  {name:'重度',sessionsPerDay:4,sessionMinutes:20}
];
const seeds=[11,42,2026,8192,314159];
const rows=[];
for(const profile of scenarios) {
  for(const policy of ['balanced','expand-first','save-coins']) {
    const runs=seeds.map(seed=>simulateEconomy({seed,days:30,policy,...profile}));
    const mean = f => +(runs.reduce((sum,r)=>sum+f(r),0)/runs.length).toFixed(1);
    rows.push({profile:profile.name,policy,runs:runs.length,
      ordersMean:mean(r=>r.totals.orders),producedMean:mean(r=>r.totals.produced),
      finalCoinsMean:mean(r=>r.final.coins),finalLevelMean:mean(r=>r.final.level),
      boardFullSessionsMean:mean(r=>r.totals.boardFullSessions),
      energyLimitedSessionsMean:mean(r=>r.totals.energyLimitedSessions),
      upgradesMean:mean(r=>r.totals.upgrades),
      level8DayMean:mean(r=>r.milestones.level8 ?? 31),
      maxOccupiedMean:mean(r=>r.totals.maxOccupied)});
  }
}
console.log(JSON.stringify({kind:'heuristic-economy-simulation',days:30,seeds,rows},null,2));