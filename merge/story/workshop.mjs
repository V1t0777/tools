import {WIDTH,MAX_ENERGY,CHAINS,getLevel,moveOrMerge,produce,fulfillOrder,storeItem,withdrawItem,upgradeBuilding,getItemIcon,getItemName} from '../engine.mjs';
import {BUILDINGS} from '../economy.mjs';
import {readStoryWorkshop,writeStoryWorkshop,STORY_WORKSHOP_KEY} from './workshop-storage.mjs';
import {readStorySave} from './local-storage.mjs';
import {captureStoryWorkshopEvidence} from './save-evidence.mjs';
import {checkStoryResumeSnapshot} from './resume-guard.mjs';
import {verifyStoryWorkshopPublication} from './workshop-publication-guard.mjs';
import {runStoryWriteWithLock} from './write-lock.mjs';
import {resetStoryWorkshopWithLock} from './workshop-reset.mjs';
import {shouldBlockStoryStorageEvent} from './storage-event-guard.mjs';
import {shouldRefreshWorkshopForStoryEvent} from './storage-event-guard.mjs';
import {storyGardenBuildAvailable,storyHarborBuildAvailable,storyStorefrontBuildAvailable} from './workshop-gate.mjs';
import {storyBuildingWriteAllowed} from './building-commit-guard.mjs';
const $=id=>document.getElementById(id);
const storage=(()=>{try{return window.localStorage;}catch{return null;}})();
const webLocks=(()=>{try{return window.navigator?.locks??null;}catch{return null;}})();
const loaded=readStoryWorkshop(storage);
let state=loaded.state,raw=loaded.raw,blocked=loaded.blocked,reason=loaded.reason,selected=-1;
let saving=false;
let storageEpoch=0; // increments when an external story-workshop snapshot invalidates this page
function status(){
  $('workshop-status').textContent=blocked
    ? reason==='CORRUPT_SAVE'
      ? '剧情工作台存档损坏：原数据未覆盖。请先考虑导出异常原始记录备份，再决定是否重置。'
      : reason==='STORAGE_UNAVAILABLE'
        ? '无法访问浏览器存储，经营操作已暂停。'
        : '检测到存档变化或写入无法确认：本页已停止操作。请勿重复重置，先重新打开页面核对金币、建筑和订单。'
    : '剧情工作台数据只保存在此浏览器，与普通模式金币及背包完全隔离。';
}
function render(){
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
    button.disabled=blocked||saving;
    button.dataset.slot=String(i);
    button.setAttribute('aria-label','第'+(Math.floor(i/WIDTH)+1)+'行第'+(i%WIDTH+1)+'列，'+(item?getItemName(item):'空格'));
    if(item){
      const glyph=document.createElement('span');glyph.className='glyph';glyph.textContent=getItemIcon(item);
      button.append(glyph);
      const info=document.createElement('span');info.className='tier';
      info.textContent=item.kind==='producer'?(item.charges>0?item.charges+'次':'冷却中'):'Lv.'+item.tier;
      button.append(info);
    }
    button.addEventListener('click',()=>touch(i));fragment.append(button);
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
  $('store-selected').disabled=blocked||saving||!selectedMaterial||!warehouseHasSpace;
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
    button.disabled=blocked||saving||!item||!boardHasSpace;
    button.setAttribute('aria-label','仓库第'+(i+1)+'格，'+(item?'取回'+getItemName(item):'空位'));
    button.textContent=item
      ? getItemIcon(item)+' '+getItemName(item)+' · Lv.'+item.tier+' · 取回'
      : '第'+(i+1)+'格 · 空位';
    button.addEventListener('click',()=>commit(withdrawItem(state,i)));
    bankFragment.append(button);
  }
  bank.append(bankFragment);
  const list=$('workshop-orders');list.replaceChildren();
  for(const order of state.orders){
    const row=document.createElement('div');row.className='workshop-order';
    const mark=document.createElement('span');
    mark.textContent=CHAINS[order.chain].icon[order.tier-1]+' '+CHAINS[order.chain].names[order.tier-1]+' · ◈'+order.coins;
    const btn=document.createElement('button');btn.type='button';btn.textContent='交付';
    btn.disabled=blocked||saving||!state.board.some(item=>item?.kind==='material'&&item.chain===order.chain&&item.tier===order.tier);
    btn.addEventListener('click',()=>commit(fulfillOrder(state,order.id)));
    row.append(mark,btn);list.append(row);
  }
  const garden=BUILDINGS.garden,level=getLevel(state.xp),built=state.buildings.garden===1;
  const narrative=readStorySave(storage);
  const gardenStoryReady=!narrative.blocked&&storyGardenBuildAvailable(narrative.progress);
  $('garden-status').textContent=built?'已修复':'未修复';
  $('garden-hint').textContent=built
    ? '花园已修复。返回剧情页继续《两个人的下午茶》。'
    : !gardenStoryReady
      ? '先在剧情页完成《没有开花的花圃》，再来修复后院花园。'
      : '需要 '+garden.minLevel+' 级和 '+garden.coins+' 金币；当前 '+level+' 级、'+state.coins+' 金币。通过交付委托积累资源。';
  $('build-garden').disabled=blocked||saving||built||!gardenStoryReady||level<garden.minLevel||state.coins<garden.coins;
  const harbor=BUILDINGS.harbor,harborBuilt=state.buildings.harbor===1;
  const harborStoryReady=!narrative.blocked&&storyHarborBuildAvailable(narrative.progress);
  $('harbor-status').textContent=harborBuilt?'已修缮':'未修缮';
  $('harbor-hint').textContent=harborBuilt
    ? '港湾街角已修缮。返回剧情页继续《海雾里的灯》。'
    : !harborStoryReady
      ? '先完成《第一次独立修理》，确认学徒与岚叔的安全准备，再进行港湾修缮。'
      : '需要 '+harbor.minLevel+' 级和 '+harbor.coins+' 金币；当前 '+level+' 级、'+state.coins+' 金币。';
  $('build-harbor').disabled=blocked||saving||harborBuilt||!harborStoryReady||level<harbor.minLevel||state.coins<harbor.coins;
  const storefront=BUILDINGS.storefront,storefrontBuilt=state.buildings.storefront===1;
  const storefrontStoryReady=!narrative.blocked&&storyStorefrontBuildAvailable(narrative.progress);
  $('storefront-status').textContent=storefrontBuilt?'已修整':'未修整';
  $('storefront-hint').textContent=storefrontBuilt
    ? '百物铺门面已修整。返回剧情页参加《大家的开张庆典》。'
    : !storefrontStoryReady
      ? '先读完《海雾里的灯》，再为居民们准备开张庆典。'
      : '修整门面需要 '+storefront.minLevel+' 级和 '+storefront.coins+' 金币；目前 '+level+' 级、'+state.coins+' 金币。';
  $('build-storefront').disabled=blocked||saving||storefrontBuilt||!storefrontStoryReady||level<storefront.minLevel||state.coins<storefront.coins;
  $('reset-workshop').disabled=saving||reason==='STORAGE_UNAVAILABLE';
  $('export-corrupt-workshop').disabled=saving||reason!=='CORRUPT_SAVE'||typeof raw!=='string';
}
async function commit(result){
  // One in-flight action per tab; Web Locks serializes participating tabs.
  // The existing exact-raw CAS remains mandatory inside the lock callback.
  if(blocked||saving)return;
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
    ()=>!blocked&&storyBuildingWriteAllowed(storage,state,result.state,expectedStoryRaw)&&
      writeStoryWorkshop(storage,result.state,{expectedRaw}));
  saving=false;
  // A verified write can be superseded after the Web Lock is released.
  // Never publish a success message from an already stale workshop snapshot.
  const expectedWorkshopRaw=attempt.ok&&attempt.value===true
    ? JSON.stringify(result.state):null;
  const publication=expectedWorkshopRaw===null
    ? {ok:false,reason:'WRITE_CONFLICT'}
    : verifyStoryWorkshopPublication(storage,{expectedWorkshopRaw,expectedStoryRaw,
      buildingChanged,expectedEpoch,currentEpoch:storageEpoch});
  if(!publication.ok||blocked){
    blocked=true;reason=publication.ok?'WRITE_CONFLICT':publication.reason;
    selected=-1;render();return;
  }
  state=result.state;raw=JSON.stringify(state);selected=-1;
  $('board-notice').textContent=result.message;
  render();
  // Rendering may invoke synchronous browser/test hooks. Recheck the exact
  // raw bytes and epoch; this remains read-only and is not a cross-tab CAS.
  const afterRender=verifyStoryWorkshopPublication(storage,{expectedWorkshopRaw,
    expectedStoryRaw,buildingChanged,expectedEpoch,currentEpoch:storageEpoch});
  if(!afterRender.ok||blocked){
    blocked=true;reason=afterRender.ok?'WRITE_CONFLICT':afterRender.reason;
    selected=-1;render();
  }
}
function touch(index){
  if(blocked||saving)return;
  const item=state.board[index];
  if(item?.kind==='producer'){commit(produce(state,index));return;}
  if(selected===-1){if(item){selected=index;render();}return;}
  if(selected===index){selected=-1;render();return;}
  commit(moveOrMerge(state,selected,index));
}
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
  if(reason!=='CORRUPT_SAVE'||typeof raw!=='string')return;
  if(!window.confirm('将异常剧情工作台记录保存为本地文本文件？文件可能包含个人游玩信息，请妥善保管；不会上传或修改浏览器存档。'))return;
  const evidence=captureStoryWorkshopEvidence(storage,{key:STORY_WORKSHOP_KEY,expectedRaw:raw,confirmedByUser:true});
  if(!evidence.ok){
    if(evidence.code==='STALE_SNAPSHOT'){blocked=true;reason='WRITE_CONFLICT';render();}
    $('board-notice').textContent=evidence.code==='TOO_LARGE'
      ? '异常记录过大，已拒绝导出；原存档仍在浏览器，请勿重置或清除数据。'
      : '原始记录已变化或无法读取，已拒绝导出；请重新打开页面核对。';
    return;
  }
  let url;
  try{
    url=URL.createObjectURL(new Blob([evidence.content],{type:'text/plain;charset=utf-8'}));
    const a=document.createElement('a');
    a.href=url;a.download='yunyu-story-workshop-corrupt-save.txt';
    document.body.append(a);a.click();a.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),60000);
    $('board-notice').textContent='已尝试下载异常记录，请先在设备“文件”中确认备份存在；原浏览器存档未修改。';
  }catch{
    if(url)URL.revokeObjectURL(url);
    $('board-notice').textContent='设备未能触发文件导出。原浏览器存档未修改，请勿重置。';
  }
});
$('reset-workshop').addEventListener('click',async()=>{
  if(saving)return;
  if(reason==='CORRUPT_SAVE'&&!window.confirm('异常原始记录会被重置覆盖。建议先导出并确认备份文件可用。仍要继续重置吗？'))return;
  if(!window.confirm('确认重置剧情工作台？此处的金币、物品和订单进度将丢失，不影响普通经营或已读剧情。'))return;
  // Only enter the same Web Locks protocol as normal workshop writes AFTER confirmation.
  // The lock callback re-reads the original snapshot and still requires exact-raw CAS.
  const expectedRaw=raw,expectedEpoch=storageEpoch;
  saving=true;render();
  const attempt=await resetStoryWorkshopWithLock(webLocks,storage,{
    expectedRaw,isCurrent:()=>storageEpoch===expectedEpoch
  });
  saving=false;
  if(!attempt.ok||!attempt.value||storageEpoch!==expectedEpoch){
    blocked=true;reason='WRITE_CONFLICT';render();return;
  }
  // The reset may have committed, then lost the race to another tab after
  // releasing the shared lock. A stale page must not announce reset success.
  const expectedWorkshopRaw=JSON.stringify(attempt.value);
  const publication=verifyStoryWorkshopPublication(storage,{
    expectedWorkshopRaw,expectedEpoch,currentEpoch:storageEpoch
  });
  if(!publication.ok||blocked){
    blocked=true;reason=publication.ok?'WRITE_CONFLICT':publication.reason;
    selected=-1;
    $('board-notice').textContent='重置后的存档状态无法确认；请勿重复重置，重新打开页面核对。';
    render();return;
  }
  state=attempt.value;raw=expectedWorkshopRaw;
  blocked=false;reason=null;selected=-1;
  $('board-notice').textContent='已重置剧情工作台，请确认金币与订单已归零；已读剧情不受影响。';
  render();
  // Rendering or a synchronous storage event can invalidate the first check.
  // This is read-only and cannot make localStorage transactions atomic.
  const afterResetRender=verifyStoryWorkshopPublication(storage,{
    expectedWorkshopRaw,expectedEpoch,currentEpoch:storageEpoch
  });
  if(!afterResetRender.ok||blocked){
    blocked=true;reason=afterResetRender.ok?'WRITE_CONFLICT':afterResetRender.reason;
    selected=-1;
    $('board-notice').textContent='重置后的存档在页面更新期间发生变化；请勿重复重置，重新打开页面核对。';
    render();
  }
});
function recheckWorkshopOnResume(){
  if(!blocked){
    const check=checkStoryResumeSnapshot(storage,{key:STORY_WORKSHOP_KEY,expectedRaw:raw});
    if(!check.ok){storageEpoch++;blocked=true;reason=check.reason;selected=-1;}
  }
  render();
}
window.addEventListener('pageshow',recheckWorkshopOnResume);
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible')recheckWorkshopOnResume();
});
window.addEventListener('storage',event=>{
  if(shouldBlockStoryStorageEvent(event,{key:STORY_WORKSHOP_KEY,storage})){
    storageEpoch++;blocked=true;reason='WRITE_CONFLICT';selected=-1;render();
  }else if(shouldRefreshWorkshopForStoryEvent(event,storage)){
    // Story chapter progress changes building eligibility without changing the board.
    render();
  }
});
render();
