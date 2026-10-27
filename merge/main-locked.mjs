import { WIDTH, CELL_COUNT, MAX_ENERGY, ENERGY_REGEN_MS, CHAINS, createInitialState,
  moveOrMerge, produce, fulfillOrder, getItemIcon, getItemName,
  storeItem, withdrawItem, upgradeWarehouse, upgradeProducer, upgradeBuilding,
  getLevelProgress, getMaxOrderTier, getProducerUpgrade, getWarehouseUpgrade,
  SUPPLY_ITEMS, ACHIEVEMENT_RULES, useSupply, purchaseSupply } from './engine.mjs';
import { BUILDINGS } from './economy.mjs';
import { SAVE_KEY } from './storage.mjs';
import { getBoardGuidance } from './board-guidance.mjs';
import { getSupplyControlSnapshot } from './supply-controls.mjs';
import { deriveNormalMilestones } from './normal-milestones.mjs';
import { prepareLocalSaveExport, prepareAbnormalResetBackupExport } from './save-export.mjs';
import { requestBrowserSaveDownload } from './save-download.mjs';
import { createNormalPageRuntime } from './normal-page-runtime.mjs';
import { attachNormalPageLifecycle } from './normal-page-lifecycle.mjs';

const byId = id => document.getElementById(id);
const board = byId('board');
const orders = byId('orders');
const notice = byId('notice');
const store = (() => { try { return window.localStorage; } catch { return null; } })();
// Read-only original bytes for an explicitly confirmed abnormal reset.
// The locked reset compares the exact bytes again before any overwrite.
const initialOriginalRaw=(()=>{try{return store?.getItem(SAVE_KEY)??null;}catch{return null;}})();
let state=createInitialState(),selected=-1,drag=null,ignoreNextClick=false;
let renderGeneration=0;
let noticeTimer=0,activeGuidance=null,saveIssue='STARTUP_REQUIRED',persistedRaw=null;
const runtime=createNormalPageRuntime({
  storage:store,locks:window.navigator?.locks??null,
  onVerified(next,raw,kind){
    const changed=raw!==persistedRaw;
    state=next;persistedRaw=raw;saveIssue=null;
    if(kind!=='clock'||changed){
      selected=-1;activeGuidance=null;render();
    }else{renderResources();refreshSupplyControls();}
    byId('save-status').textContent=kind==='external'
      ?'已同步其他标签页进度 · 未上传云端'
      :'已保存于此浏览器 · 未上传云端';
  }
});
let lifecycle=null;
const pageSuspended=()=>document.hidden||lifecycle?.suspended===true;

function hint(text) {
  notice.textContent = text;
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => { notice.textContent = ''; }, 2400);
}
// All four ordinary writers are coordinated by the same exclusive Web Lock.
function cancelStaleGesture(){
  if(!drag)return;
  drag.ghost?.remove();drag=null;ignoreNextClick=true;
}
function pauseUnsafe(reason,message='存档状态未确认，已暂停操作；请备份并重新打开页面核对'){
  saveIssue=reason||'SAVE_UNCERTAIN';
  cancelStaleGesture();selected=-1;activeGuidance=null;
  byId('save-status').textContent=saveIssue==='CORRUPT_SAVE'
    ?'检测到异常存档，原始数据已保留；确认重置后才会覆盖'
    :'无法确认安全保存 · 游戏操作已暂停，请备份并重新打开页面核对';
  render();hint(message);
}
function handleTransactionResult(result,kind){
  if(result?.ok){if(kind==='action'&&result.message)hint(result.message);return;}
  if(result?.reason==='ACTION_REJECTED'){
    render();hint(result.message||'当前操作无法完成');return;
  }
  if(result?.reason==='SAVE_LOCK_BUSY'||result?.reason==='UI_TRANSACTION_BUSY'){
    hint('正在安全保存或其他标签页占用存档，请稍后重试');return;
  }
  pauseUnsafe(result?.reason||'SAVE_UNCERTAIN',kind==='reset'
    ?'重置未能确认安全完成；请先导出原始存档并重新打开页面核对'
    :'操作未确认保存，已暂停写入；请先备份并重新打开页面核对');
}
async function commit(operation){
  if(pageSuspended()){hint('页面处于后台，请返回并核验进度后重试');return;}
  if(saveIssue||runtime.busy){hint('存档尚未就绪或正在安全保存，请稍后重试');return;}
  // A newly adopted cross-tab snapshot invalidates the old UI button's
  // captured target, even if its revision is otherwise safe to adopt.
  if(!revalidateResumedSave())return;
  try{handleTransactionResult(await runtime.action(operation),'action');}
  catch{pauseUnsafe('ACTION_OUTCOME_UNCERTAIN');}
}
function maybeProduce(slot) {
  commit(current=>produce(current, slot));
}
function touchCell(slot) {
  // Storage events can be delayed: verify actual bytes before accepting a
  // tap or keyboard selection, even if the page never lost focus.
  if (!revalidateResumedSave()) {
    hint('存档已更新或正在保存，请在最新棋盘上重新操作');return;
  }
  const item = state.board[slot];
  if (selected === -1) {
    if (!item) return;
    if (item.kind === 'producer') { maybeProduce(slot); return; }
    selected = slot;
    render();
    return;
  }
  if (selected === slot) { selected = -1; render(); return; }
  const origin=selected;
  commit(current=>moveOrMerge(current, origin, slot));
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
// Detached DOM controls can still receive queued events after a storage,
// BFCache or clock-driven rerender. Bind each generated action to its render.
// A stale event is never replayed against the newly adopted game state.
function guardRenderedAction(action){
  const generation=renderGeneration;
  return ()=>{
    if(generation!==renderGeneration){
      hint('界面已更新，请在最新界面重新操作');
      return;
    }
    action();
  };
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
    button.addEventListener('click',guardRenderedAction(
      ()=>commit(current=>fulfillOrder(current, order.id))));
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
  if(!disabled)btn.addEventListener('click',guardRenderedAction(action));
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
    if(item)btn.addEventListener('click',guardRenderedAction(
      ()=>commit(current=>withdrawItem(current,i))));
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
      ()=>commit(current=>upgradeProducer(current,p.id)),!rule||state.coins<rule.coins||level<rule.minLevel));
  }
  for(const [id,rule] of Object.entries(BUILDINGS)){
    const complete=state.buildings[id]===1;
    buildings.append(actionButton(`${rule.name}${complete?' · 已建成':''}`,
      complete?'此区域已完成基础建设':`${rule.coins} 金币 · 需要 Lv.${rule.minLevel}`,
      ()=>commit(current=>upgradeBuilding(current,id)),complete||state.coins<rule.coins||level<rule.minLevel));
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
    button.addEventListener('click',guardRenderedAction(()=>{
      // Snapshot the chosen producer before the asynchronous Web Lock wait.
      // A later selection change must not redirect this already-queued tap.
      const producerId=select.value;
      commit(current=>useSupply(current,id,producerId));
    }));
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
    buy.addEventListener('click',guardRenderedAction(
      ()=>commit(current=>purchaseSupply(current,id))));
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
  renderGeneration++;
  renderResources(); renderBoard(); renderOrders(); renderSystems(); renderSupplies(); renderNormalMilestones();
  byId('guidance-message').textContent = activeGuidance?.message ??
    '棋盘太满时，可以点“整理提示”寻找合法操作。只提示，不自动操作。';
  byId('board-guide').setAttribute('aria-pressed', String(!!activeGuidance));
}

byId('board-guide').addEventListener('click', () => {
  if (saveIssue || runtime.busy) { hint('存档尚未就绪或正在保存，整理提示已暂停'); return; }
  // A read-only hint must also use the latest verified board. Delayed
  // storage events must never leave a guidance overlay on an old snapshot.
  if (!revalidateResumedSave()) {
    hint('存档已更新，请在最新棋盘上重新请求整理提示');
    return;
  }
  if (activeGuidance) { activeGuidance = null; render(); return; }
  try { activeGuidance = getBoardGuidance(state); selected = -1; render(); }
  catch { hint('存档状态异常，请保留原始数据，不要重置'); }
});

board.addEventListener('click', event => {
  // Keyboard activation has detail === 0 and cannot be a canceled drag's
  // synthetic pointer click. Never swallow it as a stale gesture.
  if (ignoreNextClick && event.detail !== 0) { ignoreNextClick = false; return; }
  const cell = event.target.closest('[data-slot]');
  if (cell && board.contains(cell)) touchCell(Number(cell.dataset.slot));
});
board.addEventListener('pointerdown', event => {
  // Never start a drag against a board whose saved baseline is untrusted.
  if (saveIssue || runtime.busy) return;
  if (event.button > 0) return;
  // A storage event may not yet have arrived from another tab. Never capture
  // a pointer against an unverified board; this inspection is read-only.
  if(!revalidateResumedSave())return;
  // A genuine new pointerdown starts a new gesture. The canceled pointer's
  // delayed synthetic click has no second pointerdown, so allow this tap.
  ignoreNextClick = false;
  const cell = event.target.closest('[data-slot]');
  if (!cell) return;
  const index = Number(cell.dataset.slot);
  const item = state.board[index];
  if (!item || item.kind !== 'material') return;
  cell.setPointerCapture?.(event.pointerId);
  drag = { id: event.pointerId, origin: index, startX: event.clientX, startY: event.clientY, moved: false, ghost: null };
});
board.addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.id) return;
  // A save may begin while a pointer is held. Never keep showing a ghost
  // for a gesture that can no longer safely commit.
  if (saveIssue || runtime.busy) { cancelStaleGesture(); return; }
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
  // A canceled pointer (scroll, OS interruption, browser gesture) must not
  // become a late compatibility click. The next genuine pointerdown clears
  // this guard; keyboard activation (detail === 0) is never suppressed.
  if (cancelled) { ignoreNextClick = true; return; }
  if (!moved) return;
  // Mobile browsers may dispatch a synthetic click in a later task.
  // Keep the guard until that click is consumed or a genuine new pointerdown
  // begins; a zero-delay timer can clear it before the delayed click arrives.
  ignoreNextClick = true;
  // The save may change after pointerdown while the pointer is moving and
  // before a delayed storage event arrives. Recheck exact bytes at drop time
  // before resolving the target or computing a move against an old board.
  // A blocked drop still consumes its delayed synthetic click.
  if(!revalidateResumedSave())return;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-slot]');
  if (target && board.contains(target)) {
    // Keep the drop's raw-save check, then defer the engine action to the
    // same preflight gateway used by every other ordinary-mode action.
    // A different tab can still replace storage during hit testing.
    const targetSlot = Number(target.dataset.slot);
    commit(current=>moveOrMerge(current, origin, targetSlot));
  }
}
board.addEventListener('pointerup', event => completeDrag(event));
board.addEventListener('pointercancel', event => completeDrag(event, true));

// Mobile browsers can suspend a page mid-drag without delivering pointerup.
// Drop the stale gesture when the page is hidden; never move a board item or
// write a save based on a pointer that began before backgrounding.
// Both visibility restoration and BFCache pageshow must validate the actual
// saved bytes before the resumed tab can advance its clock or accept actions.
function revalidateResumedSave(){
  if(pageSuspended()||saveIssue||runtime.busy||runtime.phase!=='ready')return false;
  const result=runtime.reconcile();
  if(!result.ok){
    pauseUnsafe(result.reason,
      '检测到跨标签或后台存档变化，已暂停操作；请备份并重新打开页面核对');
    return false;
  }
  if(result.changed){
    // A verified external update is safe to DISPLAY, but the input event
    // that discovered it was created against an older DOM/board. Do not
    // reinterpret that event as a fresh action on the newly adopted state.
    cancelStaleGesture();
    selected=-1;activeGuidance=null;
    // onVerified('external') already rendered the adopted state.
    hint('已同步其他标签页进度，请在最新棋盘上重新操作');
    return false;
  }
  return true;
}
byId('store-selected').addEventListener('click',()=>{
  if(selected < 0){hint('先点击选择一个原料');return;}
  const slot=selected;
  commit(current=>storeItem(current,slot));
});
byId('warehouse-upgrade').addEventListener('click',()=>commit(current=>upgradeWarehouse(current)));
byId('supply-producer').addEventListener('change',()=>refreshSupplyControls());

byId('export-local-save').addEventListener('click', () => {
  const result=prepareLocalSaveExport(store);
  if(!result.ok){
    hint(result.reason==='NO_SAVED_DATA'?'此浏览器还没有可导出的存档':
      result.reason==='EXPORT_TOO_LARGE'?'原始存档超过安全导出上限，请勿重置或清理浏览器数据':
      result.reason==='EXPORT_ENCODING_UNAVAILABLE'?'当前浏览器无法安全编码备份文件，请勿重置或清理存档':
      '浏览器存储不可访问，无法读取原始存档');
    return;
  }
  const download=requestBrowserSaveDownload(result,{
    schedule:(fn,ms)=>window.setTimeout(fn,ms)
  });
  if(!download.ok){
    hint(download.reason==='DOWNLOAD_LIMIT_REACHED'
      ?'下载过于频繁，临时链接尚未清理；请稍后再试，勿重置或清理存档'
      :download.reason==='DOWNLOAD_TOO_LARGE'
        ?'备份文件超过浏览器安全下载上限，请勿重置或清理存档'
        :download.reason==='DOWNLOAD_UNSUPPORTED'
          ?'当前浏览器不支持此下载方式，请勿重置或清理存档'
          :'浏览器未能启动下载，请勿重置或清理存档');
    return;
  }
  const message=result.wrapped
    ?'检测到异常字符，已请求下载可还原原始字符的 JSON 封装备份；不可直接导入'
    :result.verified
      ?'已请求下载当前浏览器的原始存档，请核实文件已保存'
      :'原始数据可能异常，已请求下载文本备份；请勿直接作为有效存档导入';
  hint(download.cleanupDeferred
    ?message+'；浏览器未能安排临时链接清理'
    :message);
});


byId('export-abnormal-reset-backup').addEventListener('click', () => {
  const result=prepareAbnormalResetBackupExport(store);
  if(!result.ok) {
    hint(result.reason==='NO_SAVED_DATA'?'此浏览器没有异常重置前备份':
      result.reason==='EXPORT_TOO_LARGE'?'重置前备份超过导出大小上限，请勿清理浏览器数据':
      '无法读取或编码重置前备份，请勿清理浏览器数据');
    return;
  }
  const download=requestBrowserSaveDownload(result,{
    schedule:(fn,ms)=>window.setTimeout(fn,ms)
  });
  if(!download.ok){
    hint(download.reason==='DOWNLOAD_LIMIT_REACHED'
      ?'下载过于频繁，临时链接尚未清理；请稍后再试，勿清理存档'
      :download.reason==='DOWNLOAD_TOO_LARGE'
        ?'重置前备份超过浏览器安全下载上限，请勿清理存档'
        :download.reason==='DOWNLOAD_UNSUPPORTED'
          ?'当前浏览器不支持此下载方式，请勿清理存档'
          :'浏览器未能启动重置前备份下载，请勿清理存档');
    return;
  }
  const message=result.wrapped
    ?'已请求下载异常字符的 JSON 封装备份，请核实文件并勿直接导入'
    :'已请求下载异常重置前的原始备份，请核实文件存在与内容完整';
  hint(download.cleanupDeferred
    ?message+'；浏览器未能安排临时链接清理'
    :message);
});

byId('reset').addEventListener('click',async()=>{
  if(pageSuspended()){hint('页面处于后台，请返回并核验进度后重试');return;}
  if(runtime.busy){hint('正在保存，暂不能重置');return;}
  const damaged=saveIssue==='CORRUPT_SAVE'||saveIssue==='UNSUPPORTED_OR_CORRUPT_SAVE';
  if(saveIssue&&!damaged){
    hint('当前进度存在冲突或锁不可用，请先导出原始存档并重新打开页面核对');return;
  }
  if(!window.confirm(damaged
    ?'存档异常：将先核实并保留原始备份，再重置普通模式。建议先下载原始文件，确定继续吗？'
    :'确定重置本地试玩进度吗？当前棋盘、金币和订单会被清空，且无法恢复。'))return;
  if(pageSuspended()){hint('页面已切换，重置已取消；请返回并重新确认');return;}
  cancelStaleGesture();
  try{
    const result=await runtime.reset({confirmed:true,
      ...(damaged?{expectedRaw:initialOriginalRaw,requireOriginalBackup:true}:{}),
      now:Date.now()});
    if(result.ok)hint('已重置试玩进度');
    else handleTransactionResult(result,'reset');
  }catch{pauseUnsafe('RESET_OUTCOME_UNCERTAIN');}
});
const dialog = byId('guide');
byId('how-to').addEventListener('click', () => dialog.showModal());
byId('close-guide').addEventListener('click', () => dialog.close());
// The lifecycle bridge performs read-only storage/focus/BFCache reconciliation.
if(store)lifecycle=attachNormalPageLifecycle({
  runtime,win:window,doc:document,storage:store,
  cancelGesture(){cancelStaleGesture();selected=-1;activeGuidance=null;},
  onResult(result){
    if(!result.ok)pauseUnsafe(result.reason,
      '跨标签或后台存档状态异常，已暂停操作；请备份并重新打开页面核对');
    else if(result.changed)hint('已从其他标签页读取更新进度');
  }
});
let timerPending=false;
window.setInterval(async()=>{
  if(pageSuspended()||saveIssue||runtime.busy||timerPending)return;
  timerPending=true;
  try{
    if(!revalidateResumedSave())return;
    handleTransactionResult(await runtime.clock({now:Date.now()}),'clock');
  }catch{pauseUnsafe('CLOCK_OUTCOME_UNCERTAIN');}
  finally{timerPending=false;}
},1000);
byId('save-status').textContent='正在核验本地进度 · 暂不可操作';
render();
void runtime.start().then(result=>{
  if(!result.ok){
    pauseUnsafe(result.reason||'STARTUP_UNCERTAIN',
      '本地存档无法安全恢复或确认写入，原始数据不会自动覆盖');
    return;
  }
  if(result.migrated)hint('已保留旧版试玩进度，并升级为 P2 存档');
  else if(!result.recovered)hint('欢迎来到云屿百物铺！试试合成两片茶芽。');
}).catch(()=>pauseUnsafe('STARTUP_UNCERTAIN'));
