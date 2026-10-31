#!/usr/bin/env node
/** Read-only, reproducible P2.11 progression pacing diagnostic.
 * Never reads browser storage, production records, Supabase or credentials.
 * Run: node scripts/merge-progression-audit.mjs
 */
import {auditProgression} from '../merge/progression-audit.mjs';

const scenarios=[
  {seed:42,days:30,sessionsPerDay:2,sessionMinutes:12,behavior:'casual'},
  {seed:77,days:90,sessionsPerDay:2,sessionMinutes:12,behavior:'organized'},
  {seed:2026,days:30,sessionsPerDay:3,sessionMinutes:8,behavior:'cluttered'}
];
const reports=scenarios.map(auditProgression);
process.stdout.write(JSON.stringify({
  schema:'merge-p2.11-offline-progression-audit',
  warning:'Heuristic simulations only; NOT actual user telemetry, causal comparison, or a release approval',
  reports
},null,2)+'\n');
