/** 云屿百物铺 P2 — deterministic core; untrusted local saves never grant cloud currency. */
import { BUILDINGS, DROP_DISTRIBUTIONS, MAX_PRODUCER_LEVEL, WAREHOUSE_SLOTS,
  getLevel, getLevelProgress, getMaxOrderTier, getProducerUpgrade,
  getWarehouseUpgrade, makeOrder } from './economy.mjs';
export { getLevel, getLevelProgress, getMaxOrderTier, getProducerUpgrade, getWarehouseUpgrade } from './economy.mjs';
export const WIDTH = 7;
export const HEIGHT = 8;
export const CELL_COUNT = WIDTH * HEIGHT;
export const SAVE_VERSION = 2;
export const MAX_ENERGY = 80;
export const ENERGY_REGEN_MS = 180_000;
export const PRODUCER_CHARGES = 12;
export const PRODUCER_RECHARGE_MS = 45_000;
export const MAX_TIER = 6;
export const CHAINS = Object.freeze({
  tea: { name: '茶饮', icon: ['🍃','🌿','🍵','🫖','🍯','🎁'], names: ['茶芽','嫩茶','清茶','瓷茶壶','花蜜茶礼','珍藏茶礼'] },
  bakery: { name: '烘焙', icon: ['🌾','🥖','🥐','🍞','🧁','🎂'], names: ['麦穗','面团','酥点','面包篮','奶油甜点','节庆蛋糕'] },
  floral: { name: '花艺', icon: ['🌱','🌼','🌷','💐','🌻','🏵️'], names: ['花种','野花','郁金香','花束','花篮','珍品花艺'] }
});
const CHAIN_KEYS = Object.keys(CHAINS);
const FAIL = (state, message) => ({ state, ok: false, message });
const OK = (state, message, kind) => ({ state, ok: true, message, kind });
const own = (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop);
const validIndex = i => Number.isInteger(i) && i >= 0 && i < CELL_COUNT;
const clone = state => ({ ...state, board: state.board.map(x => x ? { ...x } : null),
  orders: state.orders.map(x => ({ ...x })),
  warehouse: { capacity: state.warehouse.capacity, slots: state.warehouse.slots.map(x => x ? { ...x } : null) },
  buildings: { ...state.buildings } });
const nextId = state => `m${state.nextId++}`;
const material = (state, chain, tier = 1) => ({ id: nextId(state), kind: 'material', chain, tier });
const producer = (state, chain) => ({ id: nextId(state), kind: 'producer', chain, level: 1, pity: 0, charges: PRODUCER_CHARGES, cooldownUntil: 0 });

export function createInitialState(now = Date.now()) {
  if (!Number.isFinite(now) || now < 0) throw Error('Invalid time');
  const s = { schemaVersion: SAVE_VERSION, revision: 0, nextId: 1, energy: MAX_ENERGY,
    energyAt: now, coins: 0, xp: 0, board: Array(CELL_COUNT).fill(null),
    warehouse: { capacity: 4, slots: Array(WAREHOUSE_SLOTS).fill(null) },
    buildings: { storefront: 0, garden: 0, harbor: 0 }, orders: [], orderIndex: 3 };
  for (const [slot, chain, tier] of [
    [0,'tea',1],[1,'tea',1],[3,'bakery',1],[4,'bakery',1],
    [9,'floral',1],[10,'floral',1],[16,'tea',2],[18,'bakery',2]
  ]) s.board[slot] = material(s, chain, tier);
  for (const [slot, chain] of [[42,'tea'],[44,'bakery'],[46,'floral']]) s.board[slot] = producer(s, chain);
  s.orders = [0,1,2].map(i => makeOrder(i, s.xp, s.buildings));
  return s;
}

/** v1 migration copies all item IDs and economy totals, never silently imports to cloud. */
export function upgradeLegacySave(legacy) {
  if (!legacy || legacy.schemaVersion !== 1) throw Error('Not a legacy save');
  const next = {
    ...legacy, schemaVersion: SAVE_VERSION,
    board: legacy.board.map(x => x ? { ...x, ...(x.kind === 'producer' ? { level: 1, pity: 0 } : {}) } : null),
    warehouse: { capacity: 4, slots: Array(WAREHOUSE_SLOTS).fill(null) },
    buildings: { storefront: 0, garden: 0, harbor: 0 },
    orderIndex: Math.max(3, legacy.orderIndex + 3, ...legacy.orders.map(o => Number(o.id.slice(1)) + 1)),
    orders: legacy.orders.map(o => ({ ...o, estimatedEnergy: 0 }))
  };
  // Keep accepted requests only when unlock limits are met; otherwise substitute reachable requests.
  const maxTier = getMaxOrderTier(next.xp);
  next.orders = next.orders.map(order => order.tier <= maxTier ? order : makeOrder(next.orderIndex++, next.xp, next.buildings));
  if (!validateSave(next)) throw Error('Failed to migrate legacy save');
  return next;
}

export function advanceTime(state, now = Date.now()) {
  if (!Number.isFinite(now) || now < 0) return state;
  const elapsed = Math.floor((now - state.energyAt) / ENERGY_REGEN_MS);
  const recharge = state.board.some(p => p?.kind === 'producer' && p.charges === 0 && p.cooldownUntil <= now);
  if ((elapsed <= 0 || state.energy >= MAX_ENERGY) && !recharge) return state;
  const next = clone(state);
  if (elapsed > 0) {
    if (next.energy < MAX_ENERGY) next.energy = Math.min(MAX_ENERGY, next.energy + elapsed);
    next.energyAt = next.energy === MAX_ENERGY ? now : next.energyAt + elapsed * ENERGY_REGEN_MS;
  }
  for (const p of next.board) if (p?.kind === 'producer' && p.charges === 0 && p.cooldownUntil <= now) {
    p.charges = PRODUCER_CHARGES;
    p.cooldownUntil = 0;
  }
  return next;
}
export function moveOrMerge(state, from, to) {
  if (!validIndex(from) || !validIndex(to) || from === to) return FAIL(state, '请选择其他格子');
  const src = state.board[from], dst = state.board[to];
  if (!src) return FAIL(state, '原位置没有物品');
  const s = clone(state);
  if (!dst) { s.board[to] = s.board[from]; s.board[from] = null; s.revision++; return OK(s, '已移动', 'move'); }
  if (src.kind === 'material' && dst.kind === 'material' && src.chain === dst.chain && src.tier === dst.tier) {
    if (src.tier >= MAX_TIER) return FAIL(state, '已经是最高等级');
    s.board[to] = { ...s.board[to], tier: dst.tier + 1 };
    s.board[from] = null;
    s.revision++;
    return OK(s, `合成成功：${getItemName(s.board[to])}`, 'merge');
  }
  s.board[to] = s.board[from]; s.board[from] = dst; s.revision++;
  return OK(s, '已交换位置', 'swap');
}
export function getItemName(item) {
  if (!item) return '';
  if (item.kind === 'producer') return `${CHAINS[item.chain]?.name ?? '未知'}工坊`;
  return CHAINS[item.chain]?.names[item.tier - 1] ?? '未知物品';
}
export function getItemIcon(item) {
  if (!item) return '';
  return item.kind === 'producer' ? '🧺' : (CHAINS[item.chain]?.icon[item.tier - 1] ?? '❔');
}
function nearestEmpty(board, origin) {
  const x = origin % WIDTH, y = Math.floor(origin / WIDTH);
  const slots = [];
  for (let i = 0; i < CELL_COUNT; i++) if (!board[i]) {
    const dx = i % WIDTH - x, dy = Math.floor(i / WIDTH) - y;
    slots.push([dx * dx + dy * dy, i]);
  }
  slots.sort((a,b) => a[0] - b[0] || a[1] - b[1]);
  return slots[0]?.[1] ?? -1;
}
export function produce(state, slot, now = Date.now(), rng = Math.random) {
  if (!validIndex(slot) || !Number.isFinite(now) || typeof rng !== 'function') return FAIL(state, '生产请求无效');
  const updated = advanceTime(state, now);
  const p = updated.board[slot];
  if (p?.kind !== 'producer') return FAIL(updated, '请选择生产器');
  if (updated.energy <= 0) return FAIL(updated, '体力不足');
  if (p.charges <= 0) return FAIL(updated, `冷却中，剩余 ${Math.max(0,Math.ceil((p.cooldownUntil - now)/1000))} 秒`);
  const target = nearestEmpty(updated.board, slot);
  if (target < 0) return FAIL(updated, '棋盘已满，无法生产');
  const roll = rng();
  if (!(roll >= 0 && roll < 1)) return FAIL(updated, '随机源无效');
  const dist = DROP_DISTRIBUTIONS[p.level];
  const tier = p.pity >= 9 ? 2 : roll < dist[0] ? 1 : roll < dist[0] + dist[1] ? 2 : 3;
  const next = clone(updated), gen = next.board[slot];
  next.board[target] = material(next, gen.chain, tier);
  gen.pity = tier === 1 ? Math.min(9,gen.pity + 1) : 0;
  gen.charges--;
  if (gen.charges === 0) gen.cooldownUntil = now + PRODUCER_RECHARGE_MS;
  next.energy--;
  if (updated.energy === MAX_ENERGY) next.energyAt = now;
  next.revision++;
  return OK(next, `获得 ${getItemName(next.board[target])}`, 'produce');
}
export function fulfillOrder(state, orderId) {
  const order = state.orders.find(o => o.id === orderId);
  if (!order) return FAIL(state, '订单不存在');
  const slot = state.board.findIndex(item => item?.kind === 'material' && item.chain === order.chain && item.tier === order.tier);
  if (slot < 0) return FAIL(state, '尚未获得订单所需物品（仓库物品需先取出）');
  const next = clone(state);
  next.board[slot] = null;
  next.coins += order.coins;
  next.xp += order.xp;
  if (!Number.isSafeInteger(next.coins) || !Number.isSafeInteger(next.xp)) return FAIL(state, '奖励超出安全范围');
  const oldLevel = getLevel(state.xp);
  const newOrder = makeOrder(next.orderIndex++, next.xp, next.buildings);
  next.orders = next.orders.map(o => o.id === orderId ? newOrder : o);
  next.revision++;
  const newLevel = getLevel(next.xp);
  return OK(next, `订单完成！+${order.coins} 金币${newLevel > oldLevel ? `，升至 ${newLevel} 级` : ''}`, 'order');
}
export function storeItem(state, slot) {
  if (!validIndex(slot) || state.board[slot]?.kind !== 'material') return FAIL(state, '请选择棋盘上的物品');
  const dest = state.warehouse.slots.findIndex((item, i) => i < state.warehouse.capacity && !item);
  if (dest < 0) return FAIL(state, '仓库已满，请先取出物品或扩容');
  const next = clone(state);
  next.warehouse.slots[dest] = next.board[slot]; next.board[slot] = null;
  next.revision++;
  return OK(next, '已收入仓库', 'store');
}
export function withdrawItem(state, slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= state.warehouse.capacity) return FAIL(state, '仓库位置无效');
  if (!state.warehouse.slots[slot]) return FAIL(state, '这里没有物品');
  const dest = state.board.findIndex(item => !item);
  if (dest < 0) return FAIL(state, '棋盘已满，无法取出');
  const next = clone(state);
  next.board[dest] = next.warehouse.slots[slot]; next.warehouse.slots[slot] = null;
  next.revision++;
  return OK(next, '已取回棋盘', 'withdraw');
}
export function upgradeWarehouse(state) {
  const rule = getWarehouseUpgrade(state.warehouse.capacity);
  if (!rule) return FAIL(state, '仓库已满级');
  if (getLevel(state.xp) < rule.minLevel) return FAIL(state, `需要达到 ${rule.minLevel} 级`);
  if (state.coins < rule.coins) return FAIL(state, `需要 ${rule.coins} 金币`);
  const next = clone(state);
  next.coins -= rule.coins; next.warehouse.capacity = rule.newCapacity; next.revision++;
  return OK(next, `仓库扩容到 ${rule.newCapacity} 格`, 'warehouse-upgrade');
}
export function upgradeProducer(state, id) {
  const index = state.board.findIndex(item => item?.kind === 'producer' && item.id === id);
  if (index < 0) return FAIL(state, '生产器不存在');
  const rule = getProducerUpgrade(state.board[index].level);
  if (!rule) return FAIL(state, '生产器已满级');
  if (getLevel(state.xp) < rule.minLevel) return FAIL(state, `需要达到 ${rule.minLevel} 级`);
  if (state.coins < rule.coins) return FAIL(state, `需要 ${rule.coins} 金币`);
  const next = clone(state);
  next.coins -= rule.coins; next.board[index].level++; next.board[index].pity = 0; next.revision++;
  return OK(next, `${getItemName(next.board[index])}提升至 ${next.board[index].level} 级`, 'producer-upgrade');
}
export function upgradeBuilding(state, id) {
  if (!own(BUILDINGS, id)) return FAIL(state, '未知建设项目');
  const rule = BUILDINGS[id];
  if (state.buildings[id]) return FAIL(state, '此建设节点已完成');
  if (getLevel(state.xp) < rule.minLevel) return FAIL(state, `需要达到 ${rule.minLevel} 级`);
  if (state.coins < rule.coins) return FAIL(state, `需要 ${rule.coins} 金币`);
  const next = clone(state);
  next.coins -= rule.coins; next.buildings[id] = 1; next.revision++;
  return OK(next, `建成${rule.name}`, 'building-upgrade');
}
/** Validator is strict because localStorage is untrusted and can be manually edited. */
export function validateSave(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== SAVE_VERSION) return false;
  if (!Array.isArray(value.board) || value.board.length !== CELL_COUNT || !Array.isArray(value.orders) || value.orders.length !== 3) return false;
  if (!Number.isSafeInteger(value.nextId) || value.nextId < 1 || !Number.isSafeInteger(value.revision) || value.revision < 0) return false;
  if (!Number.isInteger(value.energy) || value.energy < 0 || value.energy > MAX_ENERGY || !Number.isFinite(value.energyAt) || value.energyAt < 0) return false;
  if (!Number.isSafeInteger(value.coins) || value.coins < 0 || !Number.isSafeInteger(value.xp) || value.xp < 0) return false;
  if (!Number.isSafeInteger(value.orderIndex) || value.orderIndex < 3) return false;
  const warehouse = value.warehouse;
  if (!warehouse || ![4,6,8].includes(warehouse.capacity) || !Array.isArray(warehouse.slots) || warehouse.slots.length !== WAREHOUSE_SLOTS) return false;
  if (warehouse.slots.slice(warehouse.capacity).some(item => item !== null)) return false;
  if (!value.buildings || Object.keys(BUILDINGS).some(id => ![0,1].includes(value.buildings[id]))) return false;
  const ids = new Set(); let greatest = 0; let producerCount = 0; const chains = new Set();
  for (const [place, items] of [['board',value.board], ['warehouse',warehouse.slots]]) {
    for (const item of items) {
      if (item === null) continue;
      if (!item || typeof item !== 'object' || !CHAIN_KEYS.includes(item.chain) || !/^m[1-9]\d*$/.test(item.id) || ids.has(item.id)) return false;
      greatest = Math.max(greatest, Number(item.id.slice(1)));
      ids.add(item.id);
      if (item.kind === 'material') {
        if (!Number.isInteger(item.tier) || item.tier < 1 || item.tier > MAX_TIER) return false;
      } else if (item.kind === 'producer' && place === 'board') {
        if (!Number.isInteger(item.level) || item.level < 1 || item.level > MAX_PRODUCER_LEVEL ||
            !Number.isInteger(item.pity) || item.pity < 0 || item.pity > 9 ||
            !Number.isInteger(item.charges) || item.charges < 0 || item.charges > PRODUCER_CHARGES ||
            !Number.isFinite(item.cooldownUntil) || item.cooldownUntil < 0 || chains.has(item.chain)) return false;
        chains.add(item.chain); producerCount++;
      } else return false;
    }
  }
  if (producerCount !== CHAIN_KEYS.length || greatest >= value.nextId) return false;
  const orderIds = new Set();
  return value.orders.every(o => o && typeof o === 'object' && typeof o.id === 'string' && /^o\d+$/.test(o.id) && !orderIds.has(o.id) && orderIds.add(o.id) &&
    CHAIN_KEYS.includes(o.chain) && Number.isInteger(o.tier) && o.tier >= 1 && o.tier <= MAX_TIER &&
    Number.isSafeInteger(o.coins) && o.coins >= 0 && Number.isSafeInteger(o.xp) && o.xp >= 0 &&
    Number.isSafeInteger(o.estimatedEnergy) && o.estimatedEnergy >= 0);
}