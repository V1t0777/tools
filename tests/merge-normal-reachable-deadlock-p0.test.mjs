import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState, validateSave, CELL_COUNT, MAX_TIER, ENERGY_REGEN_MS,
  storeItem, moveOrMerge, produce, fulfillOrder, upgradeWarehouse, advanceTime
} from '../merge/engine.mjs';
import { diagnoseBoard } from '../merge/board-diagnostics.mjs';

const START = 1_000_000;
const MAX_STEPS = 12_000;

// Every mutation below is a legal, public engine transition starting at a new
// game. No fixture edits, injected items, forced order changes or save patches.
function reachableDeadlock() {
  let state = createInitialState(START);
  const initialOrders = structuredClone(state.orders);
  const actions = [];
  let produced = 0, merged = 0;
  const apply = (result, label) => {
    assert.equal(result.ok, true, label + ': ' + result.message);
    state = result.state;
    assert.equal(validateSave(state), true, label + ': save validation');
    actions.push(label);
  };

  // A player can legally fill the initial four-slot warehouse with existing
  // bakery and floral materials, without collecting any order rewards.
  for (const slot of [3, 4, 18, 9]) apply(storeItem(state, slot), 'store:' + slot);
  apply(moveOrMerge(state, 0, 1), 'initial-tea-merge-1');
  apply(moveOrMerge(state, 1, 16), 'initial-tea-merge-2');
  assert.equal(state.warehouse.slots.slice(0, 4).filter(Boolean).length, 4);
  assert.equal(state.orders.every(o => o.tier === 2), true);

  let terminal = false, iterations = 0;
  for (let step = 0; step < MAX_STEPS; step++) {
    iterations++;
    const diagnosis = diagnoseBoard(state);
    if (diagnosis.recovery === 'hard-deadlock') { terminal = true; break; }

    // Merge all legal lower-tier pairs before generating more material.
    const seen = new Map();
    let pair = null;
    for (let i = 0; i < state.board.length; i++) {
      const item = state.board[i];
      if (item?.kind !== 'material' || item.tier >= MAX_TIER) continue;
      const key = item.chain + ':' + item.tier;
      if (seen.has(key)) { pair = [seen.get(key), i]; break; }
      seen.set(key, i);
    }
    if (pair) {
      apply(moveOrMerge(state, pair[0], pair[1]), 'merge:' + pair.join(':'));
      merged++;
      continue;
    }

    const occupied = state.board.filter(Boolean).length;
    assert.ok(occupied < CELL_COUNT, 'unexpected full board without terminal classification');
    const teaTier2 = state.board.some(x => x?.kind === 'material' && x.chain === 'tea' && x.tier === 2);
    const lastCell = occupied === CELL_COUNT - 1;
    // If the last space would leave an order-ready tea tier 2, generate its
    // matching partner first, then merge. Otherwise a bakery tier 1 fills the
    // last space without matching any order or creating a merge pair.
    const useBakery = lastCell && !teaTier2;
    const slot = useBakery ? 44 : 42;
    const roll = lastCell && teaTier2 ? 0.9 : 0.01;
    const now = START + (step + 1) * ENERGY_REGEN_MS;
    apply(produce(state, slot, now, () => roll), 'produce:' + slot + ':' + roll);
    produced++;
    assert.equal(state.coins, 0, 'no currency may be created without orders');
    assert.equal(state.xp, 0, 'no XP may be created without orders');
  }

  return { state, terminal, iterations, produced, merged, actions, initialOrders };
}

test('P0 ordinary legal actions can reach full-board/full-warehouse hard deadlock', () => {
  const { state, terminal, iterations, produced, merged, actions, initialOrders } = reachableDeadlock();
  assert.equal(terminal, true, 'bounded real-action witness not found; investigate policy or limit');
  assert.ok(produced > 0 && merged > 0);
  assert.equal(state.coins, 0);
  assert.equal(state.xp, 0);
  assert.deepEqual(state.orders, initialOrders, 'no orders were fulfilled or fabricated');
  const diagnosis = diagnoseBoard(state);
  assert.equal(diagnosis.recovery, 'hard-deadlock');
  assert.equal(diagnosis.board.free, 0);
  assert.equal(diagnosis.warehouse.free, 0);
  assert.equal(diagnosis.actionable.orders, 0);
  assert.equal(diagnosis.actionable.merges, 0);
  assert.equal(diagnosis.actionable.canUpgradeWarehouse, false);
  assert.equal(validateSave(state), true);

  const original = JSON.stringify(state);
  assert.equal(produce(state, 42, START + (iterations + 1) * ENERGY_REGEN_MS, () => 0.01).ok, false);
  assert.equal(storeItem(state, state.board.findIndex(x => x?.kind === 'material')).ok, false);
  assert.equal(upgradeWarehouse(state).ok, false);
  for (const order of state.orders) assert.equal(fulfillOrder(state, order.id).ok, false);
  assert.equal(JSON.stringify(state), original, 'failed operations must preserve snapshot');
  const later = advanceTime(state, START + (iterations + 3) * ENERGY_REGEN_MS);
  assert.equal(diagnoseBoard(later).recovery, 'hard-deadlock');
  console.log('P0 legal-action witness:', JSON.stringify({
    iterations, produced, merged, warehouseStores: 4,
    occupied: diagnosis.board.occupied, warehouseUsed: diagnosis.warehouse.used,
    coins: state.coins, xp: state.xp, revision: state.revision,
    finalActions: actions.slice(-8)
  }));
});
