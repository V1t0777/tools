import {CORE_STORY_PACK} from './core-pack.mjs';
import {availableStoryEntries,completedStoryEntries,completeStoryEntry,startCoreStory,dailyStoryIncident,pinnedDailyStoryIncident,pinDailyStoryIncident} from './runtime.mjs';
import {readStorySave} from './local-storage.mjs';
import {incidentWorkshopEcho} from './incident-context.mjs';
import {incidentChoiceEcho} from './incident-choice-context.mjs';
import {mainlineChoiceEcho} from './mainline-choice-context.mjs';
import {storyWorkshopChapterEcho} from './mainline-workshop-context.mjs';
import {readStoryHash} from './story-return-route.mjs';
import {canCommitDailyIncident} from './daily-incident-guard.mjs';
import {isMatchingConcurrentDailyPin} from './daily-pin-reconcile.mjs';
import {adoptConcurrentDailyPinStorageEvent} from './daily-pin-reconcile.mjs';
import {canKeepDialogueAfterDailyPin} from './daily-pin-reconcile.mjs';
import {adoptConcurrentDailyPinOnResume,canKeepResumedStoryDialogue} from './daily-pin-reconcile.mjs';
import {saveStoryDialogueWithLock} from './dialogue-write.mjs';
import {captureStoryWorkshopEvidence} from './save-evidence.mjs';
import {checkStoryResumeSnapshot} from './resume-guard.mjs';
import {shouldBlockStoryStorageEvent} from './storage-event-guard.mjs';
import {shouldRefreshStoryDependencyEvent} from './storage-event-guard.mjs';
import {STORY_WORKSHOP_KEY,readStoryWorkshop} from './workshop-storage.mjs';
import {inspectStoryWorkshopRequirement,inspectStoryWorkshopRequirementFromRead,storyWorkshopRequirement,storyWorkshopGoalHref} from './workshop-gate.mjs';
import {storyDialogueCommitAllowed} from './dialogue-commit-guard.mjs';
import {nextCoreStoryJourney} from './journey-guide.mjs';
import {createEmptyStoryProgress,STORY_SAVE_KEY} from '../mode-boundaries.mjs';

const $=id=>document.getElementById(id);
const store=(()=>{try{return window.localStorage;}catch{return null;}})();
const webLocks=(()=>{try{return window.navigator?.locks??null;}catch{return null;}})();
const loaded=readStorySave(store);
let progress=loaded.progress,raw=loaded.raw,blocked=loaded.blocked,reason=loaded.reason;
let saving=false,storageEpoch=0;
let pinQueued=false;
let kind=readStoryHash(window.location.hash).kind;
let selected=null,selectedChoice=null,selectedIncidentDay=null;
// A resumed dialogue must not reuse workshop-dependent text or choices after
// a peer changed the separate story-workshop save while this page was asleep.
let selectedWorkshopRaw=null,selectedWorkshopReadable=false;
let shownDay=localDay();
const entries=CORE_STORY_PACK.entries;
const main=entries.filter(x=>x.kind==='main');
const choicesById=Object.fromEntries(entries.map(e=>[e.id,e]));
function localDay(){
  const date=new Date();
  const pad=n=>String(n).padStart(2,'0');
  return date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate());
}
async function save(next,reset=false,commitGuard=()=>true,pinDay=null){
  // One pending story write per tab. The same lock covers initialization,
  // completion and explicitly confirmed reset; exact-raw CAS stays mandatory.
  if(blocked&&!reset)return false;
  if(saving)return false;
  const expectedRaw=raw,expectedEpoch=storageEpoch;
  saving=true;render();
  const attempt=await saveStoryDialogueWithLock(webLocks,store,next,{
    expectedRaw,confirmedReset:reset,commitGuard,
    isCurrent:()=>storageEpoch===expectedEpoch&&(!blocked||reset)
  });
  saving=false;
  // A midnight rollover can cancel an auto-pin while waiting for the lock.
  // If the lock callback refused the expired day *without writing*, and the
  // exact raw baseline is still intact, this is a harmless cancellation,
  // not a cross-tab conflict. All other failures remain fail-closed.
  if(pinDay!==null&&localDay()!==pinDay&&attempt.ok&&attempt.value===false&&
    storageEpoch===expectedEpoch&&!blocked){
    const current=readStorySave(store);
    if(!current.blocked&&current.raw===expectedRaw){render();return false;}
  }
  // Another tab may have committed the identical deterministic pin while
  // this tab waited for the story lock. Adopt ONLY byte-exact same-day output.
  // All unrelated changes, malformed saves and lock failures still block.
  if(pinDay!==null&&localDay()===pinDay&&attempt.ok&&attempt.value===false&&
    (!blocked||reason==='WRITE_CONFLICT')){
    const current=readStorySave(store);
    if(!current.blocked&&
      isMatchingConcurrentDailyPin({expectedRaw,observedRaw:current.raw,proposed:next,day:pinDay,pack:CORE_STORY_PACK})){
      progress=current.progress;raw=current.raw;blocked=false;reason=null;
      render();return true;
    }
  }
  if(!attempt.ok||attempt.value!==true||storageEpoch!==expectedEpoch||(!reset&&blocked)){
    blocked=true;reason='WRITE_CONFLICT';render();return false;
  }
  progress=next;raw=JSON.stringify(next);blocked=false;reason=null;
  render();return true;
}
if(!blocked&&!progress.packs.core){
  const next=startCoreStory(progress,CORE_STORY_PACK);
  void save(next);
}
function status(){
  $('save-state').textContent=blocked
    ? reason==='CORRUPT_SAVE'
      ? '检测到异常剧情存档：原始数据已保留，禁止自动覆盖；请确认重置或自行备份后处理。'
      : reason==='STORAGE_UNAVAILABLE'
        ? '浏览器存储不可用：当前只能阅读，无法安全保存剧情。'
        : '存档已被其他标签页改动或写入失败：请重新打开页面核对进度。'
    : '剧情进度已保存到此浏览器；不与普通模式共享经济，也不提供云存档。';
}
function completed(entry){return !!progress.packs.core?.completed[entry.kind].includes(entry.id);}
function card(entry,done=false){
  const wrapper=document.createElement('article');wrapper.className='story-card';
  wrapper.id='story-'+entry.id;
  wrapper.tabIndex=-1;
  const head=document.createElement('div');head.className='story-head';
  const title=document.createElement('h3');title.textContent=entry.title;
  const state=document.createElement('span');state.className='status';
  const requirement=inspectStoryWorkshopRequirement(entry.id,store);
  state.textContent=done?'已阅读':blocked?'存档需核对'
    :requirement.required&&requirement.blocked?'工作台需核对'
      :requirement.required&&!requirement.met?'待完成经营目标'
        :requirement.required?'经营已达标':'可体验';
  head.append(title,state);
  const place=document.createElement('p');place.textContent=entry.chapter+' · '+entry.place;
  const button=document.createElement('button');button.type='button';
  button.textContent=done?'回看剧情':'阅读故事';
  button.disabled=saving;
  button.addEventListener('click',()=>open(entry));
  wrapper.append(head,place);
  if(!done&&requirement.required){
    const goal=document.createElement('p');goal.className='goal-progress';
    goal.textContent=requirement.blocked
      ? '工作台进度不可读取，请先核对存档。'
      : requirement.description+' · '+Math.min(requirement.current,requirement.goal)+' / '+requirement.goal;
    wrapper.append(goal);
    const go=document.createElement('a');
    go.className='back goal-link';
    go.href=storyWorkshopGoalHref(entry.id);
    go.textContent=requirement.blocked?'前往核对工作台存档 →':'前往完成经营目标 →';
    wrapper.append(go);
  }
  wrapper.append(button);
  return wrapper;
}
function render(){
  status();
  const count=progress.packs.core?.completed.main.length??0;
  $('progress-count').textContent=count+' / '+main.length;
  $('progress-track').setAttribute('aria-valuenow',String(count));
  $('progress-fill').style.width=(100*count/main.length)+'%';
  const next=main.find(item=>!completed(item));
  $('chapter-hint').textContent=next?'下一段 · '+next.chapter+' · '+next.title:'第一卷完结：灯火重新亮起，但远方仍有未讲完的故事。';
  // Read-only first-volume guide: take the same real prerequisite path as
  // story cards; a locked scene never becomes a shortcut or a reward grant.
  const journey=blocked?{kind:'unavailable',sideCount:0}:
    nextCoreStoryJourney(progress,readStoryWorkshop(store));
  const journeyButton=$('journey-read'),journeyLink=$('journey-workshop');
  journeyButton.hidden=journey.kind!=='story';
  journeyButton.disabled=blocked||saving;
  if(journey.kind==='story')journeyButton.textContent='阅读下一幕 · '+journey.entry.title;
  journeyLink.hidden=blocked||journey.kind!=='workshop';
  if(journey.kind==='workshop'){
    journeyLink.href=journey.href;
    journeyLink.textContent=journey.blocked?'前往核对剧情工作台存档 →':'前往完成经营目标 →';
  }
  $('journey-guidance').textContent=blocked?'剧情存档需要核对，已停止下一步操作。':
    journey.kind==='story'?'下一步：继续 '+journey.entry.title+'。':
      journey.kind==='workshop'?'下一步：'+journey.requirement.description+'（'+
        Math.min(journey.requirement.current,journey.requirement.goal)+' / '+journey.requirement.goal+'）。':
        journey.kind==='complete'?'第一卷主线已完成，人物支线仍可继续体验。':
          '暂时没有可继续的主线，请核对存档与故事前置条件。';
  $('journey-side').textContent=!blocked&&journey.sideCount>0
    ? '另有 '+journey.sideCount+' 段已解锁的人物支线可以阅读。':'';

  document.querySelectorAll('.tabs [data-kind]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.kind===kind)));
  const list=$('story-list');list.replaceChildren();
  const day=localDay();
  const dayPinned=pinnedDailyStoryIncident(progress,CORE_STORY_PACK,day);
  if(kind==='incident'){
    const todays=dailyStoryIncident(progress,CORE_STORY_PACK,day);
    // Never display a provisional event that may change while its durable
    // same-day marker is still being committed under the story Web Lock.
    if(todays&&(dayPinned||blocked))list.append(card(todays,completed(todays)));
    const note=document.createElement('p');note.className='muted';
    note.textContent=!dayPinned&&!blocked&&todays
      ? '正在安全固定今日事件，请稍候。'
      : dayPinned&&!todays
        ? '今日事件记录与当前进度不一致，已停止重抽；请保留存档核对。'
        : '每日事件首次解锁后在当前日期固定。重复阅读不获得金币或道具；离线不会错失主线。';
    list.append(note);
  }else{
    const unlocked=availableStoryEntries(progress,CORE_STORY_PACK,kind);
    const finished=completedStoryEntries(progress,CORE_STORY_PACK,kind);
    for(const item of unlocked)list.append(card(item));
    for(const item of finished.slice().reverse())list.append(card(item,true));
  }
  if(!list.querySelector('.story-card')){
    const empty=document.createElement('div');empty.className='empty';
    empty.textContent=kind==='side'?'暂时没有新支线。继续主线后，居民会带来新的故事。':'故事已全部读完，或者还未满足事件前置条件。';
    list.append(empty);
  }
  $('reset-story').disabled=saving||reason==='STORAGE_UNAVAILABLE';
  $('export-corrupt-story').disabled=saving||reason!=='CORRUPT_SAVE'||typeof raw!=='string';
  // Claim the first eligible event even while the mainline tab is selected:
  // later chapter unlocks must not silently reroll today's event.
  if(!blocked&&!saving&&!pinQueued&&!dayPinned&&
    dailyStoryIncident(progress,CORE_STORY_PACK,day)){
    pinQueued=true;
    queueMicrotask(async()=>{
      try{
        if(!blocked&&!saving&&localDay()===day&&
          !pinnedDailyStoryIncident(progress,CORE_STORY_PACK,day)){
          const next=pinDailyStoryIncident(progress,CORE_STORY_PACK,day);
          if(next!==progress)await save(next,false,()=>localDay()===day,day);
        }
      }catch{
        // Never show or commit an unpinned replacement on a failed claim.
        blocked=true;reason='WRITE_CONFLICT';render();
      }finally{
        pinQueued=false;
        // The save() render happened while pinQueued was true. On rollover,
        // render once more to claim today's event even on the mainline tab.
        if(!blocked&&!saving&&localDay()!==day)render();
      }
    });
  }
}
function lineElement(line){
  const row=document.createElement('div');row.className='dialog-line';
  const name=document.createElement('strong');name.textContent=line.speaker;
  const text=document.createElement('p');text.textContent=line.text;
  row.append(name,text);return row;
}
function open(entry){
  if(saving)return;
  if(!blocked){
    const snapshot=checkStoryResumeSnapshot(store,{key:STORY_SAVE_KEY,expectedRaw:raw});
    if(!snapshot.ok){
      storageEpoch++;blocked=true;reason=snapshot.reason;render();return;
    }
    // A pre-rendered card is not proof that this scene remains unlocked.
    if(!availableStoryEntries(progress,CORE_STORY_PACK,entry.kind).includes(entry)&&
      !completedStoryEntries(progress,CORE_STORY_PACK,entry.kind).includes(entry))return;
  }
  const openedDay=localDay();
  // A card rendered before local midnight must never open yesterday's event.
  if(entry.kind==='incident'&&!canCommitDailyIncident(entry,openedDay,openedDay,progress,CORE_STORY_PACK)){
    refreshIncidentDay();render();return;
  }
  selected=entry;selectedChoice=null;
  const workshopAtOpen=readStoryWorkshop(store);
  selectedWorkshopRaw=workshopAtOpen.raw;
  selectedWorkshopReadable=!workshopAtOpen.blocked;
  selectedIncidentDay=entry.kind==='incident'?openedDay:null;
  const done=completed(entry);
  $('dialog-chapter').textContent=entry.chapter;
  $('dialog-title').textContent=entry.title;
  $('dialog-place').textContent=entry.place;
  // Daily incidents can acknowledge actual story-only orders and buildings.
  // This is read-only flavor text; corrupt/missing workshop data is never invented.
  const lines=entry.lines.slice();
  if(entry.kind==='main'){
    const mainlineEcho=mainlineChoiceEcho(entry,progress);
    if(mainlineEcho)lines.push(mainlineEcho);
  }
  if(entry.kind==='main'||entry.kind==='side'){
    // Chapter echoes require a real persisted workshop save; the default
    // in-memory empty state or a corrupt record cannot imply completion.
    const workshop=workshopAtOpen;
    if(!workshop.blocked&&workshop.raw!==null){
      const chapterEcho=storyWorkshopChapterEcho(entry,progress,workshop.state);
      if(chapterEcho)lines.push(chapterEcho);
    }
  }
  if(entry.kind==='incident'){
    // Choice consequences are read from the validated narrative save even when
    // the independent workshop save is absent or blocked.
    const choiceEcho=incidentChoiceEcho(entry,progress);
    if(choiceEcho)lines.push(choiceEcho);
    const workshop=workshopAtOpen;
    if(!workshop.blocked&&workshop.raw!==null){
      const echo=incidentWorkshopEcho(entry,workshop.state);
      if(echo)lines.push(echo);
    }
  }
  $('dialog-lines').replaceChildren(...lines.map(lineElement));
  $('dialog-choices').replaceChildren();
  $('dialog-reply').textContent='';
  const previous=progress.packs.core?.choices[entry.id]??null;
  if(done&&previous){
    const picked=entry.choices.find(c=>c.id===previous);
    if(picked)$('dialog-reply').textContent='上次选择：'+picked.label+'。'+picked.reply;
  }
  const requirement=inspectStoryWorkshopRequirementFromRead(entry.id,workshopAtOpen);
  if(!done&&requirement.required&&!requirement.met){
    const notice=document.createElement('p');notice.className='muted';
    notice.textContent=requirement.blocked
      ? '剧情工作台进度不可用，请保留存档并检查工作台状态。'
      : '请先在剧情工作台'+requirement.description+'（'+Math.min(requirement.current,requirement.goal)+' / '+requirement.goal+'），再返回继续此幕。';
    const link=document.createElement('a');link.className='back';link.href=storyWorkshopGoalHref(entry.id);link.textContent='前往对应经营目标 →';
    $('dialog-choices').append(notice,link);
  }
  if(!done&&(!requirement.required||requirement.met)){
    for(const choice of entry.choices){
      const button=document.createElement('button');button.type='button';
      button.textContent=choice.label;
      button.setAttribute('aria-pressed','false');
      button.addEventListener('click',()=>{
        if(saving||blocked)return;
        const storyAtChoice=checkStoryResumeSnapshot(store,{key:STORY_SAVE_KEY,expectedRaw:raw});
        if(!storyAtChoice.ok){
          storageEpoch++;blocked=true;reason=storyAtChoice.reason;
          selectedChoice=null;
          if($('story-dialog').open)$('story-dialog').close();
          render();return;
        }
        if(!openWorkshopCurrent()){
          selectedChoice=null;
          $('dialog-reply').textContent='工作台进度已变化，请关闭并重新打开对白后选择。';
          $('complete-story').disabled=true;
          $('dialog-choices').querySelectorAll('button').forEach(b=>b.disabled=true);
          return;
        }
        selectedChoice=choice.id;
        $('dialog-choices').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
        $('dialog-reply').textContent=choice.reply;
        $('complete-story').disabled=blocked||!inspectStoryWorkshopRequirementFromRead(entry.id,workshopAtOpen).met;
      });
      $('dialog-choices').append(button);
    }
  }
  const finish=$('complete-story');
  finish.textContent=done?'已阅读 · 关闭':entry.choices.length?'确认选择并继续':'完成阅读并继续';
  finish.disabled=saving||(!done&&(blocked||!requirement.met||entry.choices.length>0));
  $('story-dialog').showModal();
}
// Preserve the exact workshop evidence that this dialogue actually rendered.
// This also protects non-gated choices if their StorageEvent was missed.
function openWorkshopCurrent(){
  return !selectedWorkshopReadable||checkStoryResumeSnapshot(store,{
    key:STORY_WORKSHOP_KEY,expectedRaw:selectedWorkshopRaw
  }).ok;
}
$('close-dialog').addEventListener('click',()=>$('story-dialog').close());
$('journey-read').addEventListener('click',()=>{
  if(saving||blocked)return;
  const plan=nextCoreStoryJourney(progress,readStoryWorkshop(store));
  if(plan.kind!=='story')return;
  kind='main';render();
  open(plan.entry);
});

$('complete-story').addEventListener('click',async()=>{
  if(saving||!selected)return;
  // A stale incident must not be completed from an overnight-open dialogue.
  if(!canCommitDailyIncident(selected,selectedIncidentDay,localDay(),progress,CORE_STORY_PACK)){
    selected=null;selectedChoice=null;selectedIncidentDay=null;
    if($('story-dialog').open)$('story-dialog').close();
    refreshIncidentDay();render();return;
  }
  if(completed(selected)){$('story-dialog').close();return;}
  if(!openWorkshopCurrent()){
    $('dialog-reply').textContent='剧情工作台存档已变化，请关闭对白后重新打开，核对最新经营进度。';
    $('complete-story').disabled=true;return;
  }
  try{
    // Capture the exact workshop snapshot before queueing the dialogue write.
    // Recheck inside the story Web Lock: the other tab may reset its workshop.
    const entryId=selected.id;
    const requiresWorkshop=storyWorkshopRequirement(entryId,null).required;
    const workshopSnapshot=requiresWorkshop?readStoryWorkshop(store):null;
    const expectedWorkshopRaw=workshopSnapshot?.raw;
    const commitGuard=()=>openWorkshopCurrent()&&
      storyDialogueCommitAllowed(store,entryId,expectedWorkshopRaw)&&
      canCommitDailyIncident(selected,selectedIncidentDay,localDay(),progress,CORE_STORY_PACK);
    if(!commitGuard()){
      $('dialog-reply').textContent='经营目标尚未完成，或工作台存档已变化，请核对后重试。';return;
    }
    const next=completeStoryEntry(progress,CORE_STORY_PACK,entryId,selectedChoice);
    $('complete-story').disabled=true;
    if(await save(next,false,commitGuard)){
      if($('story-dialog').open)$('story-dialog').close();
    }
  }catch{
    $('dialog-reply').textContent='当前剧情暂不可完成，请确认前置故事是否已解锁。';
  }
});
document.querySelectorAll('.tabs [data-kind]').forEach(btn=>btn.addEventListener('click',()=>{
  kind=btn.dataset.kind;render();
}));
$('export-corrupt-story').addEventListener('click',()=>{
  if(saving||reason!=='CORRUPT_SAVE'||typeof raw!=='string')return;
  if(!window.confirm('将异常剧情对白存档保存为本地文本文件？文件可能包含个人游玩信息，不会上传或修改浏览器存档。'))return;
  const evidence=captureStoryWorkshopEvidence(store,{key:STORY_SAVE_KEY,expectedRaw:raw,confirmedByUser:true});
  if(!evidence.ok){
    if(evidence.code==='STALE_SNAPSHOT'){blocked=true;reason='WRITE_CONFLICT';render();}
    $('save-state').textContent=evidence.code==='TOO_LARGE'
      ? '异常记录过大，已拒绝导出；原数据仍保留，请勿重置。'
      : '原始记录已变化或无法读取，已拒绝导出；请重新打开页面核对。';
    return;
  }
  let url;
  try{
    url=URL.createObjectURL(new Blob([evidence.content],{type:'text/plain;charset=utf-8'}));
    const link=document.createElement('a');
    link.href=url;link.download='yunyu-story-dialogue-corrupt-save.txt';
    document.body.append(link);link.click();link.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),60000);
    $('save-state').textContent='已尝试下载异常对白记录。请先在设备“文件”中确认备份存在；原浏览器存档未修改。';
  }catch{
    if(url)URL.revokeObjectURL(url);
    $('save-state').textContent='设备未能触发文件导出；原浏览器存档未修改，请勿重置。';
  }
});
$('reset-story').addEventListener('click',async()=>{
  if(saving)return;
  if(reason==='CORRUPT_SAVE'&&!window.confirm('异常剧情对白存档会被重置覆盖。建议先导出并确认备份文件可用。仍要继续重置吗？'))return;
  if(!window.confirm('确认重置此浏览器的剧情进度吗？此操作不影响普通经营存档，但剧情选择与已读记录不可恢复。'))return;
  const current=readStorySave(store);
  if(current.reason==='STORAGE_UNAVAILABLE')return;
  if(current.raw!==raw){
    blocked=true;reason='WRITE_CONFLICT';render();return;
  }
  const next=startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);
  // A reset must change the snapshot even if the current save is already blank.
  // Monotonic revision prevents ABA: stale tabs must not replay an old choice.
  if(!current.blocked&&current.raw!==null){
    if(current.progress.revision===Number.MAX_SAFE_INTEGER){
      blocked=true;reason='WRITE_CONFLICT';render();return;
    }
    next.revision=current.progress.revision+1;
  }
  await save(next,true);
});
function recheckStoryOnResume(){
  shownDay=localDay();
  selectedIncidentDay=null;
  let snapshotOk=false;
  if(!blocked){
    let check=checkStoryResumeSnapshot(store,{key:STORY_SAVE_KEY,expectedRaw:raw});
    // A suspended tab may miss the peer's StorageEvent. The only safe
    // exception to the raw mismatch is the same deterministic daily pin.
    // Never adopt while a local write is pending or on storage failures.
    if(!check.ok&&!saving&&check.reason==='WRITE_CONFLICT'){
      const adopted=adoptConcurrentDailyPinOnResume(store,{
        expectedRaw:raw,day:shownDay,pack:CORE_STORY_PACK
      });
      if(adopted){
        storageEpoch++;progress=adopted.progress;raw=adopted.raw;
        check={ok:true,reason:null};
      }
    }
    snapshotOk=check.ok;
    if(!check.ok){blocked=true;reason=check.reason;storageEpoch++;}
  }
  // A backgrounded tab can miss the workshop StorageEvent as well. A main
  // or side dialogue may contain workshop-dependent text or choices, so
  // preserve it only if that independent raw snapshot is still identical.
  // A changed workshop closes the stale dialogue without blocking the
  // otherwise intact story save; the next open re-evaluates prerequisites.
  if(snapshotOk&&$('story-dialog').open&&selected&&
    (selected.kind==='main'||selected.kind==='side')){
    snapshotOk=selectedWorkshopReadable&&
      checkStoryResumeSnapshot(store,{key:STORY_WORKSHOP_KEY,expectedRaw:selectedWorkshopRaw}).ok;
  }
  // pageshow and visibilitychange may fire back-to-back. Keep an unlocked
  // main/side dialogue and its choice only after an exact snapshot check.
  // Daily incidents, stale saves and pending writes must close. Workshop
  // prerequisites are rechecked under the story lock before completion.
  const keepDialog=canKeepResumedStoryDialogue({
    snapshotOk,blocked,saving,dialogOpen:$('story-dialog').open,
    entry:selected,progress,pack:CORE_STORY_PACK
  });
  if(!keepDialog){
    selected=null;selectedChoice=null;selectedIncidentDay=null;
    if($('story-dialog').open)$('story-dialog').close();
  }
  render();
}
// Background timers are throttled on iPhone: pageshow/visibilitychange above
// provide a catch-up path. This timer only updates the read-only event view.
function refreshIncidentDay(){
  const today=localDay();
  if(today===shownDay)return;
  shownDay=today;
  if(selected?.kind==='incident'){
    selected=null;selectedChoice=null;selectedIncidentDay=null;
    if($('story-dialog').open)$('story-dialog').close();
  }
  // Refresh even on main/side tabs: a newly started day must be pinned
  // before subsequent chapter completion changes the candidate pool.
  render();
}
window.setInterval(()=>{
  if(document.visibilityState==='visible')refreshIncidentDay();
},30_000);
window.addEventListener('pageshow',recheckStoryOnResume);
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible')recheckStoryOnResume();
});
window.addEventListener('storage',event=>{
  if(shouldBlockStoryStorageEvent(event,{key:STORY_SAVE_KEY,storage:store})){
    // Passive tabs may safely accept only the identical deterministic pin,
    // not an arbitrary chapter, reset or DLC change. An in-flight writer uses
    // the separate P49 lock-result reconciliation after its callback returns.
    const adopted=!saving&&!blocked?adoptConcurrentDailyPinStorageEvent(event,{
      storage:store,expectedRaw:raw,day:localDay(),pack:CORE_STORY_PACK
    }):null;
    if(adopted){
      // An identical daily pin does not alter main/side choices. Keep an
      // actively read chapter (and its selected option) instead of closing
      // the dialogue just because another tab pinned today's event.
      const keepDialog=$('story-dialog').open&&
        canKeepDialogueAfterDailyPin(selected,adopted.progress,CORE_STORY_PACK);
      storageEpoch++;progress=adopted.progress;raw=adopted.raw;
      if(!keepDialog){
        selected=null;selectedChoice=null;selectedIncidentDay=null;
        if($('story-dialog').open)$('story-dialog').close();
      }
      render();return;
    }
    storageEpoch++;blocked=true;reason='WRITE_CONFLICT';selectedChoice=null;
    if($('story-dialog').open)$('story-dialog').close();
    render();
  }else if(shouldRefreshStoryDependencyEvent(event,{ownKey:STORY_SAVE_KEY,dependencyKey:STORY_WORKSHOP_KEY,storage:store})){
    // Workshop orders/buildings can unlock or relock a story entry in another tab.
    // Reopen a dialogue to see the current requirement; story progress stays intact.
    selectedChoice=null;
    if($('story-dialog').open)$('story-dialog').close();
    render();
  }
});
function syncStoryHash(){
  const route=readStoryHash(window.location.hash);
  kind=route.kind;
  render();
  if(!route.entryId)return;
  // A route is a focus hint, never a command to open or complete a locked scene.
  window.requestAnimationFrame(()=>{
    if(kind!==route.kind||readStoryHash(window.location.hash).entryId!==route.entryId)return;
    const target=document.getElementById('story-'+route.entryId);
    if(!target)return; // Locked or otherwise unavailable; prerequisites stay intact.
    target.focus({preventScroll:true});
    target.scrollIntoView({block:'nearest'});
  });
}
window.addEventListener('hashchange',syncStoryHash);
syncStoryHash();
