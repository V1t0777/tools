/** P2 economy configuration. No browser APIs, mutable globals or network dependencies. */
export const XP_THRESHOLDS = Object.freeze([0, 28, 90, 190, 350, 590, 920, 1400]);
export const ORDER_CHAINS = Object.freeze(['tea', 'bakery', 'floral']);
export const PRODUCER_UPGRADE = Object.freeze([
  null,
  { coins: 70, minLevel: 2 },
  { coins: 180, minLevel: 4 }
]);
export const WAREHOUSE_UPGRADE = Object.freeze({
  4: { coins: 50, minLevel: 2, newCapacity: 6 },
  6: { coins: 140, minLevel: 4, newCapacity: 8 }
});
export const BUILDINGS = Object.freeze({
  storefront: { name: '杂货铺门面', coins: 60, minLevel: 2 },
  garden: { name: '后院花园', coins: 160, minLevel: 4 },
  harbor: { name: '港湾街角', coins: 330, minLevel: 6 }
});
export const DROP_DISTRIBUTIONS = Object.freeze({
  1: Object.freeze([0.75, 0.22, 0.03]),
  2: Object.freeze([0.60, 0.32, 0.08]),
  3: Object.freeze([0.50, 0.36, 0.14])
});
export const MAX_PRODUCER_LEVEL = 3;
export const WAREHOUSE_SLOTS = 8;

export function getLevel(xp) {
  if (!Number.isSafeInteger(xp) || xp < 0) return 1;
  let result = 1;
  for (let i = 1; i < XP_THRESHOLDS.length; i++) {
    if (xp < XP_THRESHOLDS[i]) break;
    result = i + 1;
  }
  return result;
}
export function getMaxOrderTier(xp) {
  const lv = getLevel(xp);
  return lv >= 7 ? 6 : lv >= 5 ? 5 : lv >= 4 ? 4 : lv >= 2 ? 3 : 2;
}
export function getLevelProgress(xp) {
  const level = getLevel(xp);
  const minimum = XP_THRESHOLDS[level - 1];
  const next = XP_THRESHOLDS[level] ?? null;
  return { level, minimum, next, current: xp - minimum, required: next === null ? 0 : next - minimum };
}
export function getProducerUpgrade(level) { return PRODUCER_UPGRADE[level] ?? null; }
export function getWarehouseUpgrade(capacity) { return WAREHOUSE_UPGRADE[capacity] ?? null; }

/** An intentionally conservative leaf-equivalent cost heuristic, not a measured simulation. */
export function estimateOrderEnergy(tier, producerLevel = 1) {
  if (!Number.isInteger(tier) || tier < 1 || tier > 6) throw Error('Invalid tier');
  const dist = DROP_DISTRIBUTIONS[producerLevel];
  if (!dist) throw Error('Invalid producer level');
  const expectedUnits = dist.reduce((sum, chance, i) => sum + chance * (2 ** i), 0);
  return Math.max(2, Math.ceil(2 ** (tier - 1) / expectedUnits * 1.35));
}

/** Every generated order has an active producer and a level-accessible tier. */
export function makeOrder(index, xp, buildings = {}) {
  if (!Number.isSafeInteger(index) || index < 0) throw Error('Invalid order index');
  const chain = ORDER_CHAINS[index % ORDER_CHAINS.length];
  const requested = [2, 2, 3, 4, 5][Math.floor(index / 3) % 5];
  const tier = Math.min(requested, getMaxOrderTier(xp));
  const estimatedEnergy = estimateOrderEnergy(tier);
  const upgraded = buildings.storefront === 1;
  const coins = Math.ceil(estimatedEnergy * (upgraded ? 6 : 5) + tier * 2);
  const experience = Math.ceil(estimatedEnergy * 2 + tier * 2);
  return { id: `o${index}`, chain, tier, coins, xp: experience, estimatedEnergy };
}