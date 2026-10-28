import {WIDTH,MAX_ENERGY,CHAINS,getLevel,moveOrMerge,produce,fulfillOrder,storeItem,withdrawItem,upgradeBuilding,getItemIcon,getItemName,useSupply,purchaseSupply,SUPPLY_ITEMS} from '../engine.mjs';
import {BUILDINGS} from '../economy.mjs';
import {readStoryWorkshop,writeStoryWorkshop,STORY_WORKSHOP_KEY} from './workshop-storage.mjs';
import {readStorySave} from './local-storage.mjs';
import {captureStoryWorkshopEvidence,prepareStoryEvidenceDownload,isPreparedStoryEvidenceCurrent} from './save-evidence.mjs';
import {requestBrowserSaveDownload} from '../save-download.mjs';
import {checkStoryResumeSnapshot} from './resume-guard.mjs';
import {verifyStoryWorkshopPublication} from './workshop-publication-guard.mjs';
import {runStoryWriteWithLock} from './write-lock.mjs';
import {createWorkshopRenderedActionGuard} from './render-action-guard.mjs';
import {resetStoryWorkshopWithLock} from './workshop-reset.mjs';
import {shouldBlockStoryStorageEvent} from './storage-event-guard.mjs';
import {shouldRefreshWorkshopForStoryEvent} from './storage-event-guard.mjs';
import {storyGardenBuildAvailable,storyHarborBuildAvailable,storyStorefrontBuildAvailable} from './workshop-gate.mjs';
import {storyBuildingWriteAllowed} from './building-commit-guard.mjs';
import {nextStoryConstructionBudget,wouldSpendStoryConstructionReserve} from './supply-budget.mjs';
import {nextStoryWorkshopAction,isStoryWorkshopRouteCurrent} from './workshop-next-step.mjs';
import {guardStoryPersistentGesture} from './persistent-gesture-guard.mjs';
const $=id=>document.getElementById(id);
const storage=(()=>{try{return window.localStorage;}catch{return null;}})();
const webLocks=(()=>{try{return window.navigator?.locks??null;}catch{return null;}})();
const loaded=readStoryWorkshop(storage);
let state=loaded.state,raw=loaded.raw,blocked=loaded.blocked,reason=loaded.reason,selected=-1;
let saving=false;
let storageEpoch=0; // increments when an external story-workshop snapshot invalidates this page
let renderGeneration=0;
// Pagehide/hidden must suspend queued DOM actions until a visible, read-only
// save recheck. A hidden BFCache pageshow alone never resumes writes.
let pageGone=false,visibilitySuspended=false,resumePending=false;
let lifecycleEpoch=0; // do not clear a new suspension triggered during a save read
let renderedNextRoute=null;
const pageSuspended=()=>pageGone||visibilitySuspended||document.visibilityState==='hidden';
const guardRenderedAction=createWorkshopRenderedActionGuard(
  ()=>renderGeneration,
  ()=>$('board-notice').textContent='界面已更新，请在最新界面重新操作。'
);
function status(){
  $('workshop-status').textContent=blocked
    ? reason==='CORRUPT_SAVE'
      ? '剧情工作台存档损坏：原数据未覆盖。请先考虑导出异常原始记录备份，再决定是否重置。'
      : reason==='STORAGE_UNAVAILABLE'
        ? '无法访问浏览器存储，经营操作已暂停。'
        : '检测到存档变化或写入无法确认：本页已停止操作。请勿重复重置，先重新打开页面核对金币、建筑和订单。'
    : pageSuspended()
      ? '页面已暂停：返回前不会继续经营操作；恢复可见后将核对原始存档。'
      : '剧情工作台数据只保存在此浏览器，与普通模式金币及背包完全隔离。';
}
function render(){
  renderGeneration++;
  // Reading a narrative prerequisite can synchronously dispatch pagehide or
  // visibilitychange in a mobile browser. Recompute the suspended state AFTER
  // this read, before constructing any enabled controls or navigation links.
  const narrative=readStorySave(storage);
  const disabled=blocked||saving||pageSuspended();
  status();
  $('energy').textContent=state.energy+' / '+MAX_ENERGY;
  $('coins').textContent=String(state.coins);
  $('xp').textContent=String(state.xp);
  const count=state.progress.orders;
  $('order-count').textContent=Math.min(count,1)+' / 1';
  $('milestone').textContent=count>=1?'委托完成！可以返回剧情页继续阅读《第一杯热茶》。':'还需完成 '+(1-count)+' 笔委托。';
  const board=$('workshop-board');board.replaceChildren();
  const fragment=document.createDocumentFragment();
  state.board.forEach((item,i)=>{
    const button=document.createElement('button');button.type='button';
    button.className='workshop-cell'+(item?.kind==='producer'?' producer':'')+(selected===i?' selected':'');
    button.disabled=disabled;
    button.dataset.slot=String(i);
    button.setAttribute('aria-label','第'+(Math.floor(i/WIDTH)+1)+'行第'+(i%WIDTH+1)+'列，'+(item?getItemName(item):'空格'));
    if(item){
      const glyph=document.createElement('span');glyph.className='glyph';glyph.textContent=getItemIcon(item);
      button.append(glyph);
      const info=document.createElement('span');info.className='tier';
      info.textContent=item.kind==='producer'?(item.charges>0?item.charges+'次':'冷却中'):'Lv.'+item.tier;
      button.append(info);
    }
    button.addEventListener('click',guardRenderedAction(()=>touch(i)));fragment.append(button);
  });
  board.append(fragment);

  // Real story-only warehouse actions: never read/write normal-mode storage.
  const used=state.board.filter(Boolean).length;
  const stored=state.warehouse.slots.slice(0,state.warehouse.capacity).filter(Boolean).length;
  const boardHasSpace=used<state.board.length;
  const warehouseHasSpace=stored<state.warehouse.capacity;
  const selectedMaterial=selected>=0&&state.board[selected]?.kind==='material';
  $('board-occupancy').textContent=used+' / '+state.board.length;
  $('warehouse-occupancy').textContent=stored+' / '+state.warehouse.capacity;
  $('store-selected').disabled=disabled||!selectedMaterial||!warehouseHasSpace;
  $('warehouse-hint').textContent=blocked
    ? '存档处于保护状态，仓库操作已暂停；请先核对存档提示。'
    : !boardHasSpace
      ? warehouseHasSpace
        ? '棋盘已满：选择一件材料后点击“收纳选中材料”，腾出生产空间；也可以合成同类同等级材料。'
        : '棋盘和仓库都满：先合成两件同类同等级材料，腾出棋盘空间。'
      : selectedMaterial
        ? warehouseHasSpace
          ? '已选中'+getItemName(state.board[selected])+'；可收纳至仓库。'
          : '仓库已满：请先取回物品并合成，或继续整理棋盘。'
        : '点选棋盘上的材料，再收纳到仓库；点击仓库中已存放的物品可取回。';
  const bank=$('workshop-warehouse');bank.replaceChildren();
  const bankFragment=document.createDocumentFragment();
  for(let i=0;i<state.warehouse.capacity;i++){
    const item=state.warehouse.slots[i];
    const button=document.createElement('button');button.type='button';
    button.className='workshop-warehouse-slot';
    button.disabled=disabled||!item||!boardHasSpace;
    button.setAttribute('aria-label','仓库第'+(i+1)+'格，'+(item?'取回'+getItemName(item):'空位'));
    button.textContent=item
      ? getItemIcon(item)+' '+getItemName(item)+' · Lv.'+item.tier+' · 取回'
      : '第'+(i+1)+'格 · 空位';
    button.addEventListener('click',guardRenderedAction(()=>commit(withdrawItem(state,i))));
    bankFragment.append(button);
  }
  bank.append(bankFragment);

  // The existing finite offline supply economy is now usable in story mode.
  // Every action follows the same render-epoch, Web Lock and exact-byte CAS
  // protocol as board operations; no normal-mode storage keys are accessed.
  const bag=$('story-supply-bag');bag.replaceChildren();
  for(const id of ['soda','meal']){
    const item=SUPPLY_ITEMS[id],button=document.createElement('button');
    button.type='button';button.className='story-supply-action';
    button.dataset.supplyUse=id;
    button.textContent=item.icon+' 使用'+item.name+' · '+item.effect+'（剩余 '+state.bag[id]+'）';
    button.disabled=disabled||state.bag[id]===0||state.energy>=MAX_ENERGY;
    button.addEventListener('click',guardRenderedAction(()=>commit(useSupply(state,id))));
    bag.append(button);
  }
  const cooling=state.board.filter(item=>item?.kind==='producer'&&
    item.charges===0&&item.cooldownUntil>Date.now());
  const cooldownList=$('story-supply-cooldowns');cooldownList.replaceChildren();
  $('story-supply-cooldown-hint').textContent=cooling.length
    ? '请选择正在冷却的工坊使用卡片；卡片只作用于该工坊。'
    : '当前没有正在冷却的工坊。加速卡与重启卡不会在无冷却时消耗。';
  for(const producer of cooling){
    const row=document.createElement('div');row.className='story-supply-row';
    const label=document.createElement('span');label.textContent=getItemName(producer);
    row.append(label);
    for(const id of ['speed','reset']){
      const item=SUPPLY_ITEMS[id],button=document.createElement('button');
      button.type='button';button.className='story-supply-action';
      button.dataset.supplyUse=id;button.dataset.producerId=producer.id;
      button.textContent=item.icon+' '+item.name+'（'+state.bag[id]+'）';
      button.disabled=disabled||state.bag[id]===0;
      button.addEventListener('click',guardRenderedAction(()=>
        commit(useSupply(state,id,producer.id))));
      row.append(button);
    }
    cooldownList.append(row);
  }
  const budget=nextStoryConstructionBudget(state);
  $('story-supply-budget-hint').textContent=budget.ok
    ? budget.description
    : '无法核对建设金币预算，补给购买已暂停。';
  const shop=$('story-supply-shop');shop.replaceChildren();
  for(const [id,item] of Object.entries(SUPPLY_ITEMS)){
    const button=document.createElement('button');
    button.type='button';button.className='story-supply-action';
    button.dataset.supplyBuy=id;
    const left=item.limit-state.shop.purchases[id];
    const spendsReserve=wouldSpendStoryConstructionReserve(budget,item.price);
    button.textContent=item.icon+' '+item.name+' · ◈'+item.price+'（剩余限购 '+left+'）'+
      (spendsReserve?' · 将动用建设储备':'');
    button.disabled=disabled||!budget.ok||left===0||state.coins<item.price;
    button.addEventListener('click',guardRenderedAction(()=>{
      // The save may have changed before the delayed click, even if its
      // storage event has not arrived. Never prompt against stale coins.
      if(!revalidateWorkshopBeforeInteraction())return;
      if(spendsReserve){
        // Consent does not lease the save: a second exact-byte read is
        // required after the native modal closes (including cancellation).
        let approved=false;
        try{
          approved=window.confirm('购买'+item.name+'会使下一处建设「'+
            BUILDINGS[budget.id].name+'」金币不足。确认继续购买吗？')===true;
        }catch{}
        if(!approved){
          if(!revalidateWorkshopBeforeInteraction())return;
          $('board-notice').textContent='已取消补给购买，金币未扣除。';
          return;
        }
      }
      // commit() independently rechecks raw bytes and epoch before writing.
      return commit(purchaseSupply(state,id));
    }));
    shop.append(button);
  }
  const list=$('workshop-orders');list.replaceChildren();
  for(const order of state.orders){
    const row=document.createElement('div');row.className='workshop-order';
    const mark=document.createElement('span');
    mark.textContent=CHAINS[order.chain].icon[order.tier-1]+' '+CHAINS[order.chain].names[order.tier-1]+' · ◈'+order.coins;
    const btn=document.createElement('button');btn.type='button';btn.textContent='交付';
    btn.disabled=disabled||!state.board.some(item=>item?.kind==='material'&&item.chain===order.chain&&item.tier===order.tier);
    btn.addEventListener('click',guardRenderedAction(()=>commit(fulfillOrder(state,order.id))));
    row.append(mark,btn);list.append(row);
  }
  const garden=BUILDINGS.garden,level=getLevel(state.xp),built=state.buildings.garden===1;
  // Read-only first-volume route; a link is never an unlock or save command.
  // Always derive it from the current narrative read and this workshop view.
  const nextAction=nextStoryWorkshopAction(narrative,{state,raw,blocked,reason});
  renderedNextRoute=nextAction.href?{storyRaw:narrative.raw,workshopRaw:raw,href:nextAction.href}:null;
  $('workshop-next-guidance').textContent=nextAction.message;
  const nextLink=$('workshop-next-action');
  nextLink.hidden=disabled||!nextAction.href;
  if(nextAction.href)nextLink.href=nextAction.href;
  nextLink.textContent=nextAction.label;
  const gardenStoryReady=!narrative.blocked&&storyGardenBuildAvailable(narrative.progress);
  $('garden-status').textContent=built?'已修复':'未修复';
  $('garden-hint').textContent=built
    ? '花园已修复。返回剧情页继续《两个人的下午茶》。'
    : !gardenStoryReady
      ? '先在剧情页完成《没有开花的花圃》，再来修复后院花园。'
      : '需要 '+garden.minLevel+' 级和 '+garden.coins+' 金币；当前 '+level+' 级、'+state.coins+' 金币。通过交付委托积累资源。';
  $('build-garden').disabled=disabled||built||!gardenStoryReady||level<garden.minLevel||state.coins<garden.coins;
  const harbor=BUILDINGS.harbor,harborBuilt=state.buildings.harbor===1;
  const harborStoryReady=!narrative.blocked&&storyHarborBuildAvailable(narrative.progress);
  $('harbor-status').textContent=harborBuilt?'已修缮':'未修缮';
  $('harbor-hint').textContent=harborBuilt
    ? '港湾街角已修缮。返回剧情页继续《海雾里的灯》。'
    : !harborStoryReady
      ? '先完成《第一次独立修理》，确认学徒与岚叔的安全准备，再进行港湾修缮。'
      : '需要 '+harbor.minLevel+' 级和 '+harbor.coins+' 金币；当前 '+level+' 级、'+state.coins+' 金币。';
  $('build-harbor').disabled=disabled||harborBuilt||!harborStoryReady||level<harbor.minLevel||state.coins<harbor.coins;
  const storefront=BUILDINGS.storefront,storefrontBuilt=state.buildings.storefront===1;
  const storefrontStoryReady=!narrative.blocked&&storyStorefrontBuildAvailable(narrative.progress);
  $('storefront-status').textContent=storefrontBuilt?'已修整':'未修整';
  $('storefront-hint').textContent=storefrontBuilt
    ? '百物铺门面已修整。返回剧情页参加《大家的开张庆典》。'
    : !storefrontStoryReady
      ? '先读完《海雾里的灯》，再为居民们准备开张庆典。'
      : '修整门面需要 '+storefront.minLevel+' 级和 '+storefront.coins+' 金币；目前 '+level+' 级、'+state.coins+' 金币。';
  $('build-storefront').disabled=disabled||storefrontBuilt||!storefrontStoryReady||level<storefront.minLevel||state.coins<storefront.coins;
  $('reset-workshop').disabled=saving||pageSuspended()||reason==='STORAGE_UNAVAILABLE';
  $('export-corrupt-workshop').disabled=saving||pageSuspended()||reason!=='CORRUPT_SAVE'||typeof raw!=='string';
}
// A committed write can be superseded before the user reads its feedback.
// Render the protected state first, then replace any prior success notice.
// Never auto-replay an uncertain action: it may already have consumed resources.
function blockWorkshopWithNotice(nextReason,notice){
  blocked=true;reason=nextReason;selected=-1;
  render();
  $('board-notice').textContent=notice;
}
// Storage events may arrive after a tap. Refuse stale actions before
// computing an operation or selecting a slot; the later Web Lock/CAS still
// protects against changes between this read and the eventual write.
function revalidateWorkshopBeforeInteraction(){
  if(blocked||saving||pageSuspended())return false;
  const check=checkStoryResumeSnapshot(storage,{key:STORY_WORKSHOP_KEY,expectedRaw:raw});
  if(check.ok)return true;
  storageEpoch++;blocked=true;reason=check.reason;selected=-1;
  render();
  $('board-notice').textContent='检测到工作台存档已变化或无法读取，本次操作已取消。请重新打开页面核对进度。';
  return false;
}
async function commit(result){
  // One in-flight action per tab; Web Locks serializes participating tabs.
  // The existing exact-raw CAS remains mandatory inside the lock callback.
  if(!revalidateWorkshopBeforeInteraction())return;
  if(!result.ok){$('board-notice').textContent=result.message;return;}
  const expectedEpoch=storageEpoch;
  const buildingChanged=['garden','harbor','storefront'].some(name=>
    state.buildings[name]!==result.state.buildings[name]);
  saving=true;render();
  const expectedRaw=raw;
  // A building spends coins only while its story prerequisite is still current.
  // Recheck after acquiring the workshop lock, not just when the button was tapped.
  const expectedStoryRaw=readStorySave(storage).raw;
  const attempt=await runStoryWriteWithLock(webLocks,STORY_WORKSHOP_KEY,
    ()=>!blocked&&!pageSuspended()&&storageEpoch===expectedEpoch&&
      storyBuildingWriteAllowed(storage,state,result.state,expectedStoryRaw)&&
      writeStoryWorkshop(storage,result.state,{expectedRaw}));
  saving=false;
  // A verified write can be superseded after the Web Lock is released.
  // Never publish a success message from an already stale workshop snapshot.
  const expectedWorkshopRaw=attempt.ok&&attempt.value===true
    ? JSON.stringify(result.state):null;
  const publication=expectedWorkshopRaw===null
    ? {ok:false,reason:'WRITE_CONFLICT'}
    : verifyStoryWorkshopPublication(storage,{expectedWorkshopRaw,expectedStoryRaw,
      buildingChanged,expectedEpoch,currentEpoch:storageEpoch,suspended:pageSuspended()});
  if(!publication.ok||blocked){
    blockWorkshopWithNotice(publication.ok?'WRITE_CONFLICT':publication.reason,
      '本次操作可能已经写入，但存档结果无法确认；请勿重复操作，重新打开页面核对金币、建筑与订单。');
    return;
  }
  state=result.state;raw=JSON.stringify(state);selected=-1;
  $('board-notice').textContent=result.message;
  render();
  // Rendering may invoke synchronous browser/test hooks. Recheck the exact
  // raw bytes and epoch; this remains read-only and is not a cross-tab CAS.
  const afterRender=verifyStoryWorkshopPublication(storage,{expectedWorkshopRaw,
    expectedStoryRaw,buildingChanged,expectedEpoch,currentEpoch:storageEpoch,suspended:pageSuspended()});
  if(!afterRender.ok||blocked){
    blockWorkshopWithNotice(afterRender.ok?'WRITE_CONFLICT':afterRender.reason,
      '页面更新期间存档发生变化；刚才的成功提示已撤回，请重新打开页面核对进度。');
  }
}
function touch(index){
  if(!revalidateWorkshopBeforeInteraction())return;
  const item=state.board[index];
  if(item?.kind==='producer'){commit(produce(state,index));return;}
  if(selected===-1){if(item){selected=index;render();}return;}
  if(selected===index){selected=-1;render();return;}
  commit(moveOrMerge(state,selected,index));
}
// Persistent buttons/links survive render(). A pointer started before a
// BFCache transition or another render cannot authorize a delayed click.
// This only revokes stale gestures; every write still uses the original CAS.
for(const id of ['workshop-next-action','store-selected','build-garden',
  'build-harbor','build-storefront','export-corrupt-workshop','reset-workshop']){
  guardStoryPersistentGesture($(id),
    ()=>lifecycleEpoch+':'+storageEpoch+':'+renderGeneration,
    ()=>$('board-notice').textContent='页面或存档状态已变化，旧触控已取消；请重新按下当前按钮。');
}
// Recheck both saves before following a link rendered before a peer-tab edit.
$('workshop-next-action').addEventListener('click',event=>{
  const snapshot=renderedNextRoute;
  if(!snapshot||blocked||saving||pageSuspended()){
    event.preventDefault();return;
  }
  const story=readStorySave(storage);
  const workshop=readStoryWorkshop(storage);
  if(pageSuspended()||!isStoryWorkshopRouteCurrent(snapshot,story,workshop)){
    event.preventDefault();
    if(pageSuspended())return;
    if(workshop.blocked||workshop.raw!==raw){
      storageEpoch++;blocked=true;reason=workshop.reason??'WRITE_CONFLICT';selected=-1;
    }
    render();
    $('board-notice').textContent='导航前发现剧情或工作台存档已变化；旧链接已取消，请核对更新后的首卷下一步。';
  }
});
$('store-selected').addEventListener('click',()=>{
  if(blocked||saving)return;
  if(selected<0||state.board[selected]?.kind!=='material'){
    $('board-notice').textContent='请先选中棋盘上的一件材料。';return;
  }
  commit(storeItem(state,selected));
});
$('build-garden').addEventListener('click',()=>{
  if(blocked||saving)return;
  const story=readStorySave(storage);
  if(story.blocked||!storyGardenBuildAvailable(story.progress)){
    $('board-notice').textContent='请先完成第二章《没有开花的花圃》，再修复花园。';return;
  }
  commit(upgradeBuilding(state,'garden'));
});
$('build-harbor').addEventListener('click',()=>{
  if(blocked||saving)return;
  const story=readStorySave(storage);
  if(story.blocked||!storyHarborBuildAvailable(story.progress)){
    $('board-notice').textContent='请先完成《第一次独立修理》，再修缮港湾街角。';return;
  }
  commit(upgradeBuilding(state,'harbor'));
});
$('build-storefront').addEventListener('click',()=>{
  if(blocked||saving)return;
  const story=readStorySave(storage);
  if(story.blocked||!storyStorefrontBuildAvailable(story.progress)){
    $('board-notice').textContent='请先完成《海雾里的灯》，再为庆典修整百物铺门面。';return;
  }
  commit(upgradeBuilding(state,'storefront'));
});
$('export-corrupt-workshop').addEventListener('click',()=>{
  if(saving||pageSuspended()||reason!=='CORRUPT_SAVE'||typeof raw!=='string')return;
  // Native confirmation may suspend or BFCache a mobile page.
  const confirmationEpoch=storageEpoch;
  if(!window.confirm('将异常剧情工作台记录保存为本地文本文件？文件可能包含个人游玩信息，请妥善保管；不会上传或修改浏览器存档。'))return;
  if(saving||pageSuspended()||storageEpoch!==confirmationEpoch)return;
  const evidence=captureStoryWorkshopEvidence(storage,{key:STORY_WORKSHOP_KEY,expectedRaw:raw,confirmedByUser:true});
  if(!evidence.ok){
    if(evidence.code==='STALE_SNAPSHOT'){blocked=true;reason='WRITE_CONFLICT';render();}
    $('board-notice').textContent=evidence.code==='TOO_LARGE'
      ? '异常记录过大，已拒绝导出；原存档仍在浏览器，请勿重置或清除数据。'
      : '原始记录已变化或无法读取，已拒绝导出；请重新打开页面核对。';
    return;
  }
  try{
    const download=prepareStoryEvidenceDownload(evidence.content,'yunyu-story-workshop-corrupt-save');
    // A peer may replace the save while the UTF-16 evidence file is prepared.
    // Recheck the exact bytes and lifecycle immediately before the Blob click.
    if(saving||pageSuspended()||storageEpoch!==confirmationEpoch||
      !isPreparedStoryEvidenceCurrent(storage,{
        key:STORY_WORKSHOP_KEY,expectedRaw:evidence.content,download
      })){
      $('board-notice').textContent='异常工作台记录在文件准备期间已变化或页面暂停，已取消下载；请重新打开页面核对原始存档。';
      return;
    }
    // Share the bounded Blob URL lifecycle with normal-mode exports:
    // timers may pause in Safari/WebView; a click never proves disk persistence.
    const receipt=requestBrowserSaveDownload({
      ok:true,content:download.content,filename:download.filename,
      mime:download.wrapped?'application/json;charset=utf-8':'text/plain;charset=utf-8'
    },{
      // P88: Blob creation and DOM insertion can synchronously change storage
      // or suspend a mobile page; authorize only immediately before a.click().
      authorizeClick:()=>!saving&&!pageSuspended()&&storageEpoch===confirmationEpoch&&
        isPreparedStoryEvidenceCurrent(storage,{
          key:STORY_WORKSHOP_KEY,expectedRaw:evidence.content,download
        })
    });
    if(!receipt.ok){
      $('board-notice').textContent=receipt.reason==='DOWNLOAD_SOURCE_CHANGED'||
        receipt.reason==='DOWNLOAD_AUTHORIZATION_UNAVAILABLE'
        ? '异常工作台记录在下载发起前已变化或页面暂停，已取消下载；请重新打开页面核对原始存档。'
        : receipt.reason==='DOWNLOAD_TOO_LARGE'
        ? '异常记录编码后超过安全下载上限，已拒绝导出；原始存档仍保留，请勿重置。'
        : receipt.reason==='DOWNLOAD_LIMIT_REACHED'
          ? '待处理下载过多，请稍后再试并核对已有文件；原始存档仍保留。'
          : '设备未能触发文件导出；原浏览器存档未修改，请勿重置。';
      return;
    }
    $('board-notice').textContent='已尝试下载异常记录'+
      (download.wrapped?'（UTF-16 JSON 证据封装，非可直接导入的存档）':'')+
      '。请先在设备“文件”中确认备份存在；原浏览器存档未修改。';
  }catch{
    $('board-notice').textContent='证据文件准备失败；原浏览器存档未修改，请勿重置。';
  }
});
$('reset-workshop').addEventListener('click',async()=>{
  if(saving||pageSuspended())return;
  // A queued click must not bypass the disabled reset button on storage failure.
  if(reason==='STORAGE_UNAVAILABLE')return;
  // Both dialogs belong to one uninterrupted visible-page interaction.
  const confirmationEpoch=storageEpoch;
  if(reason==='CORRUPT_SAVE'&&!window.confirm('异常原始记录会被重置覆盖。建议先导出并确认备份文件可用。仍要继续重置吗？'))return;
  if(pageSuspended()||storageEpoch!==confirmationEpoch)return;
  if(!window.confirm('确认重置剧情工作台？此处的金币、物品和订单进度将丢失，不影响普通经营或已读剧情。'))return;
  if(pageSuspended()||storageEpoch!==confirmationEpoch)return;
  const preflight=checkStoryResumeSnapshot(storage,{key:STORY_WORKSHOP_KEY,expectedRaw:raw});
  if(!preflight.ok){
    blockWorkshopWithNotice(preflight.reason,'确认期间工作台存档发生变化，重置已取消；请重新打开页面核对。');
    return;
  }
  // Only enter the same Web Locks protocol as normal workshop writes AFTER confirmation.
  // The lock callback re-reads the original snapshot and still requires exact-raw CAS.
  const expectedRaw=raw,expectedEpoch=storageEpoch;
  saving=true;render();
  const attempt=await resetStoryWorkshopWithLock(webLocks,storage,{
    expectedRaw,isCurrent:()=>storageEpoch===expectedEpoch&&!pageSuspended()
  });
  saving=false;
  if(!attempt.ok||!attempt.value||storageEpoch!==expectedEpoch){
    // A failed/rejected lock does not prove whether a reset already committed.
    // Replace any earlier success notice only after rendering the blocked UI.
    blockWorkshopWithNotice('WRITE_CONFLICT',
      '重置操作的最终状态无法确认；请勿重复重置，重新打开页面核对金币、建筑与订单。');
    return;
  }
  // The reset may have committed, then lost the race to another tab after
  // releasing the shared lock. A stale page must not announce reset success.
  const expectedWorkshopRaw=JSON.stringify(attempt.value);
  const publication=verifyStoryWorkshopPublication(storage,{
    expectedWorkshopRaw,expectedEpoch,currentEpoch:storageEpoch,suspended:pageSuspended()
  });
  if(!publication.ok||blocked){
    blockWorkshopWithNotice(publication.ok?'WRITE_CONFLICT':publication.reason,
      '重置后的存档状态无法确认；请勿重复重置，重新打开页面核对。');
    return;
  }
  state=attempt.value;raw=expectedWorkshopRaw;
  blocked=false;reason=null;selected=-1;
  $('board-notice').textContent='已重置剧情工作台，请确认金币与订单已归零；已读剧情不受影响。';
  render();
  // Rendering or a synchronous storage event can invalidate the first check.
  // This is read-only and cannot make localStorage transactions atomic.
  const afterResetRender=verifyStoryWorkshopPublication(storage,{
    expectedWorkshopRaw,expectedEpoch,currentEpoch:storageEpoch,suspended:pageSuspended()
  });
  if(!afterResetRender.ok||blocked){
    blockWorkshopWithNotice(afterResetRender.ok?'WRITE_CONFLICT':afterResetRender.reason,
      '重置后的存档在页面更新期间发生变化；刚才的重置成功提示已撤回，请勿重复重置，重新打开页面核对。');
  }
});
function recheckWorkshopOnResume(){
  // A pagehide requires an actual pageshow; visibility/focus alone is not a
  // trusted BFCache return. Never inspect hidden pages to enable controls.
  if(document.visibilityState==='hidden'||(pageGone&&!resumePending))return;
  const resumeLifecycleEpoch=lifecycleEpoch;
  if(!blocked){
    const check=checkStoryResumeSnapshot(storage,{key:STORY_WORKSHOP_KEY,expectedRaw:raw});
    if(!check.ok){
      storageEpoch++;
      blockWorkshopWithNotice(check.reason,
        '页面恢复时发现工作台存档已变化或无法读取；此前提示不再可信，请重新打开页面核对进度。');
      return;
    }
  }
  // Storage getItem() may synchronously fire pagehide or hidden visibility.
  // Keep controls suspended until a NEW visible return verifies the snapshot.
  if(lifecycleEpoch!==resumeLifecycleEpoch||document.visibilityState==='hidden'||
    (pageGone&&!resumePending))return;
  pageGone=false;visibilitySuspended=false;resumePending=false;
  render();
}
function suspendWorkshopPage({gone=false}={}){
  lifecycleEpoch++;
  if(gone){pageGone=true;resumePending=false;}
  else visibilitySuspended=true;
  // An in-flight Web Lock must not publish a success after page suspension.
  storageEpoch++;selected=-1;
  render();
  $('board-notice').textContent='页面已暂停经营操作；返回后请先核对存档，不要重复提交。';
}
window.addEventListener('pagehide',()=>suspendWorkshopPage({gone:true}));
window.addEventListener('pageshow',()=>{
  if(document.visibilityState==='hidden'){
    if(pageGone)resumePending=true;
    return;
  }
  resumePending=pageGone;
  recheckWorkshopOnResume();
});
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden')suspendWorkshopPage();
  else if(!pageGone||resumePending)recheckWorkshopOnResume();
});
window.addEventListener('storage',event=>{
  if(shouldBlockStoryStorageEvent(event,{key:STORY_WORKSHOP_KEY,storage})){
    storageEpoch++;
    blockWorkshopWithNotice('WRITE_CONFLICT',
      '检测到其他标签页修改了工作台存档；此前成功提示不再可信，请重新打开页面核对进度。');
  }else if(shouldRefreshWorkshopForStoryEvent(event,storage)){
    // Story chapter progress changes building eligibility without changing the board.
    render();
  }
});
render();
