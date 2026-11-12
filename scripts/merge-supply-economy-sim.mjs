#!/usr/bin/env node
/** Read-only reproducible supply economy study. NEVER connects to Supabase. */
import {simulateSupplyEconomy} from '../merge/supply-economy-simulator.mjs';
const scenarios=[
  {seed:7,days:30,sessionsPerDay:3,actionsPerSession:140},
  {seed:77,days:30,sessionsPerDay:4,actionsPerSession:180},
  {seed:2026,days:90,sessionsPerDay:6,actionsPerSession:150}
];
const reports=scenarios.map(simulateSupplyEconomy);
process.stdout.write(JSON.stringify({model:'merge-p2.9-offline-supply',reports},null,2)+'\n');
