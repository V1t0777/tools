/** P3.3 offline-only, seeded campaign simulator. Uses the real P2 transitions.
 * This is a heuristic player model, not telemetry or a claim of game balance.
 * No browser, storage, network, authentication or production-side effects.
 */
import { createInitialState, advanceTime, moveOrMerge, produce, fulfillOrder,
  upgradeWarehouse, upgradeProducer, upgradeBuilding, getLevelProgress,
  validateSave, MAX_ENERGY, ENERGY_REGEN_MS, CELL_COUNT } from './engine.mjs';
import { diagnoseBoard } from './board-diagnostics.mjs';
import { BUILDINGS, getWarehouseUpgrade, getProducerUpgrade } from './economy.mjs';

const DAY = 86_400_000;
const MINUTE = 60_000;
const ACTION_MS = 2_000;
const MAX_ACTIONS_PER_SESSION = 800;
const POLICIES = new Set(['balanced','save-coins','expand-first']);
const assertRange = (name, value, min, max) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw Error(`Invalid ${name}`);
};
const seededRandom = initial => {
  let state = initial >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
};
const countOccupied = board => board.reduce((sum, item) => sum + Number(item !== null), 0);

function findDeliverable(state) {
  for (const order of state.orders) {
    if (state.board.some(item => item?.kind === 'material' && item.chain === order.chain && item.tier === order.tier)) return order;
  }
  return null;
}
function findMerge(state) {
  const seen = new Map();
  for (let i = 0; i < state.board.length; i++) {
    const item = state.board[i];
    if (item?.kind !== 'material' || item.tier >= 6) continue;
    const key = `${item.chain}:${item.tier}`;
    if (seen.has(key)) return [seen.get(key), i];
    seen.set(key, i);
  }
  return null;
}
function chooseProducer(state) {
  const choices = state.board.map((item, slot) => ({item, slot}))
    .filter(({item}) => item?.kind === 'producer' && item.charges > 0 && state.orders.some(o=>o.chain===item.chain));
  if (!choices.length) return null;
  // Focus on the order whose target is nearest, with inventory credited only
  // up to the required tier. Higher-tier leftovers cannot fill lower orders.
  const scored = choices.map(({item, slot}) => {
    const options = state.orders.filter(o => o.chain === item.chain).map(order => {
      const required = 2 ** (order.tier - 1);
      const have = state.board.reduce((sum, m) => sum + (m?.kind === 'material' && m.chain === item.chain && m.tier <= order.tier ? 2 ** (m.tier - 1) : 0), 0);
      return {slot, score:Math.max(0, required - have) / required, tier:order.tier};
    });
    options.sort((a,b) => b.score-a.score || a.tier-b.tier);
    return options[0];
  });
  scored.sort((a,b) => b.score - a.score || a.tier - b.tier || a.slot - b.slot);
  return scored[0].slot;
}
function chooseUpgrade(state, policy) {
  if (policy === 'save-coins') return null;
  const level = getLevelProgress(state.xp).level;
  const available = [];
  const warehouse = getWarehouseUpgrade(state.warehouse.capacity);
  if (warehouse && level >= warehouse.minLevel && state.coins >= warehouse.coins)
    available.push({name:'warehouse',cost:warehouse.coins,action:()=>upgradeWarehouse(state)});
  for (const p of state.board) {
    if (p?.kind !== 'producer') continue;
    const rule = getProducerUpgrade(p.level);
    if (rule && level >= rule.minLevel && state.coins >= rule.coins)
      available.push({name:'producer',cost:rule.coins,action:()=>upgradeProducer(state,p.id)});
  }
  for (const [id, rule] of Object.entries(BUILDINGS)) {
    if (!state.buildings[id] && level >= rule.minLevel && state.coins >= rule.coins)
      available.push({name:id,cost:rule.coins,action:()=>upgradeBuilding(state,id)});
  }
  const priority = policy === 'expand-first'
    ? ['warehouse','producer','storefront','garden','harbor']
    : ['producer','storefront','warehouse','garden','harbor'];
  available.sort((a,b) => priority.indexOf(a.name) - priority.indexOf(b.name));
  return available[0] ?? null;
}

/** Simulate independent sessions on a deterministic UTC-like virtual clock.
 * sessionsPerDay and sessionMinutes are time budgets, not real player behavior.
 * `onDay` is intentionally absent: simulation cannot mutate external state.
 */
export function simulateEconomy({seed=1, days=30, sessionsPerDay=3,
  sessionMinutes=12, policy='balanced'}={}) {
  assertRange('seed',seed,0,0xffffffff);
  assertRange('days',days,1,90);
  assertRange('sessionsPerDay',sessionsPerDay,1,8);
  assertRange('sessionMinutes',sessionMinutes,1,60);
  if (!POLICIES.has(policy) || sessionsPerDay * sessionMinutes > 480)
    throw Error('Invalid play schedule or policy');
  const rng = seededRandom(seed);
  const start = 1_000_000;
  let state = createInitialState(start);
  const totals = {produced:0, merged:0, orders:0, earned:0, spent:0,
    upgrades:0, warehouseUpgrades:0, producerUpgrades:0, buildings:0,
    energySpent:0, boardFullSessions:0, recoverableFullSessions:0,
    hardDeadlockSessions:0, energyLimitedSessions:0,
    actions:0, maxOccupied:countOccupied(state.board)};
  const daily = [];
  const milestones = {};
  let previousDay = start;
  for (let day=0; day<days; day++) {
    const dayBefore = {...totals};
    for (let session=0; session<sessionsPerDay; session++) {
      const sessionStart = start + day*DAY + Math.floor((session+1)*DAY/(sessionsPerDay+1));
      let now = Math.max(sessionStart,previousDay);
      const end = sessionStart + sessionMinutes*MINUTE;
      let boardBlocked = false;
      let energyBlocked = false;
      state = advanceTime(state,now);
      for (let action=0; action<MAX_ACTIONS_PER_SESSION && now<end; action++) {
        state = advanceTime(state,now);
        let result = null, kind = null;
        const order = findDeliverable(state);
        if (order) { result = fulfillOrder(state,order.id); kind='order'; }
        else {
          const pair = findMerge(state);
          if (pair) { result=moveOrMerge(state,...pair); kind='merge'; }
          else {
            const upgrade = chooseUpgrade(state,policy);
            if (upgrade) { result=upgrade.action(); kind=upgrade.name; }
            else {
              const empty = countOccupied(state.board) < CELL_COUNT;
              const producerSlot = chooseProducer(state);
              if (empty && state.energy > 0 && producerSlot !== null) {
                result=produce(state,producerSlot,now,rng);kind='produce';
              } else if (!empty) {
                // The simulator intentionally does not perform warehouse moves.
                // A full board is not automatically a rules-level deadlock:
                // diagnose against the real engine before counting the blocker.
                const diagnosis=diagnoseBoard(state);
                if(diagnosis.recovery==='recoverable')totals.recoverableFullSessions++;
                else if(diagnosis.recovery==='hard-deadlock')totals.hardDeadlockSessions++;
                else throw Error('Unexpected full-board recovery classification');
                boardBlocked=true;break;
              }
              else {
                // Idle until next energy tick or producer recharge, if within session.
                const nextEnergy = state.energy < MAX_ENERGY ? state.energyAt + ENERGY_REGEN_MS : Infinity;
                const nextProducer = Math.min(Infinity,...state.board.filter(p=>p?.kind==='producer' && p.charges===0).map(p=>p.cooldownUntil));
                const next = Math.min(nextEnergy,nextProducer,end);
                if (!Number.isFinite(next) || next<=now || next>=end) {
                  if (state.energy===0) energyBlocked=true;
                  break;
                }
                now=next;continue;
              }
            }
          }
        }
        if (!result?.ok) throw Error(`Simulator selected illegal ${kind} at day ${day+1}`);
        const before = state;
        state = result.state;
        totals.actions++;
        if (kind==='produce') {totals.produced++;totals.energySpent += before.energy - state.energy;}
        if (kind==='merge') totals.merged++;
        if (kind==='order') {totals.orders++;totals.earned += state.coins-before.coins;}
        if (['warehouse','producer','storefront','garden','harbor'].includes(kind)) {
          totals.upgrades++;totals.spent += before.coins-state.coins;
          if (kind==='warehouse') totals.warehouseUpgrades++;
          else if (kind==='producer') totals.producerUpgrades++;
          else totals.buildings++;
        }
        totals.maxOccupied=Math.max(totals.maxOccupied,countOccupied(state.board));
        now+=ACTION_MS;
      }
      if (boardBlocked) totals.boardFullSessions++;
      if (energyBlocked) totals.energyLimitedSessions++;
      previousDay=now;
    }
    if (!validateSave(state)) throw Error(`Simulation invalid save on day ${day+1}`);
    const level = getLevelProgress(state.xp).level;
    for (let lv=2;lv<=level;lv++) if (!milestones[`level${lv}`]) milestones[`level${lv}`]=day+1;
    daily.push({day:day+1,level,xp:state.xp,coins:state.coins,
      orders:totals.orders-dayBefore.orders,produced:totals.produced-dayBefore.produced,
      earned:totals.earned-dayBefore.earned,spent:totals.spent-dayBefore.spent,
      boardFullSessions:totals.boardFullSessions-dayBefore.boardFullSessions,
      recoverableFullSessions:totals.recoverableFullSessions-dayBefore.recoverableFullSessions,
      hardDeadlockSessions:totals.hardDeadlockSessions-dayBefore.hardDeadlockSessions,
      energyLimitedSessions:totals.energyLimitedSessions-dayBefore.energyLimitedSessions,
      occupied:countOccupied(state.board)});
  }
  if(totals.boardFullSessions!==totals.recoverableFullSessions+totals.hardDeadlockSessions)
    throw Error('Full-board recovery classification invariant failed');
  if (state.coins !== totals.earned - totals.spent || state.energy < 0)
    throw Error('Economic conservation invariant failed');
  return {scenario:{seed,days,sessionsPerDay,sessionMinutes,policy},
    totals, milestones, daily, final:{level:getLevelProgress(state.xp).level,
      xp:state.xp,coins:state.coins,energy:state.energy,
      warehouseCapacity:state.warehouse.capacity,
      producerLevels:state.board.filter(p=>p?.kind==='producer').map(p=>p.level),
      buildings:{...state.buildings},boardOccupied:countOccupied(state.board),
      orders:state.orders.map(o=>({chain:o.chain,tier:o.tier}))}};
}