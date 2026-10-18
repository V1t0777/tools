import { WIDTH, CELL_COUNT, MAX_ENERGY, ENERGY_REGEN_MS, CHAINS, createInitialState,
  advanceTime, moveOrMerge, produce, fulfillOrder, getItemIcon, getItemName } from './engine.mjs';
import { loadLocal, saveLocal, SAVE_KEY } from './storage.mjs';

const byId = id => document.getElementById(id);
const board = byId('board');
const orders = byId('orders');
const notice = byId('notice');
const store = (() => { try { return window.localStorage; } catch { return null; } })();
const loaded = loadLocal(store);
let state = advanceTime(loaded.state);
let selected = -1;
let drag = null;
let ignoreNextClick = false;
let noticeTimer = 0;

function hint(text) {
  notice.textContent = text;
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => { notice.textContent = ''; }, 2400);
}
function persist() {
  const saved = saveLocal(store, state);
  byId('save-status').textContent = saved ? '已保存于此浏览器 · 未上传云端' : '浏览器不允许保存 · 请勿关闭页面';
}
function commit(result) {
  if (result.state !== state) state = result.state;
  if (result.ok) { selected = -1; persist(); render(); }
  else { render(); }
  hint(result.message);
}
function maybeProduce(slot) {
  commit(produce(state, slot));
}
function touchCell(slot) {
  const item = state.board[slot];
  if (selected === -1) {
    if (!item) return;
    if (item.kind === 'producer') { maybeProduce(slot); return; }
    selected = slot;
    render();
    return;
  }
  if (selected === slot) { selected = -1; render(); return; }
  commit(moveOrMerge(state, selected, slot));
}
function formatSeconds(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60).toString().padStart(2,'0')}:${(seconds % 60).toString().padStart(2,'0')}`;
}
function renderResources(now = Date.now()) {
  byId('energy').textContent = `${state.energy} / ${MAX_ENERGY}`;
  byId('coins').textContent = state.coins.toLocaleString('zh-CN');
  byId('xp').textContent = state.xp.toLocaleString('zh-CN');
  const remaining = state.energy >= MAX_ENERGY ? '已满' : formatSeconds(ENERGY_REGEN_MS - (now - state.energyAt));
  byId('recovery').textContent = remaining;
}
function renderBoard(now = Date.now()) {
  board.replaceChildren();
  const fragment = document.createDocumentFragment();
  state.board.forEach((item, i) => {
    const button = document.createElement('button');
    button.className = `cell${item?' filled':''}${item?.kind === 'producer'?' producer':''}${selected === i?' selected':''}`;
    button.type = 'button';
    button.dataset.slot = String(i);
    if (item) {
      button.dataset.chain = item.chain;
      const icon = document.createElement('span'); icon.className = 'glyph'; icon.textContent = getItemIcon(item);
      button.append(icon);
      if (item.kind === 'material') {
        const tier = document.createElement('span'); tier.className = 'tier'; tier.textContent = `Lv.${item.tier}`;
        button.append(tier);
      } else {
        const isCooling = item.charges === 0 && item.cooldownUntil > now;
        const charge = document.createElement('span'); charge.className = 'charge';
        charge.textContent = isCooling ? '冷却中' : `${item.charges} / 12`;
        button.classList.toggle('cooldown', isCooling);
        button.append(charge);
      }
    }
    button.setAttribute('aria-label', `第${Math.floor(i/WIDTH)+1}行第${i%WIDTH+1}列，${item?getItemName(item):'空格'}${item?.tier?`，等级${item.tier}`:''}`);
    fragment.append(button);
  });
  board.append(fragment);
  byId('free-cells').textContent = `空位 ${state.board.filter(i=>!i).length} / ${CELL_COUNT}`;
}
function renderOrders() {
  orders.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const order of state.orders) {
    const card = document.createElement('article'); card.className = 'order';
    const icon = document.createElement('div'); icon.className = 'order-item';
    icon.textContent = CHAINS[order.chain].icon[order.tier - 1];
    const name = document.createElement('div'); name.className = 'order-name';
    name.textContent = CHAINS[order.chain].names[order.tier - 1];
    const prize = document.createElement('p'); prize.className = 'order-prize';
    prize.textContent = `◈ ${order.coins} · ✦ ${order.xp}`;
    const can = state.board.some(item => item?.kind === 'material' && item.chain === order.chain && item.tier === order.tier);
    const button = document.createElement('button');button.type = 'button';button.className='order-button';
    button.textContent = can ? '交付委托' : '尚缺材料';button.disabled = !can;
    button.addEventListener('click', () => commit(fulfillOrder(state, order.id)));
    card.append(icon,name,prize,button);
    fragment.append(card);
  }
  orders.append(fragment);
}
function render() { renderResources(); renderBoard(); renderOrders(); }

board.addEventListener('click', event => {
  if (ignoreNextClick) { ignoreNextClick = false; return; }
  const cell = event.target.closest('[data-slot]');
  if (cell && board.contains(cell)) touchCell(Number(cell.dataset.slot));
});
board.addEventListener('pointerdown', event => {
  const cell = event.target.closest('[data-slot]');
  if (!cell || event.button > 0) return;
  const index = Number(cell.dataset.slot);
  const item = state.board[index];
  if (!item || item.kind !== 'material') return;
  cell.setPointerCapture?.(event.pointerId);
  drag = { id: event.pointerId, origin: index, startX: event.clientX, startY: event.clientY, moved: false, ghost: null };
});
board.addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.id) return;
  const dist = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
  if (!drag.moved && dist < 9) return;
  if (!drag.moved) {
    drag.moved = true;
    const ghost = document.createElement('div');ghost.className = 'drag-ghost';
    ghost.textContent = getItemIcon(state.board[drag.origin]);
    document.body.append(ghost);drag.ghost = ghost;
  }
  drag.ghost.style.left = `${event.clientX}px`;
  drag.ghost.style.top = `${event.clientY}px`;
});
function completeDrag(event, cancelled = false) {
  if (!drag || event.pointerId !== drag.id) return;
  const { origin, moved, ghost } = drag;
  drag = null;
  ghost?.remove();
  if (!moved || cancelled) return;
  ignoreNextClick = true;
  // Drag processing must not be followed by the browser's synthetic click.
  setTimeout(() => { ignoreNextClick = false; }, 0);
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-slot]');
  if (target && board.contains(target)) {
    const result = moveOrMerge(state, origin, Number(target.dataset.slot));
    if (result.ok) commit(result);
    else { render(); hint(result.message); }
  }
}
board.addEventListener('pointerup', event => completeDrag(event));
board.addEventListener('pointercancel', event => completeDrag(event, true));

byId('reset').addEventListener('click', () => {
  if (!window.confirm('确定重置本地试玩进度吗？当前棋盘、金币和订单会被清空，且无法恢复。')) return;
  state = createInitialState();
  selected = -1;
  persist(); render(); hint('已重置试玩进度');
});
const dialog = byId('guide');
byId('how-to').addEventListener('click', () => dialog.showModal());
byId('close-guide').addEventListener('click', () => dialog.close());
// Local preview has no account/session hooks and intentionally sends no game data to the network.
window.addEventListener('storage', event => {
  if (event.key !== SAVE_KEY || !store) return;
  const fresh = loadLocal(store);
  if (fresh.recovered && fresh.state.revision > state.revision) {
    state = advanceTime(fresh.state);selected = -1;render();hint('已从其他标签页恢复更新进度');
  }
});
window.setInterval(() => {
  const updated = advanceTime(state);
  if (updated !== state) { state = updated;persist();render(); }
  else renderResources();
}, 1000);
persist(); render();
if (!loaded.recovered) hint('欢迎来到云屿百物铺！试试合成两片茶芽。');