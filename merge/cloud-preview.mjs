import {CHAINS,getItemIcon,getItemName,validateSave,SUPPLY_ITEMS} from './engine.mjs';
import {openToolboxPrivateCloudSession,adaptToolboxCloudAuth} from './cloud/toolbox-auth-adapter.mjs';
import {openPrivateStoryCloudSession} from './cloud/story-private-sync.mjs';
import {openStoryPersistence} from './story/indexeddb-persistence.mjs';
import {openNormalPersistence} from './normal-indexeddb-persistence.mjs';
import {createNormalMigrationManifest} from './cloud/normal-migration-review.mjs';

const $=id=>document.getElementById(id);
const auth=window.ToolboxAuth;
const game=$('game'),cloud=$('cloud'),story=$('story');
let session=null,storySession=null,storyBackend=null,busy=false;
let selected=-1,reviewedLocal=null,reviewedRemote=null,backedUpRaw=null;
let migrationReview=null,migrationStore=null;
const identity=()=>auth?adaptToolboxCloudAuth(auth):null;
const message=(id,value)=>{$(id).textContent=String(value)};
const confirmed=()=>session?.preview()?.verified===true;
const current=()=>confirmed()?session.preview().state:null;
const boardViewport=$('cloud-board-viewport');
const boardControls=$('cloud-board-controls');
const boardLeft=$('cloud-board-left');
const boardRight=$('cloud-board-right');
function updateCloudBoardNavigation(){
  const max=Math.max(0,boardViewport.scrollWidth-boardViewport.clientWidth);
  boardControls.hidden=max<=1||game.hidden;
  boardLeft.disabled=max<=1||boardViewport.scrollLeft<=1;
  boardRight.disabled=max<=1||boardViewport.scrollLeft>=max-1;
}
function scrollCloudBoard(direction){
  const step=Math.max(44,Math.floor(boardViewport.clientWidth*.7));
  const max=Math.max(0,boardViewport.scrollWidth-boardViewport.clientWidth);
  boardViewport.scrollLeft=Math.max(0,Math.min(max,boardViewport.scrollLeft+direction*step));
  updateCloudBoardNavigation();
}
boardLeft.addEventListener('click',()=>scrollCloudBoard(-1));
boardRight.addEventListener('click',()=>scrollCloudBoard(1));
boardViewport.addEventListener('scroll',updateCloudBoardNavigation,{passive:true});
window.addEventListener('resize',updateCloudBoardNavigation,{passive:true});
window.addEventListener('pageshow',updateCloudBoardNavigation);

function toggleControls(){
  const ready=!!session&&!busy;
  for(const id of ['connect','retry','review'])$(id).disabled=!ready;
  for(const button of game.querySelectorAll('button'))button.disabled=!ready||!confirmed()||
    (session.preview().pending>0);
  $('story-init').disabled=!ready;
  $('migration-export').disabled=!ready;
  $('migration-claim').disabled=!ready||!migrationReview||!confirmed()||
    session.preview().pending>0;
  for(const id of ['story-read','story-backup','story-upload','story-retry','story-restore'])
    $(id).disabled=!storySession||busy;
}
function stateStatus(result){
  if(!session){message('cloud-status','尚未登录');return}
  const snap=session.preview();
  if(result?.ok===true&&snap.verified===true){
    message('cloud-status','服务器已验证 · 云端经营版本 '+snap.revision+
      ' · 未确认指令 '+snap.pending);
  }else if(snap.pending>0){
    message('cloud-status','存在 '+snap.pending+' 条未确认操作，已保留原编号。请先重试或人工核对，勿清理浏览器数据。');
  }else{
    message('cloud-status','云存档未得到服务器确认：'+
      (result?.code??snap.code??'未连接')+'。本地试玩不受影响。');
  }
}
function blockPlayerAction(){
  if(!session||busy||!confirmed()||session.preview().pending>0){
    stateStatus();return true;
  }
  return false;
}
const itemLabel=item=>item?(getItemIcon(item)+' '+getItemName(item)):'空位';
function button(title,cb,disabled=false){
  const b=document.createElement('button');b.type='button';b.textContent=title;
  b.disabled=disabled;b.addEventListener('click',cb);return b;
}
function render(){
  const s=current(),ready=!!s&&!busy;
  game.hidden=!s||!validateSave(s);
  if(!s||!validateSave(s)){
    updateCloudBoardNavigation();
    toggleControls();return;
  }
  message('coins','金币 '+s.coins);message('energy','体力 '+s.energy);
  message('xp','经验 '+s.xp);message('revision','版本 '+s.revision);
  const selectedItem=s.board[selected];
  message('selection',selectedItem?'当前选择：第 '+(selected+1)+' 格 '+itemLabel(selectedItem):'先选材料后选目标格；点击工坊直接生产');
  const board=$('cloud-board');board.replaceChildren();
  s.board.forEach((item,slot)=>{
    const b=button(itemLabel(item),()=>{
      if(blockPlayerAction())return;
      if(item?.kind==='producer'){selected=slot;void perform({type:'produce',slot});return}
      if(selected>=0&&selected!==slot){
        const from=selected;selected=-1;void perform({type:'move',from,to:slot});return;
      }
      selected=slot;render();
    },!ready);
    b.setAttribute('aria-label','第'+(slot+1)+'格：'+itemLabel(item));
    b.setAttribute('aria-pressed',String(selected===slot));
    board.append(b);
  });
  if(!board.parentElement.classList.contains('board-scroll')){
    const wrapper=document.createElement('div');wrapper.className='board-scroll';
    board.parentNode.insertBefore(wrapper,board);wrapper.append(board);
  }
  const warehouse=$('cloud-warehouse');warehouse.replaceChildren();
  for(let i=0;i<s.warehouse.capacity;i++){
    const item=s.warehouse.slots[i];
    warehouse.append(button('仓库'+(i+1)+'：'+itemLabel(item),()=>{
      if(!blockPlayerAction()&&item)void perform({type:'withdraw',slot:i});
    },!ready||!item));
  }
  const orders=$('cloud-orders');orders.replaceChildren();
  s.orders.forEach(o=>{
    const el=document.createElement('section');
    const label=document.createElement('strong');
    label.textContent='订单 '+o.id+' · 奖励 '+o.coins+' 金币';
    el.append(label,button('交付订单',()=>void perform({type:'order',orderId:o.id}),!ready));
    orders.append(el);
  });
  const buildings=$('cloud-buildings');buildings.replaceChildren();
  for(const id of ['storefront','garden','harbor'])
    buildings.append(button('升级 '+id,()=>void perform({type:'upgradeBuilding',buildingId:id}),!ready));
  const supply=$('cloud-supplies');supply.replaceChildren();
  for(const [id,def] of Object.entries(SUPPLY_ITEMS)){
    const el=document.createElement('section'),t=document.createElement('strong');
    t.textContent=def.name+' · 背包 '+s.bag[id]+' · 已购 '+s.shop.purchases[id]+'/'+def.limit;
    const producer=s.board[selected]?.kind==='producer'?s.board[selected].id:null;
    el.append(t,button('花 '+def.price+' 金币购买',()=>void perform({type:'purchaseSupply',itemId:id}),
      !ready||s.coins<def.price),
      button('使用',()=>{
        if(!def.energy&&!producer){message('cloud-status','请先选中要加速的工坊');return}
        void perform({type:'useSupply',itemId:id,producerId:producer});
      },!ready||s.bag[id]<1));
    supply.append(el);
  }
  toggleControls();
  // After Safari/WebView layout settles, reveal keyboard-accessible arrows
  // only if the board actually overflows its scroll region.
  requestAnimationFrame(updateCloudBoardNavigation);
}
async function run(task){
  if(busy)return;
  busy=true;toggleControls();
  try{return await task()}
  catch(error){message('cloud-status','网络或验证失败：'+(error?.code??'SERVER_UNAVAILABLE'))}
  finally{busy=false;render()}
}
async function connect(){
  const result=await session.connect();
  if(result.ok){selected=-1;render()}
  stateStatus(result);
  return result;
}
async function perform(action){
  if(blockPlayerAction())return;
  await run(async()=>{
    const queued=await session.enqueue(action);
    if(!queued.ok){stateStatus(queued);return}
    const result=await session.flush();
    if(result.ok)selected=-1;
    stateStatus(result);
  });
}
function initLogin(){
  if(!auth){message('login-status','工具箱登录组件不可用，禁止云端操作');return}
  const stored=auth.peekSession?.();
  if(stored?.access_token)void loginAndOpen();
}
async function loginAndOpen(){
  if(!auth)return;
  try{
    session=await openToolboxPrivateCloudSession({
      toolboxAuth:auth,storage:window.localStorage,locks:navigator.locks,
      fetchImpl:window.fetch.bind(window)
    });
    $('login').hidden=true;cloud.hidden=false;story.hidden=false;
    message('account-label','已验证的账号：'+session.uid.slice(0,8)+'…');
    message('cloud-status','已验证本地登录身份；云服务器尚未确认');
    render();await run(connect);
  }catch(error){
    message('login-status','云端身份验证未通过：'+(error?.code??'AUTH_REQUIRED'));
    session=null;cloud.hidden=true;story.hidden=true;
  }
}
$('login-form').addEventListener('submit',event=>{
  event.preventDefault();
  void (async()=>{
    const email=$('login-email').value.trim(),password=$('login-password').value;
    $('login-password').value='';
    try{
      await auth.signIn(email,password);
      await loginAndOpen();
    }catch(error){message('login-status',auth?.authMessage?.(error)??'登录失败')}
  })();
});
$('connect').addEventListener('click',()=>void run(connect));
$('retry').addEventListener('click',()=>void run(async()=>{
  const result=await session.flush({force:true});
  stateStatus(result);
}));
$('review').addEventListener('click',()=>void run(async()=>{
  const record=await session.inspectConflict();
  if(!record.ok){message('cloud-status','当前没有可以安全人工处理的明确冲突：'+record.code);return}
  const question='服务器已拒绝该操作。确认放弃这条失败指令和之后所有未发送指令吗？';
  if(!window.confirm(question))return;
  stateStatus(await session.discardConflicted({confirmedByUser:true}));
}));
$('migration-export').addEventListener('click',()=>void run(async()=>{
  const backend=await openNormalPersistence({
    legacyStorage:localStorage,nativeLocks:navigator.locks,
    indexedDB,Channel:BroadcastChannel
  });
  if(backend.backend==='read-only'){
    message('migration-status','本地存档不可安全读取，已停止。请保留所有原始数据。');
    return;
  }
  const manifest=await createNormalMigrationManifest(backend.storage);
  if(!manifest.ok){
    message('migration-status','本地旧档校验失败：'+manifest.code);return;
  }
  const downloaded=JSON.stringify({...manifest,uid:session.uid,
    createdAt:new Date().toISOString()});
  const blob=new Blob([downloaded],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='yunyu-normal-review-'+manifest.sha256.slice(0,12)+'.json';
  a.hidden=true;document.body.append(a);
  try{
    a.click();migrationReview=manifest;migrationStore=backend.storage;
    message('migration-status','已发起本地下载。请确认文件保存，交由管理员独立核对；SHA-256：'+manifest.sha256);
  }finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}
}));
$('migration-claim').addEventListener('click',()=>void run(async()=>{
  if(!migrationReview||!migrationStore||session.preview().pending>0||
     session.preview().verified!==true){
    message('migration-status','云端或本地存档尚未核验');return;
  }
  const again=await createNormalMigrationManifest(migrationStore);
  if(!again.ok||again.sha256!==migrationReview.sha256||
     again.raw!==migrationReview.raw){
    message('migration-status','本地原始进度已变化，必须重新审核并下载');return;
  }
  if(!window.confirm('只有管理员预先审核且批准的云档才可领取。确认原文件已经另行备份，且领取后云端使用管理员批准的存档吗？'))return;
  const result=await session.claimApproved({
    sourceSha256:again.sha256,confirmedByUser:true
  });
  message('migration-status',result.ok
    ?'服务器已确认一次性审核迁移，云端版本 '+result.revision
    :'未获得迁移许可或操作结果未确认：'+result.code+'。本地旧档保持不变。');
  if(result.ok){selected=-1;render();stateStatus(result)}
}));
$('sign-out').addEventListener('click',()=>void run(async()=>{
  await auth.signOut();session=null;storySession=null;
  migrationReview=null;migrationStore=null;
  cloud.hidden=true;story.hidden=true;game.hidden=true;$('login').hidden=false;
  message('login-status','已退出，未删除云端或本地存档');
}));
$('store-selected').addEventListener('click',()=>{
  const s=current(),item=s?.board[selected];
  if(item?.kind==='material')void perform({type:'store',slot:selected});
});
$('upgrade-producer').addEventListener('click',()=>{
  const item=current()?.board[selected];
  if(item?.kind==='producer')void perform({type:'upgradeProducer',producerId:item.id});
});
$('upgrade-warehouse').addEventListener('click',()=>void perform({type:'upgradeWarehouse'}));
$('discard-selected').addEventListener('click',()=>{
  const item=current()?.board[selected];
  if(item?.kind!=='material')return;
  if(!window.confirm('只在真正死局时允许弃置这件原料。确认不可逆地弃置吗？'))return;
  void perform({type:'discard',slot:selected,expectedItemId:item.id});
});
async function initStory(){
  if(!session)return;
  try{
    storyBackend=await openStoryPersistence({
      legacyStorage:localStorage,nativeLocks:null,indexedDB,Channel:BroadcastChannel
    });
    if(storyBackend.backend!=='indexeddb')
      throw Error('STORY_LOCAL_ATOMIC_STORAGE_UNAVAILABLE');
    storySession=await openPrivateStoryCloudSession({
      projectUrl:auth.url,publishableKey:auth.key,auth:identity(),
      localPersistence:storyBackend,indexedDB,fetchImpl:window.fetch.bind(window)
    });
    reviewedLocal=await storySession.inspectLocal();
    if(!reviewedLocal.ok)throw Error(reviewedLocal.code);
    message('story-status','本地剧情版本 '+reviewedLocal.pair.progress.revision+
      ' · 工作台版本 '+reviewedLocal.pair.workshop.revision+
      '。尚未上传。先查看云档并下载备份。');
  }catch(error){
    storySession=null;message('story-status','无法启用剧情云存档：'+(error?.code??error?.message??'UNKNOWN'));
  }
}
$('story-init').addEventListener('click',()=>void run(initStory));
$('story-read').addEventListener('click',()=>void run(async()=>{
  reviewedRemote=await storySession.readRemote();
  const local=await storySession.inspectLocal();
  if(!local.ok){message('story-status','本地双档无法核验：'+local.code);return}
  reviewedLocal=local;
  message('story-status','本地剧情/工作台修订 '+local.pair.progress.revision+' / '+
    local.pair.workshop.revision+'；云端状态 '+reviewedRemote.status+
    '，云版本 '+reviewedRemote.revision+'。不会自动覆盖任一存档。');
}));
$('story-backup').addEventListener('click',()=>void run(async()=>{
  const local=await storySession.inspectLocal();
  if(!local.ok){message('story-status','本地双档无法核验：'+local.code);return}
  const raw=JSON.stringify({kind:'yunyu-story-backup-v1',
    capturedAt:new Date().toISOString(),progressRaw:local.raw[0],
    workshopRaw:local.raw[1]});
  const blob=new Blob([raw],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='yunyu-story-local-backup.json';a.hidden=true;
  document.body.append(a);
  try{a.click();backedUpRaw=local.raw.slice();
    message('story-status','已发起浏览器本地备份下载，请确认文件已保存后再进行云端恢复。');
  }finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}
}));
$('story-upload').addEventListener('click',()=>void run(async()=>{
  const local=await storySession.inspectLocal();
  if(!local.ok){message('story-status','本地档无法读取：'+local.code);return}
  const remote=await storySession.readRemote();
  if(!remote.ok){message('story-status','无法确认云端状态');return}
  const overwrite=remote.pair!==null;
  if(!window.confirm(overwrite
    ?'云端已有剧情档。确认提交当前本地双档作为新版本？旧云档不会自动恢复，若发生冲突将拒绝。'
    :'云端暂无剧情档。确认将当前本地进度和工作台作为首份云备份？'))return;
  const queued=await storySession.prepareUpload({
    confirmedByUser:true,reviewedLocalRaw:local.raw,
    expectedRemoteRevision:remote.revision,allowReplace:overwrite
  });
  if(!queued.ok){message('story-status','不能提交：'+queued.code);return}
  const result=await storySession.sendPending();
  message('story-status',result.ok?'剧情双档已由服务器确认，版本 '+result.revision:
    '尚未确认云端提交：'+result.code+'。请保留原编号，下次点击恢复上传。');
}));
$('story-retry').addEventListener('click',()=>void run(async()=>{
  const result=await storySession.sendPending();
  message('story-status',result.ok?'原编号上传已确认：云版本 '+result.revision:
    '结果未确定，勿清除浏览器数据：'+result.code);
}));
$('story-restore').addEventListener('click',()=>void run(async()=>{
  if(!backedUpRaw){message('story-status','请先下载并核对本地备份');return}
  const local=await storySession.inspectLocal();
  if(!local.ok){message('story-status','本地存档无法核验');return}
  if(JSON.stringify(backedUpRaw)!==JSON.stringify(local.raw)){
    message('story-status','下载备份后本地存档已变化，请重新备份');return;
  }
  const remote=await storySession.readRemote();
  if(!remote.ok||!remote.pair){message('story-status','服务器没有可恢复的双档');return}
  if(!window.confirm('确认将服务器两份剧情存档原子恢复到本机？必须已下载且保留旧档文件。'))return;
  const result=await storySession.restoreReviewedCloud({
    confirmedByUser:true,backupDownloaded:true,
    reviewedRemoteRevision:remote.revision,reviewedPair:remote.pair,
    reviewedLocalRaw:local.raw
  });
  message('story-status',result.ok?'剧情双档已在本机 IndexedDB 原子恢复':
    '已阻止不安全的恢复：'+result.code);
}));
initLogin();
