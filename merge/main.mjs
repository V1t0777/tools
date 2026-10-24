import { WIDTH, CELL_COUNT, MAX_ENERGY, ENERGY_REGEN_MS, CHAINS, createInitialState,
  advanceTime, moveOrMerge, produce, fulfillOrder, getItemIcon, getItemName,
  storeItem, withdrawItem, upgradeWarehouse, upgradeProducer, upgradeBuilding,
  getLevelProgress, getMaxOrderTier, getProducerUpgrade, getWarehouseUpgrade,
  SUPPLY_ITEMS, ACHIEVEMENT_RULES, useSupply, purchaseSupply } from './engine.mjs';
import { BUILDINGS } from './economy.mjs';
import { loadLocal, saveLocal, SAVE_KEY } from './storage.mjs';
import { getBoardGuidance } from './board-guidance.mjs';
import { getSupplyControlSnapshot } from './supply-controls.mjs';
import { deriveNormalMilestones } from './normal-milestones.mjs';
import { prepareLocalSaveExport } from './save-export.mjs';

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
let activeGuidance = null;
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
  if (result.ok) { selected = -1; activeGuidance = null; persist(); render(); }
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
    button.className = `cell${item?' filled':''}${item?.kind === 'producer'?' producer':''}${selected === i?' selected':''}${activeGuidance?.boardSlots.includes(i)?' guidance-target':''}`;
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
    if (activeGuidance?.boardSlots.includes(i)) button.setAttribute('aria-label', button.getAttribute('aria-label') + '，整理提示标记');
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
    button.classList.toggle('guidance-target', activeGuidance?.orderId === order.id);
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
    btn.className = `warehouse-slot${i>=state.warehouse.capacity?' locked':''}${activeGuidance?.warehouseSlot===i?' guidance-target':''}`;
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
  wbtn.classList.toggle('guidance-target', !!activeGuidance?.warehouseUpgrade);
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
/** Update cooldown eligibility on selection and every clock tick.
 * Avoid rebuilding a focused select or supply cards while the timer runs.
 */
function refreshSupplyControls(now=Date.now()) {
  const select=byId('supply-producer');
  const snapshot=getSupplyControlSnapshot(state,select.value,now);
  const sameOptions=select.options.length===snapshot.options.length &&
    snapshot.options.every((option,i)=>select.options[i]?.value===option.id);
  if(!sameOptions){
    const fragment=document.createDocumentFragment();
    for(const item of snapshot.options){
      const option=document.createElement('option');
      option.value=item.id;option.textContent=item.label;
      fragment.append(option);
    }
    select.replaceChildren(fragment);
  }
  if(select.value!==snapshot.producerId)select.value=snapshot.producerId??'';
  for(let i=0;i<snapshot.options.length;i++){
    const option=select.options[i];
    if(option.textContent!==snapshot.options[i].label)
      option.textContent=snapshot.options[i].label;
  }
  const status=byId('supply-cooldown-status');
  const message=!snapshot.producerName?'没有可用工坊'
    :snapshot.cooling
      ?`${snapshot.producerName}剩余冷却 ${snapshot.remainingSeconds} 秒`
      :`${snapshot.producerName}当前无需冷却道具`;
  if(status.textContent!==message)status.textContent=message;
  const bag=byId('supply-bag');
  for(const [id,usable] of Object.entries(snapshot.usable)){
    const button=bag.querySelector(`[data-supply-use="${id}"]`);
    if(button)button.disabled=!usable;
  }
}
function renderSupplies(now=Date.now()) {
  const select=byId('supply-producer');
  const bag=byId('supply-bag');bag.replaceChildren();
  const shop=byId('supply-shop');shop.replaceChildren();
  for(const [id,def] of Object.entries(SUPPLY_ITEMS)){
    const owned=state.bag[id];
    const row=document.createElement('div');row.className='supply-row';
    const details=document.createElement('div');
    const title=document.createElement('strong');
    title.textContent=`${def.icon} ${def.name} · ×${owned}`;
    const sub=document.createElement('p');sub.textContent=def.effect;
    details.append(title,sub);
    const button=document.createElement('button');
    button.type='button';button.className='small-action';
    button.disabled=true;
    button.dataset.supplyUse=id;
    button.textContent='使用';
    button.setAttribute('aria-label',`使用${def.name}，当前有${owned}个`);
    button.addEventListener('click',()=>commit(useSupply(state,id,select.value)));
    row.append(details,button);bag.append(row);

    const used=state.shop.purchases[id];
    const remaining=def.limit-used;
    const sale=document.createElement('div');sale.className='supply-row';
    const saleDetails=document.createElement('div');
    const saleTitle=document.createElement('strong');saleTitle.textContent=`${def.icon} ${def.name}`;
    const saleInfo=document.createElement('p');
    saleInfo.textContent=`${def.price} 金币 · 剩余 ${remaining}/${def.limit}`;
    saleDetails.append(saleTitle,saleInfo);
    const buy=document.createElement('button');
    buy.type='button';buy.className='small-action';
    buy.disabled=remaining<=0||state.coins<def.price;
    buy.textContent=remaining<=0?'已售罄':'兑换';
    buy.setAttribute('aria-label',`用${def.price}金币兑换${def.name}`);
    buy.addEventListener('click',()=>commit(purchaseSupply(state,id)));
    sale.append(saleDetails,buy);shop.append(sale);
  }
  const milestones=byId('supply-achievements');milestones.replaceChildren();
  for(const rule of ACHIEVEMENT_RULES){
    const line=document.createElement('div');line.className='supply-milestone';
    const done=state.achievements[rule.id]===1;
    line.textContent=`${done?'✓':'○'} ${rule.title} · ${rule.counter==='orders'?'完成委托':'合成'} ${Math.min(rule.threshold,state.progress[rule.counter])}/${rule.threshold} · ${SUPPLY_ITEMS[rule.reward].name} ×1${done?'（已领取）':''}`;
    milestones.append(line);
  }
  refreshSupplyControls(now);
}
const normalMilestoneLabels=Object.freeze({
  'orders-50':'街坊熟客 · 50 单',
  'orders-200':'街坊信赖 · 200 单',
  'orders-800':'远洋声望 · 800 单',
  'merges-150':'巧手初成 · 150 次合成',
  'merges-600':'工艺渐精 · 600 次合成',
  'merges-2400':'百物匠心 · 2400 次合成',
  'buildings-all':'海湾建设 · 三处街区',
  'warehouse-full':'库房扩建 · 八格仓库',
  'workshops-mastered':'工坊精进 · 三座满级工坊'
});
function renderNormalMilestones() {
  const container=byId('normal-milestones');
  const summary=byId('normal-milestone-summary');
  const fragment=document.createDocumentFragment();
  try{
    const report=deriveNormalMilestones(state);
    for(const milestone of report.milestones){
      const item=document.createElement('div');
      item.className='normal-milestone-row';
      const name=document.createElement('strong');
      name.textContent=normalMilestoneLabels[milestone.id]??milestone.id;
      const details=document.createElement('span');
      details.className='normal-milestone-count';
      details.textContent=milestone.complete?'已完成 · 无额外奖励':
        `${milestone.progress} / ${milestone.target}`;
      const bar=document.createElement('progress');
      bar.max=milestone.target;
      bar.value=milestone.progress;
      bar.setAttribute('aria-label',`${name.textContent}：${milestone.percent}%`);
      item.append(name,details,bar);
      fragment.append(item);
    }
    summary.textContent=`${report.completedCount} / ${report.totalCount} 已完成`;
  }catch{
    const note=document.createElement('p');
    note.className='help-line';
    note.textContent='存档状态异常，暂不能计算经营目标；请保留原始存档。';
    summary.textContent='进度不可用';
    fragment.append(note);
  }
  container.replaceChildren(fragment);
}
function render() {
  renderResources(); renderBoard(); renderOrders(); renderSystems(); renderSupplies(); renderNormalMilestones();
  byId('guidance-message').textContent = activeGuidance?.message ??
    '棋盘太满时，可以点“整理提示”寻找合法操作。只提示，不自动操作。';
  byId('board-guide').setAttribute('aria-pressed', String(!!activeGuidance));
}

byId('board-guide').addEventListener('click', () => {
  if (activeGuidance) { activeGuidance = null; render(); return; }
  try { activeGuidance = getBoardGuidance(state); selected = -1; render(); }
  catch { hint('存档状态异常，请保留原始数据，不要重置'); }
});

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
byId('supply-producer').addEventListener('change',()=>refreshSupplyControls());

byId('export-local-save').addEventListener('click', () => {
  const result=prepareLocalSaveExport(store);
  if(!result.ok){
    hint(result.reason==='NO_SAVED_DATA'?'此浏览器还没有可导出的存档':
      result.reason==='EXPORT_TOO_LARGE'?'原始存档超过安全导出上限，请勿重置或清理浏览器数据':
      '浏览器存储不可访问，无法读取原始存档');
    return;
  }
  let url=null;
  try{
    const blob=new Blob([result.content],{type:result.mime});
    url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;
    link.download=result.filename;
    document.body.append(link);
    try{link.click();}finally{link.remove();}
    // iOS Safari may start a download asynchronously; avoid early revocation.
    const downloadUrl=url;
    window.setTimeout(()=>URL.revokeObjectURL(downloadUrl),30_000);
    url=null;
    hint(result.verified?'已请求下载当前浏览器的原始存档':'原始数据可能异常，已请求下载文本备份；请勿直接作为有效存档导入');
  }catch{
    if(url)URL.revokeObjectURL(url);
    hint('浏览器未能启动下载，请勿重置或清理存档');
  }
});

byId('reset').addEventListener('click', () => {
  const warning = saveIssue
    ? '当前存档无法安全保存。重置会永久覆盖原始存档数据（可能仍可人工修复），确定继续吗？'
    : '确定重置本地试玩进度吗？当前棋盘、金币和订单会被清空，且无法恢复。';
  if (!window.confirm(warning)) return;
  const beforeReset=state;
  state = createInitialState();
  selected = -1; activeGuidance = null;
  const saved = persist({confirmedReset:true});
  if (!saved) {
    // Do not display an unsaved blank board as if the reset succeeded.
    state=beforeReset;
    render();
    hint('重置已中止：存档可能被其他标签页修改或写入受限，请重新打开页面核对');
    return;
  }
  render();
  hint('已重置试玩进度');
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
    state = advanceTime(fresh.state); persistedRaw = fresh.raw; activeGuidance = null;
    selected = -1; persist(); render(); hint('已从其他标签页恢复更新进度');
  }
});
window.setInterval(() => {
  const now=Date.now();
  const updated = advanceTime(state,now);
  if (updated !== state) { state = updated; if (activeGuidance) activeGuidance = getBoardGuidance(state);persist();render(); }
  else {renderResources(now);refreshSupplyControls(now);}
}, 1000);
persist(); render();
if (loaded.blocked) hint('本地存档无法安全恢复，原始数据不会自动覆盖');
else if (!loaded.recovered) hint('欢迎来到云屿百物铺！试试合成两片茶芽。');