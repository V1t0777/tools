import { WIDTH, CELL_COUNT, MAX_ENERGY, ENERGY_REGEN_MS, CHAINS, createInitialState,
  advanceTime, moveOrMerge, produce, fulfillOrder, getItemIcon, getItemName,
  storeItem, withdrawItem, upgradeWarehouse, upgradeProducer, upgradeBuilding,
  getLevelProgress, getMaxOrderTier, getProducerUpgrade, getWarehouseUpgrade } from './engine.mjs';
import { BUILDINGS } from './economy.mjs';
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
let saveIssue = loaded.blocked ? loaded.reason : null;
let persistedRaw = loaded.raw;
if (loaded.migrated) window.setTimeout(() => hint('已保留旧版试玩进度，并升级为 P2 存档'), 250);

function hint(text) {
  notice.textContent = text;
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => { notice.textContent = ''; }, 2400);
}
function persist({confirmedReset=false}={}) {
  const saved = saveLocal(store, state, {allowReset:confirmedReset, expectedRaw:persistedRaw});
  if (saved) { saveIssue = null; persistedRaw = JSON.stringify(state); }
  else saveIssue ??= 'WRITE_FAILED';
  byId('save-status').textContent = saved ? '已保存于此浏览器 · 未上传云端'
    : saveIssue === 'CORRUPT_SAVE' ? '检测到异常存档，原始数据已保留；确认重置后才会覆盖'
    : '无法安全保存，原始存档未被覆盖 · 请勿关闭页面';
  return saved;
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
  const progress = getLevelProgress(state.xp);
  byId('level').textContent = `Lv.${progress.level}`;
  byId('level-progress').textContent = progress.next === null ? '已达到当前等级上限' : `升级还需 ${progress.next - state.xp} 经验`;
  byId('tier-cap').textContent = `当前委托最高 ${getMaxOrderTier(state.xp)} 阶`;
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
    prize.textContent = `◈ ${order.coins} · ✦ ${order.xp} · 估算体力 ${order.estimatedEnergy || '—'}`;
    const can = state.board.some(item => item?.kind === 'material' && item.chain === order.chain && item.tier === order.tier);
    const button = document.createElement('button');button.type = 'button';button.className='order-button';
    button.textContent = can ? '交付委托' : '尚缺材料';button.disabled = !can;
    button.addEventListener('click', () => commit(fulfillOrder(state, order.id)));
    card.append(icon,name,prize,button);
    fragment.append(card);
  }
  orders.append(fragment);
}

function actionButton(label, description, action, disabled = false) {
  const row = document.createElement('div'); row.className = 'upgrade-row';
  const detail = document.createElement('div');
  const title = document.createElement('strong'); title.textContent = label;
  const text = document.createElement('p'); text.textContent = description;
  detail.append(title, text);
  const btn = document.createElement('button'); btn.type = 'button';btn.className='small-action';
  btn.disabled = disabled;btn.textContent = disabled ? '暂不可用' : '解锁 / 升级';
  if(!disabled)btn.addEventListener('click',action);
  row.append(detail, btn);return row;
}
function renderSystems() {
  const warehouse = byId('warehouse');warehouse.replaceChildren();
  const slots=document.createDocumentFragment();
  state.warehouse.slots.forEach((item,i)=>{
    const btn=document.createElement('button');btn.type='button';
    btn.className = `warehouse-slot${i>=state.warehouse.capacity?' locked':''}`;
    btn.disabled=!item || i>=state.warehouse.capacity;
    btn.title = item ? `取出${getItemName(item)}` : i>=state.warehouse.capacity ? '尚未解锁' : '空位';
    btn.setAttribute('aria-label',btn.title);
    btn.textContent = i>=state.warehouse.capacity?'🔒':item?getItemIcon(item):'＋';
    if(item)btn.addEventListener('click',()=>commit(withdrawItem(state,i)));
    slots.append(btn);
  });warehouse.append(slots);
  byId('warehouse-count').textContent=`${state.warehouse.slots.filter(Boolean).length}/${state.warehouse.capacity}`;
  const selectedItem=state.board[selected];
  byId('store-selected').disabled = selectedItem?.kind!=='material' ||
    state.warehouse.slots.slice(0,state.warehouse.capacity).every(Boolean);
  const w= getWarehouseUpgrade(state.warehouse.capacity);
  const wbtn=byId('warehouse-upgrade');
  wbtn.textContent=w?`扩容至 ${w.newCapacity} 格 · ${w.coins} 金币（Lv.${w.minLevel}）`:'仓库已满级';
  wbtn.disabled = !w || state.coins < w.coins || getLevelProgress(state.xp).level < w.minLevel;
  const upgrades=byId('producers');upgrades.replaceChildren();
  const buildings=byId('buildings');buildings.replaceChildren();
  const level=getLevelProgress(state.xp).level;
  for(const p of state.board.filter(item=>item?.kind==='producer')){
    const rule=getProducerUpgrade(p.level);
    upgrades.append(actionButton(`${CHAINS[p.chain].name}工坊 · Lv.${p.level}`,
      rule?`${rule.coins} 金币 · 需要 Lv.${rule.minLevel} · 下一等级提升高阶产物概率`:'生产器已达到最高等级',
      ()=>commit(upgradeProducer(state,p.id)),!rule||state.coins<rule.coins||level<rule.minLevel));
  }
  for(const [id,rule] of Object.entries(BUILDINGS)){
    const complete=state.buildings[id]===1;
    buildings.append(actionButton(`${rule.name}${complete?' · 已建成':''}`,
      complete?'此区域已完成基础建设':`${rule.coins} 金币 · 需要 Lv.${rule.minLevel}`,
      ()=>commit(upgradeBuilding(state,id)),complete||state.coins<rule.coins||level<rule.minLevel));
  }
}
function render() { renderResources(); renderBoard(); renderOrders(); renderSystems(); }

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

byId('store-selected').addEventListener('click',()=>{
  if(selected < 0){hint('先点击选择一个原料');return;}
  commit(storeItem(state,selected));
});
byId('warehouse-upgrade').addEventListener('click',()=>commit(upgradeWarehouse(state)));

byId('reset').addEventListener('click', () => {
  const warning = saveIssue
    ? '当前存档无法安全保存。重置会永久覆盖原始存档数据（可能仍可人工修复），确定继续吗？'
    : '确定重置本地试玩进度吗？当前棋盘、金币和订单会被清空，且无法恢复。';
  if (!window.confirm(warning)) return;
  state = createInitialState();
  selected = -1;
  const saved = persist({confirmedReset:true}); render();
  hint(saved ? '已重置试玩进度' : '重置未保存，请勿关闭页面');
});
const dialog = byId('guide');
byId('how-to').addEventListener('click', () => dialog.showModal());
byId('close-guide').addEventListener('click', () => dialog.close());
// Local preview has no account/session hooks and intentionally sends no game data to the network.
window.addEventListener('storage', event => {
  if (event.key !== SAVE_KEY || !store) return;
  const fresh = loadLocal(store);
  if (fresh.blocked) {
    saveIssue = fresh.reason;persist();return;
  }
  // Same-revision saves can still differ (e.g. energy recharge); do not
  // overwrite them using a stale tab's old raw bytes.
  if (fresh.recovered && fresh.raw !== persistedRaw &&
      fresh.state.revision >= state.revision) {
    if (saveIssue) { hint('其他标签页更新了存档，当前页面存在未保存进度'); return; }
    state = advanceTime(fresh.state); persistedRaw = fresh.raw;
    selected = -1; persist(); render(); hint('已从其他标签页恢复更新进度');
  }
});
window.setInterval(() => {
  const updated = advanceTime(state);
  if (updated !== state) { state = updated;persist();render(); }
  else renderResources();
}, 1000);
persist(); render();
if (loaded.blocked) hint('本地存档无法安全恢复，原始数据不会自动覆盖');
else if (!loaded.recovered) hint('欢迎来到云屿百物铺！试试合成两片茶芽。');