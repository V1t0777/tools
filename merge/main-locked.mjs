import { WIDTH, CELL_COUNT, MAX_ENERGY, ENERGY_REGEN_MS, CHAINS, createInitialState,
  moveOrMerge, produce, fulfillOrder, getItemIcon, getItemName,
  storeItem, withdrawItem, upgradeWarehouse, upgradeProducer, upgradeBuilding,
  getLevelProgress, getMaxOrderTier, getProducerUpgrade, getWarehouseUpgrade,
  SUPPLY_ITEMS, ACHIEVEMENT_RULES, useSupply, purchaseSupply } from './engine.mjs';
import { BUILDINGS } from './economy.mjs';
import { SAVE_KEY, ABNORMAL_RESET_BACKUP_KEY } from './storage.mjs';
import { getBoardGuidance } from './board-guidance.mjs';
import { getSupplyControlSnapshot } from './supply-controls.mjs';
import { deriveNormalMilestones } from './normal-milestones.mjs';
import { prepareLocalSaveExport, prepareAbnormalResetBackupExport } from './save-export.mjs';
import { requestBrowserSaveDownload } from './save-download.mjs';
import { isPreparedExportUnchanged } from './save-export-snapshot.mjs';
import { createNormalPageRuntime } from './normal-page-runtime.mjs';
import { attachNormalPageLifecycle } from './normal-page-lifecycle.mjs';
import {performNormalSaveImport} from './normal-save-import-flow.mjs';
import {RESTORE_BACKUP_KEY} from './save-restore-backup.mjs';

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
// Never start a download from a hidden or BFCache-suspended page.
function allowVisibleExport(){
  if(pageSuspended()){
    hint('页面处于后台或尚未恢复核验，请返回页面后重新点击导出');
    return false;
  }
  // Never describe a snapshot as current while a locked action, startup,
  // clock, reset or restore may still be writing its final bytes.
  if(runtime.busy){
    hint('正在安全保存或恢复存档，请等待操作结束后重新导出');
    return false;
  }
  return true;
}
// Read-only exact-byte recheck: this rejects known stale exports, but does
// not pretend localStorage reads and native downloads are cross-tab atomic.
function exportSourceStillCurrent(prepared,key){
  if(pageSuspended()||runtime.busy)return false;
  // A healthy normal-mode export must match the board the player has
  // actually reviewed. Corrupt/blocked saves remain exportable as evidence.
  if(key===SAVE_KEY&&runtime.phase==='ready'&&!runtime.blocked&&
      prepared.verified===true&&prepared.content!==runtime.raw)return false;
  const same=isPreparedExportUnchanged(prepared,()=>store?.getItem(key));
  return same&&!pageSuspended()&&!runtime.busy;
}
function allowCurrentExport(prepared,key){
  if(!allowVisibleExport())return false;
  if(exportSourceStillCurrent(prepared,key))return true;
  hint('导出期间原始存档或备份已变化、或无法再次读取；请重新点击导出，勿清理浏览器数据');
  return false;
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
  // A native chooser or file preflight is an active destructive intent.
  // Do not let an ordinary action change the baseline before confirmation.
  if(importPending()){hint('正在选择或核验导入文件，请先完成或取消导入后再经营');return;}
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
  // A late compatibility click from a chooser-era touch is not a new intent.
  if(importPending()){
    hint('正在选择或核验导入文件，请先完成或取消导入后再操作棋盘');return;
  }
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
// Persistent buttons survive board rerenders. A pointer begun while the
// native import chooser is active must not turn into a delayed compatibility
// click after cancellation. Dynamic buttons already use render generations.
function guardPersistentChooserClick(button,action){
  let stalePointer=false;
  button.addEventListener('pointerdown',()=>{stalePointer=importPending();});
  button.addEventListener('pointercancel',()=>{stalePointer=true;});
  button.addEventListener('click',event=>{
    if(stalePointer&&event.detail!==0){
      stalePointer=false;
      hint('导入期间的旧触控已取消，请重新点击当前按钮');
      return;
    }
    if(event.detail===0)stalePointer=false; // Keyboard is a new intent.
    action();
  });
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
  // A full rerender replaces the board's DOM nodes. A pointer captured on
  // the previous board must not drop onto newly rendered inventory, even if
  // the current storage bytes are verified and unchanged since publication.
  cancelStaleGesture();
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
  // A chooser-era touch must not arm a click that arrives after cancellation.
  // Only a new pointerdown after import may clear this suppression guard.
  if(importPending()){ignoreNextClick=true;return;}
  // Never start a drag against a board whose saved baseline is untrusted.
  if (saveIssue || runtime.busy) return;
  // A second contact (including a duplicate pointerdown) invalidates the
  // first drag. Never let pinch/scroll retarget a captured material.
  if (drag) { cancelStaleGesture(); return; }
  if (event.isPrimary === false || event.button > 0) return;
  // A storage event may not yet have arrived from another tab. Never capture
  // a pointer against an unverified board; this inspection is read-only.
  if(!revalidateResumedSave())return;
  const cell = event.target.closest('[data-slot]');
  // Detached cells may still have queued events after a complete rerender.
  // Only a genuine new pointerdown on a current cell clears click suppression.
  if (!cell || !board.contains(cell)) return;
  ignoreNextClick = false;
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
// Mobile WebViews may drop capture on scroll, DOM replacement or interruption
// without a pointercancel. Never turn that abandoned drag into a later drop.
board.addEventListener('lostpointercapture', event => completeDrag(event, true));

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
  // A synchronous storage read can itself dispatch pagehide or hide the
  // document. An unchanged save is NOT permission to run a gesture that
  // was invalidated during reconciliation. The next BFCache/visible return
  // must revalidate before any new action or destructive confirmation.
  if(pageSuspended()||saveIssue||runtime.phase!=='ready'||runtime.blocked){
    hint('页面在核验期间离开或状态失效，请返回页面重新操作');
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
guardPersistentChooserClick(byId('store-selected'),()=>{
  if(selected < 0){hint('先点击选择一个原料');return;}
  const slot=selected;
  commit(current=>storeItem(current,slot));
});
guardPersistentChooserClick(byId('warehouse-upgrade'),()=>commit(current=>upgradeWarehouse(current)));
byId('supply-producer').addEventListener('change',()=>refreshSupplyControls());

byId('export-local-save').addEventListener('click', () => {
  if(!allowVisibleExport())return;
  // A delayed storage event must not let an old board silently export the
  // newly written save as though the user had already reviewed that state.
  // Keep the abnormal/blocked evidence-export path available unchanged.
  if(runtime.phase==='ready'&&!runtime.blocked&&!saveIssue&&
      !revalidateResumedSave())return;
  const result=prepareLocalSaveExport(store);
  if(!result.ok){
    hint(result.reason==='NO_SAVED_DATA'?'此浏览器还没有可导出的存档':
      result.reason==='EXPORT_TOO_LARGE'?'原始存档超过安全导出上限，请勿重置或清理浏览器数据':
      result.reason==='EXPORT_ENCODING_UNAVAILABLE'?'当前浏览器无法安全编码备份文件，请勿重置或清理存档':
      '浏览器存储不可访问，无法读取原始存档');
    return;
  }
  if(!allowCurrentExport(result,SAVE_KEY))return;
  const download=requestBrowserSaveDownload(result,{
    schedule:(fn,ms)=>window.setTimeout(fn,ms),
    authorizeClick:()=>exportSourceStillCurrent(result,SAVE_KEY)
  });
  if(!download.ok){
    if(download.reason==='DOWNLOAD_SOURCE_CHANGED'){
      hint('下载前页面或原始存档已变化，未发起下载；请重新点击导出');return;
    }
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
  if(!allowVisibleExport())return;
  const result=prepareAbnormalResetBackupExport(store);
  if(!result.ok) {
    hint(result.reason==='NO_SAVED_DATA'?'此浏览器没有异常重置前备份':
      result.reason==='EXPORT_TOO_LARGE'?'重置前备份超过导出大小上限，请勿清理浏览器数据':
      '无法读取或编码重置前备份，请勿清理浏览器数据');
    return;
  }
  if(!allowCurrentExport(result,ABNORMAL_RESET_BACKUP_KEY))return;
  const download=requestBrowserSaveDownload(result,{
    schedule:(fn,ms)=>window.setTimeout(fn,ms),
    authorizeClick:()=>exportSourceStillCurrent(result,ABNORMAL_RESET_BACKUP_KEY)
  });
  if(!download.ok){
    if(download.reason==='DOWNLOAD_SOURCE_CHANGED'){
      hint('下载前页面或原始备份已变化，未发起下载；请重新点击导出');return;
    }
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


// File import is an explicit user gesture; never modify shared story HTML.
// A detached file chooser is not a restore permission. The exact observed
// baseline is revalidated after asynchronous reading and every confirmation.
// A native iOS/WeChat chooser may return without firing the input 'cancel'
// event. Release only an orphaned chooser after a visible/focused return and
// a generous grace period for delayed 'change'; never authorize a stale file.
const IMPORT_PICKER_RETURN_GRACE_MS=15_000;
let importEpoch=0,importBusy=false,importPicker=null,queuedHiddenSelection=null;
const importPending=()=>importBusy||importPicker!==null||queuedHiddenSelection!==null;
let activeImportRead=null;
let deliverHiddenSelection=()=>{};
let releaseOrphanedPickerAfterReturn=()=>{};
let refreshImportCancel=()=>{};
// A broken/no-op AbortController must not interrupt pagehide processing.
// The epoch still revokes late file reads; an unconfirmed abort also leaves
// the UI blocked until the user reloads and verifies the original save.
function abortImportOnLifecycleExit(){
  if(!activeImportRead)return;
  try{
    activeImportRead.abort();
    if(activeImportRead.signal?.aborted===true)return;
  }catch{/* Continue with fail-closed lifecycle invalidation. */}
  pauseUnsafe('IMPORT_CANCEL_UNCERTAIN',
    '浏览器未能确认导入已取消，已暂停操作；请保留存档并重新打开页面核对');
}
window.addEventListener('pagehide',()=>{
  try{abortImportOnLifecycleExit();}
  finally{
    importEpoch++;importPicker=null;queuedHiddenSelection=null;
    refreshImportCancel();
  }
});
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden){
    if(queuedHiddenSelection){
      const queued=queuedHiddenSelection;
      // Wait for the lifecycle bridge's visible-state reconciliation before
      // examining the file. Never read or confirm a save while hidden.
      void Promise.resolve().then(()=>{
        if(queuedHiddenSelection!==queued)return;
        queuedHiddenSelection=null;
        deliverHiddenSelection(queued);
      });
    }
    return;
  }
  try{abortImportOnLifecycleExit();}
  finally{
    // One native chooser hide is tolerated; every other background transition
    // invalidates pending selections and any in-flight restore confirmation.
    importEpoch++;
    if(importPicker){
      if(importPicker.hiddenOnce){
        importPicker=null;queuedHiddenSelection=null;
      }else importPicker.hiddenOnce=true;
    }else queuedHiddenSelection=null;
  }
});
const saveActions=byId('export-local-save').parentElement;
if(saveActions){
  const importButton=document.createElement('button');
  importButton.id='import-normal-save';
  importButton.type='button';
  importButton.className='text-button';
  importButton.textContent='导入普通模式存档';
  const makeImportFile=()=>{
    const input=document.createElement('input');
    input.id='import-normal-file';
    input.type='file';
    input.accept='.json,application/json';
    input.hidden=true;
    input.setAttribute('aria-label','选择普通模式 V3 JSON 存档文件');
    return input;
  };
  let importFile=makeImportFile();
  const cancelImportButton=document.createElement('button');
  cancelImportButton.id='cancel-normal-import';
  cancelImportButton.type='button';
  cancelImportButton.className='text-button';
  cancelImportButton.textContent='取消导入等待';
  cancelImportButton.hidden=true;
  cancelImportButton.setAttribute('aria-label','取消当前普通存档文件选择或读取');
  const backupButton=document.createElement('button');
  backupButton.id='export-restore-backup';
  backupButton.type='button';
  backupButton.className='text-button';
  backupButton.textContent='导出恢复前备份';
  saveActions.append(importButton,importFile,cancelImportButton,backupButton);
  refreshImportCancel=()=>{
    cancelImportButton.hidden=!(importPicker||importBusy||queuedHiddenSelection);
  };
  releaseOrphanedPickerAfterReturn=()=>{
    const picker=importPicker;
    // Focus without a preceding chooser blur/hide does not prove return.
    // Never expire a still-open native picker on an unrelated focus event.
    if(!picker||document.hidden||(!picker.blurred&&!picker.hiddenOnce)||
        picker.graceArmed)return;
    picker.graceArmed=true;
    try{
      window.setTimeout(()=>{
        // An old timeout must never cancel a newer chooser, active file read,
        // or a legitimate selection delivered after the focus event.
        if(importPicker!==picker||importBusy||pageSuspended())return;
        importPicker=null;queuedHiddenSelection=null;importFile.value='';
        refreshImportCancel();
        hint('文件选择器未返回结果，已解除等待；请重新点击导入');
      },IMPORT_PICKER_RETURN_GRACE_MS);
    }catch{/* No timer: preserve the fail-closed chooser lease. */}
  };
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden)releaseOrphanedPickerAfterReturn();
  });
  importButton.addEventListener('click',()=>{
    if(importBusy||runtime.busy||saveIssue||pageSuspended()){
      hint('存档未就绪或页面处于后台，暂不能导入');return;
    }
    // Do not let a second click reauthorize an older native chooser result.
    if(importPicker){hint('文件选择尚未结束，请先完成或取消当前选择');return;}
    if(!revalidateResumedSave())return;
    // Without a working cancellation signal, a native chooser cancellation
    // cannot revoke a restore waiting for its Web Lock. Fail closed.
    if(typeof AbortController!=='function'){
      hint('当前浏览器缺少安全取消能力，暂不能导入存档');return;
    }
    // Opening a native chooser invalidates selected cells, captured drags
    // and detached action buttons. Late pointer events cannot become new
    // gameplay intent after the chooser is cancelled.
    cancelStaleGesture();selected=-1;activeGuidance=null;render();
    // The chooser is bound to the exact save and page lifecycle at the
    // initiating user gesture, not to whichever save is current on return.
    importPicker={epoch:importEpoch,raw:runtime.raw,hiddenOnce:false,
      blurred:false,graceArmed:false};
    refreshImportCancel();
    // Re-selecting the same file after a rejected/aborted chooser must still
    // produce a new change event on mobile browsers.
    importFile.value='';
    try{importFile.click();}
    catch{importPicker=null;refreshImportCancel();hint('当前浏览器无法打开文件选择器');}
  });
  const cancelPendingImport=()=>{
    // Cancellation must also revoke a confirmed restore waiting for Web Lock.
    // If a broken AbortController cannot signal cancellation, block the
    // runtime rather than allowing an uncertain write to proceed.
    const controller=activeImportRead;
    if(controller){
      try{
        controller.abort();
        if(controller.signal?.aborted!==true)
          pauseUnsafe('IMPORT_CANCEL_UNCERTAIN',
            '无法确认文件导入已取消，已暂停操作；请重新打开页面核对');
      }catch{
        pauseUnsafe('IMPORT_CANCEL_UNCERTAIN',
          '无法确认文件导入已取消，已暂停操作；请重新打开页面核对');
      }
    }
    importEpoch++;
    importPicker=null;queuedHiddenSelection=null;importFile.value='';
    refreshImportCancel();
  };
  function bindImportFileEvents(input){
    input.addEventListener('cancel',()=>{
      // A replaced input belongs to a cancelled native chooser. Ignore its
      // late change/cancel events even if a newer picker is already open.
      if(input!==importFile)return;
      cancelPendingImport();
    });
    input.addEventListener('change',()=>{
      if(input!==importFile)return;
      const picker=importPicker,file=importFile.files?.[0];
    // Some iOS/WebView choosers deliver change before visibility becomes
    // visible. Hold only the File handle, never read, confirm or write hidden.
    if(document.hidden&&picker?.hiddenOnce&&file){
      if(!queuedHiddenSelection){
        queuedHiddenSelection={file,picker};
      }else{
        importPicker=null;queuedHiddenSelection=null;importFile.value='';
        hint('文件选择事件重复，已取消导入，请重新选择');
      }
      return;
    }
    if(queuedHiddenSelection){
      importPicker=null;queuedHiddenSelection=null;importFile.value='';
      hint('文件选择事件重复，已取消导入，请重新选择');
      return;
    }
      void acceptSelectedFile(file,picker);
    });
  }
  bindImportFileEvents(importFile);
  cancelImportButton.addEventListener('click',()=>{
    if(!importPicker&&!importBusy&&!queuedHiddenSelection)return;
    cancelPendingImport();
    // Replacing the native input isolates delayed events from the old
    // chooser; merely clearing its value would not distinguish generations.
    const previous=importFile;
    const fresh=makeImportFile();
    previous.remove();
    importFile=fresh;
    bindImportFileEvents(fresh);
    saveActions.append(fresh);
    cancelImportButton.hidden=true;
    // Cancellation cannot undo a write that finished before this click.
    // Never promise the previous save was untouched after a confirmed restore.
    if(!saveIssue)hint('已请求取消导入；若此前已确认恢复，请核对当前棋盘与恢复前备份');
  });
  deliverHiddenSelection=({file,picker})=>{
    if(importPicker===picker)void acceptSelectedFile(file,picker);
  };
  async function acceptSelectedFile(file,picker){
    if(importPicker===picker)importPicker=null;
    else picker=null;
    refreshImportCancel();
    if(!file){importFile.value='';return;}
    // One hide-only native chooser roundtrip is permitted, but never a
    // pagehide/BFCache return, a second hide, or a changed original save.
    // Import still requires a visible verified page and explicit confirmation.
    const chooserEpochValid=!!picker&&(picker.epoch===importEpoch||
      (picker.hiddenOnce===true&&picker.epoch+1===importEpoch));
    if(!chooserEpochValid||picker.raw!==runtime.raw||
        pageSuspended()||saveIssue||runtime.busy||!revalidateResumedSave()){
      importFile.value='';
      hint('文件选择期间页面或存档已变化，请重新点击导入并选择文件');
      return;
    }
    if(importBusy){importFile.value='';hint('已有文件正在核验，请稍后重试');return;}
    // Construct the cancellation lease before occupying the UI flight.
    // A broken/polyfilled controller must not strand the import button.
    let controller;
    try{
      controller=new AbortController();
      if(typeof controller.abort!=='function'||!controller.signal)
        throw Error('INVALID_ABORT_CONTROLLER');
    }catch{
      importFile.value='';
      hint('当前浏览器无法安全取消文件读取，未开始导入');return;
    }
    importBusy=true;importButton.disabled=true;
    refreshImportCancel();
    // Abort the UI wait on backgrounding; the native read may still finish.
    activeImportRead=controller;
    try{
      const result=await performNormalSaveImport({
        file,storage:store,runtime,
        confirm:message=>window.confirm(message),
        isSuspended:pageSuspended,revalidate:revalidateResumedSave,
        getEpoch:()=>importEpoch,signal:controller?.signal
      });
      if(result.ok)hint('普通模式存档已核验并恢复；请核对棋盘，并导出恢复前备份');
      else if(runtime.blocked||['RESTORE_OUTCOME_UNCERTAIN','UI_PUBLISH_FAILED',
        'UI_TRANSACTION_INVALIDATED','RESTORE_VERIFY_FAILED'].includes(result.reason))
        pauseUnsafe(result.reason,'恢复结果无法安全确认，已暂停操作；请保留原始存档及恢复前备份');
      else hint({
        USER_CANCELLED:'已取消导入，当前进度未更改',
        DOWNGRADE_CANCELLED:'已取消降级恢复，当前进度未更改',
        FILE_TOO_LARGE:'文件超过安全大小限制，未执行导入',
        FILE_READ_TIMEOUT:'读取文件超时，未恢复存档；请重新选择文件',
        FILE_READ_CANCELLED:'文件导入已取消，当前进度未更改',
        RESTORE_CANCELLED_BEFORE_WRITE:'文件导入已取消，未覆盖存档，可重新选择',
        FILE_READ_UNAVAILABLE:'当前浏览器无法安全安排文件读取，请重新打开页面',
        FILE_READ_FAILED:'读取文件失败，未恢复存档；请重新选择文件',
        STORY_MODE_FILE:'这是剧情模式文件，不能导入普通模式',
        CURRENT_SAVE_CHANGED:'读取期间存档已变化，请在最新页面重新选择文件',
        SAVE_CHANGED:'存档已变化，请重新选择文件',
        PAGE_SUSPENDED:'文件导入已取消或页面已切换，请重新选择文件',
        BACKUP_SLOT_CONFLICT:'恢复前备份槽已存在不同内容，请先导出并核对备份',
        LOCK_BUSY:'其他标签正在保存，请稍后重新选择文件',
        ALREADY_PRESENT:'所选文件与当前存档完全相同，无需导入'
      }[result.reason]||'导入预检或恢复未通过，当前存档不得视为已恢复');
    }catch{pauseUnsafe('RESTORE_UI_FAILED');}
    finally{
      if(activeImportRead===controller)activeImportRead=null;
      importBusy=false;importButton.disabled=false;importFile.value='';
      refreshImportCancel();
    }
  }
  backupButton.addEventListener('click',()=>{
    if(!allowVisibleExport())return;
    const backupView={getItem:key=>{
      if(key!==SAVE_KEY||typeof store?.getItem!=='function')throw Error('STORAGE_UNAVAILABLE');
      return store.getItem(RESTORE_BACKUP_KEY);
    }};
    const prepared=prepareLocalSaveExport(backupView);
    if(!prepared.ok){
      hint(prepared.reason==='NO_SAVED_DATA'
        ?'此浏览器尚无恢复前备份'
        :prepared.reason==='EXPORT_TOO_LARGE'
          ?'恢复前备份超过安全导出上限，请勿重置或清理浏览器数据'
          :prepared.reason==='EXPORT_ENCODING_UNAVAILABLE'
            ?'当前浏览器无法安全编码恢复前备份，请勿清理浏览器数据'
            :'无法读取恢复前备份，请勿清理浏览器数据');
      return;
    }
    if(!allowCurrentExport(prepared,RESTORE_BACKUP_KEY))return;
    const result=requestBrowserSaveDownload({...prepared,
      filename:prepared.wrapped?'yunyu-before-restore-utf16.json':
        prepared.verified?'yunyu-before-restore-v3.json':'yunyu-before-restore-original.txt'},{
      schedule:(fn,ms)=>window.setTimeout(fn,ms),
      authorizeClick:()=>exportSourceStillCurrent(prepared,RESTORE_BACKUP_KEY)
    });
    if(!result.ok){
      if(result.reason==='DOWNLOAD_SOURCE_CHANGED'){
        hint('下载前页面或恢复前备份已变化，未发起下载；请重新点击导出');return;
      }
      hint(result.reason==='DOWNLOAD_LIMIT_REACHED'
        ?'恢复前备份下载过于频繁，请稍后重试，勿清理浏览器数据'
        :result.reason==='DOWNLOAD_TOO_LARGE'
          ?'恢复前备份文件超过浏览器下载上限，请勿清理浏览器数据'
          :result.reason==='DOWNLOAD_UNSUPPORTED'
            ?'当前浏览器不支持恢复前备份下载，请勿清理浏览器数据'
            :'恢复前备份下载未启动，请勿清理浏览器数据');
      return;
    }
    const message=prepared.wrapped
      ?'已请求下载恢复前异常字符 JSON 封装备份，不可直接导入；请核实文件已保存'
      :prepared.verified
        ?'已请求下载恢复前原始存档，请核实文件已保存'
        :'恢复前原始备份可能异常，已请求下载文本备份；请勿直接导入';
    hint(result.cleanupDeferred
      ?message+'；浏览器未能安排临时链接清理'
      :message);
  });
}

guardPersistentChooserClick(byId('reset'),async()=>{
  if(pageSuspended()){hint('页面处于后台，请返回并核验进度后重试');return;}
  // Do not show a destructive reset confirmation over a native file chooser
  // or while a selected save is being read/confirmed for restoration.
  if(importPending()){hint('导入文件尚未处理完毕，请先完成或取消导入再重置');return;}
  if(runtime.busy){hint('正在保存，暂不能重置');return;}
  const damaged=saveIssue==='CORRUPT_SAVE'||saveIssue==='UNSUPPORTED_OR_CORRUPT_SAVE';
  if(saveIssue&&!damaged){
    hint('当前进度存在冲突或锁不可用，请先导出原始存档并重新打开页面核对');return;
  }
  // Confirmation authorizes only the save visible when the dialog opens.
  // A storage event can adopt a newer revision DURING window.confirm; never
  // reset that unseen new baseline under an earlier confirmation.
  if(!damaged&&!revalidateResumedSave()){
    hint('存档尚未核验，重置已取消；请在最新棋盘上重新确认');return;
  }
  const confirmedRaw=damaged?initialOriginalRaw:runtime.raw;
  const confirmedEpoch=importEpoch;
  if(!window.confirm(damaged
    ?'存档异常：将先核实并保留原始备份，再重置普通模式。建议先下载原始文件，确定继续吗？'
    :'确定重置本地试玩进度吗？当前棋盘、金币和订单会被清空，且无法恢复。'))return;
  // A native chooser can start reentrantly during a WebView confirmation
  // without incrementing importEpoch. Never reset over that new intent.
  if(pageSuspended()||importEpoch!==confirmedEpoch){
    hint('页面已切换，重置已取消；请返回并重新确认');return;
  }
  if(importPending()){
    hint('导入文件选择或读取已开始，重置已取消；请先完成或取消导入');return;
  }
  if(!damaged&&(saveIssue||runtime.phase!=='ready'||
      runtime.raw!==confirmedRaw||!revalidateResumedSave()||
      runtime.raw!==confirmedRaw)){
    hint('确认期间存档已变化，重置已取消；请核对最新进度后重新确认');return;
  }
  if(damaged&&saveIssue!=='CORRUPT_SAVE'&&
      saveIssue!=='UNSUPPORTED_OR_CORRUPT_SAVE'){
    hint('异常存档状态已变化，重置已取消；请重新打开页面核对');return;
  }
  cancelStaleGesture();
  try{
    const result=await runtime.reset({confirmed:true,
      expectedRaw:confirmedRaw,requireOriginalBackup:damaged,
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
  onBlur(){if(importPicker)importPicker.blurred=true;},
  onFocus(){releaseOrphanedPickerAfterReturn();},
  onReadyForStartup(){startNormalOnce();},
  onResult(result){
    if(!result.ok)pauseUnsafe(result.reason,
      '跨标签或后台存档状态异常，已暂停操作；请备份并重新打开页面核对');
    else if(result.changed)hint('已从其他标签页读取更新进度');
  }
});
let timerPending=false;
window.setInterval(async()=>{
  if(pageSuspended()||saveIssue||runtime.busy||importPending()||timerPending)return;
  timerPending=true;
  try{
    if(!revalidateResumedSave())return;
    handleTransactionResult(await runtime.clock({now:Date.now()}),'clock');
  }catch{pauseUnsafe('CLOCK_OUTCOME_UNCERTAIN');}
  finally{timerPending=false;}
},1000);
byId('save-status').textContent='正在核验本地进度 · 暂不可操作';
render();
// iOS Safari can evaluate a background tab before it becomes visible.
// Do not consume the one-shot startup while hidden: that would permanently
// block an untouched save without ever attempting a write.
let startupAttempted=false;
function startNormalOnce(){
  if(startupAttempted||pageSuspended())return;
  startupAttempted=true;
  void runtime.start({canStart:()=>!pageSuspended()}).then(result=>{
  if(!result.ok){
    pauseUnsafe(result.reason||'STARTUP_UNCERTAIN',
      '本地存档无法安全恢复或确认写入，原始数据不会自动覆盖');
    return;
  }
  if(result.migrated)hint('已保留旧版试玩进度，并升级为 P2 存档');
  else if(!result.recovered)hint('欢迎来到云屿百物铺！试试合成两片茶芽。');
  }).catch(()=>pauseUnsafe('STARTUP_UNCERTAIN'));
}
// Lifecycle bridge owns the sole BFCache/visibility listeners and notifies
// this one-shot starter only after the cold page is safe to begin.
startNormalOnce();
