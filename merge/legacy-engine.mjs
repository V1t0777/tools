/** 云屿百物铺 P1 — pure, deterministic merge rules (no DOM or network access). */
export const WIDTH = 7;
export const HEIGHT = 8;
export const CELL_COUNT = WIDTH * HEIGHT;
export const SAVE_VERSION = 1;
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
const own = (object, prop) => Object.prototype.hasOwnProperty.call(object, prop);
const clone = state => ({ ...state, board: state.board.map(x => x ? { ...x } : null), orders: state.orders.map(x => ({ ...x })) });
const validIndex = i => Number.isInteger(i) && i >= 0 && i < CELL_COUNT;
const nextId = state => `m${state.nextId++}`;
const material = (state, chain, tier = 1) => ({ id: nextId(state), kind: 'material', chain, tier });
const producer = (state, chain) => ({ id: nextId(state), kind: 'producer', chain, charges: PRODUCER_CHARGES, cooldownUntil: 0 });

export function createInitialState(now = Date.now()) {
  if (!Number.isFinite(now) || now < 0) throw Error('Invalid time');
  const s = { schemaVersion: SAVE_VERSION, revision: 0, nextId: 1, energy: MAX_ENERGY,
    energyAt: now, coins: 0, xp: 0, board: Array(CELL_COUNT).fill(null), orders: [], orderIndex: 0 };
  // Short, curated opening so a player can complete a first merge immediately.
  for (const [slot, chain, tier] of [
    [0,'tea',1],[1,'tea',1],[3,'bakery',1],[4,'bakery',1],
    [9,'floral',1],[10,'floral',1],[16,'tea',2],[18,'bakery',2]
  ]) s.board[slot] = material(s, chain, tier);
  for (const [slot, chain] of [[42,'tea'],[44,'bakery'],[46,'floral']]) s.board[slot] = producer(s, chain);
  s.orders = [makeOrder(0), makeOrder(1), makeOrder(2)];
  return s;
}

function makeOrder(index) {
  const chain = CHAIN_KEYS[index % CHAIN_KEYS.length];
  const tier = index < 3 ? 2 : (index % 4 === 3 ? 3 : 2);
  return { id: `o${index}`, chain, tier, coins: tier === 2 ? 12 : 30, xp: tier === 2 ? 6 : 12 };
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
  for (const p of next.board) {
    if (p?.kind === 'producer' && p.charges === 0 && p.cooldownUntil <= now) {
      p.charges = PRODUCER_CHARGES;
      p.cooldownUntil = 0;
    }
  }
  // Time progression is derived; revision changes only on player actions.
  return next;
}

export function moveOrMerge(state, from, to) {
  if (!validIndex(from) || !validIndex(to) || from === to) return FAIL(state, '请选择其他格子');
  const src = state.board[from], dst = state.board[to];
  if (!src) return FAIL(state, '原位置没有物品');
  const s = clone(state);
  if (!dst) {
    s.board[to] = s.board[from];
    s.board[from] = null;
    s.revision++;
    return OK(s, '已移动', 'move');
  }
  if (src.kind === 'material' && dst.kind === 'material' && src.chain === dst.chain && src.tier === dst.tier) {
    if (src.tier >= MAX_TIER) return FAIL(state, '已经是最高等级');
    s.board[to] = { ...s.board[to], tier: dst.tier + 1 };
    s.board[from] = null;
    s.revision++;
    return OK(s, `合成成功：${getItemName(s.board[to])}`, 'merge');
  }
  s.board[to] = s.board[from];
  s.board[from] = dst;
  s.revision++;
  return OK(s, '已交换位置', 'swap');
}

export function getItemName(item) {
  if (!item) return '';
  if (item.kind === 'producer') return `${CHAINS[item.chain]?.name ?? '未知'}工坊`;
  return CHAINS[item.chain]?.names[item.tier - 1] ?? '未知物品';
}
export function getItemIcon(item) {
  if (!item) return '';
  if (item.kind === 'producer') return '🧺';
  return CHAINS[item.chain]?.icon[item.tier - 1] ?? '❔';
}

function nearestEmpty(board, origin) {
  const x = origin % WIDTH, y = Math.floor(origin / WIDTH);
  const candidates = [];
  for (let i = 0; i < CELL_COUNT; i++) if (!board[i]) {
    const dx = i % WIDTH - x, dy = Math.floor(i / WIDTH) - y;
    candidates.push([dx * dx + dy * dy, i]);
  }
  candidates.sort((a,b) => a[0] - b[0] || a[1] - b[1]);
  return candidates[0]?.[1] ?? -1;
}

export function produce(state, slot, now = Date.now(), rng = Math.random) {
  if (!validIndex(slot) || !Number.isFinite(now) || typeof rng !== 'function') return FAIL(state, '生产请求无效');
  const updated = advanceTime(state, now);
  const p = updated.board[slot];
  if (p?.kind !== 'producer') return FAIL(updated, '请选择生产器');
  if (updated.energy <= 0) return FAIL(updated, '体力不足');
  if (p.charges <= 0) return FAIL(updated, `冷却中，剩余 ${Math.ceil((p.cooldownUntil - now)/1000)} 秒`);
  const target = nearestEmpty(updated.board, slot);
  if (target < 0) return FAIL(updated, '棋盘已满，无法生产');
  const roll = rng();
  if (!(roll >= 0 && roll < 1)) return FAIL(updated, '随机源无效');
  const tier = roll < 0.75 ? 1 : roll < 0.97 ? 2 : 3;
  const next = clone(updated);
  const gen = next.board[slot];
  next.board[target] = material(next, gen.chain, tier);
  gen.charges--;
  if (gen.charges === 0) gen.cooldownUntil = now + PRODUCER_RECHARGE_MS;
  next.energy--;
  // Spending while partly charged must not reset an in-progress regeneration interval.
  if (updated.energy === MAX_ENERGY) next.energyAt = now;
  next.revision++;
  return OK(next, `获得 ${getItemName(next.board[target])}`, 'produce');
}

export function fulfillOrder(state, orderId) {
  const order = state.orders.find(o => o.id === orderId);
  if (!order) return FAIL(state, '订单不存在');
  const slot = state.board.findIndex(item => item?.kind === 'material' && item.chain === order.chain && item.tier === order.tier);
  if (slot < 0) return FAIL(state, '尚未获得订单所需物品');
  const next = clone(state);
  next.board[slot] = null;
  next.coins += order.coins;
  next.xp += order.xp;
  next.orderIndex++;
  next.orders = next.orders.map(o => o.id === orderId ? makeOrder(next.orderIndex + 2) : o);
  next.revision++;
  return OK(next, `订单完成！+${order.coins} 金币`, 'order');
}

/** Stored saves are untrusted input; reject corrupt or incompatible values. */
export function validateSave(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== SAVE_VERSION) return false;
  if (!Array.isArray(value.board) || value.board.length !== CELL_COUNT || !Array.isArray(value.orders) || value.orders.length !== 3) return false;
  if (!Number.isSafeInteger(value.nextId) || value.nextId < 1 || !Number.isSafeInteger(value.revision) || value.revision < 0) return false;
  if (!Number.isInteger(value.energy) || value.energy < 0 || value.energy > MAX_ENERGY || !Number.isFinite(value.energyAt) || value.energyAt < 0) return false;
  if (!Number.isSafeInteger(value.coins) || value.coins < 0 || !Number.isSafeInteger(value.xp) || value.xp < 0) return false;
  if (!Number.isSafeInteger(value.orderIndex) || value.orderIndex < 0) return false;
  const ids = new Set();
  let greatest = 0;
  for (const item of value.board) {
    if (item === null) continue;
    if (!item || typeof item !== 'object' || !CHAIN_KEYS.includes(item.chain) || !/^m[1-9]\d*$/.test(item.id) || ids.has(item.id)) return false;
    greatest = Math.max(greatest, Number(item.id.slice(1)));
    ids.add(item.id);
    if (item.kind === 'material') {
      if (!Number.isInteger(item.tier) || item.tier < 1 || item.tier > MAX_TIER) return false;
    } else if (item.kind === 'producer') {
      if (!Number.isInteger(item.charges) || item.charges < 0 || item.charges > PRODUCER_CHARGES || !Number.isFinite(item.cooldownUntil) || item.cooldownUntil < 0) return false;
    } else return false;
  }
  if (greatest >= value.nextId) return false;
  const orderIds = new Set();
  return value.orders.every(o => o && typeof o === 'object' && typeof o.id === 'string' && /^o\d+$/.test(o.id) && !orderIds.has(o.id) && orderIds.add(o.id) &&
    CHAIN_KEYS.includes(o.chain) && Number.isInteger(o.tier) && o.tier >= 1 && o.tier <= MAX_TIER &&
    Number.isSafeInteger(o.coins) && o.coins >= 0 && Number.isSafeInteger(o.xp) && o.xp >= 0);
}