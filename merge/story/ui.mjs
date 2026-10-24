import {CORE_STORY_PACK} from './core-pack.mjs';
import {availableStoryEntries,completedStoryEntries,completeStoryEntry,startCoreStory,dailyStoryIncident} from './runtime.mjs';
import {readStorySave,writeStorySave} from './local-storage.mjs';
import {captureStoryWorkshopEvidence} from './save-evidence.mjs';
import {checkStoryResumeSnapshot} from './resume-guard.mjs';
import {shouldBlockStoryStorageEvent} from './storage-event-guard.mjs';
import {shouldRefreshStoryDependencyEvent} from './storage-event-guard.mjs';
import {STORY_WORKSHOP_KEY} from './workshop-storage.mjs';
import {inspectStoryWorkshopRequirement} from './workshop-gate.mjs';
import {createEmptyStoryProgress,STORY_SAVE_KEY} from '../mode-boundaries.mjs';

const $=id=>document.getElementById(id);
const store=(()=>{try{return window.localStorage;}catch{return null;}})();
const loaded=readStorySave(store);
let progress=loaded.progress,raw=loaded.raw,blocked=loaded.blocked,reason=loaded.reason;
let kind='main',selected=null,selectedChoice=null;
const entries=CORE_STORY_PACK.entries;
const main=entries.filter(x=>x.kind==='main');
const choicesById=Object.fromEntries(entries.map(e=>[e.id,e]));
function localDay(){
  const date=new Date();
  const pad=n=>String(n).padStart(2,'0');
  return date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate());
}
function save(next,reset=false){
  // A stale dialog cannot save after a cross-tab invalidation; explicit reset keeps its CAS flow.
  if(blocked&&!reset)return false;
  if(!writeStorySave(store,next,{expectedRaw:raw,confirmedReset:reset})){
    blocked=true;reason='WRITE_CONFLICT';render();return false;
  }
  progress=next;raw=JSON.stringify(next);blocked=false;reason=null;return true;
}
if(!blocked&&!progress.packs.core){
  const next=startCoreStory(progress,CORE_STORY_PACK);
  save(next);
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
  const head=document.createElement('div');head.className='story-head';
  const title=document.createElement('h3');title.textContent=entry.title;
  const state=document.createElement('span');state.className='status';
  const requirement=inspectStoryWorkshopRequirement(entry.id,store);
  state.textContent=done?'已阅读':requirement.required&&!requirement.met?'待完成经营目标':'可体验';
  head.append(title,state);
  const place=document.createElement('p');place.textContent=entry.chapter+' · '+entry.place;
  const button=document.createElement('button');button.type='button';
  button.textContent=done?'回看剧情':'阅读故事';
  button.addEventListener('click',()=>open(entry));
  wrapper.append(head,place,button);
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
  document.querySelectorAll('.tabs [data-kind]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.kind===kind)));
  const list=$('story-list');list.replaceChildren();
  if(kind==='incident'){
    const todays=dailyStoryIncident(progress,CORE_STORY_PACK,localDay());
    if(todays)list.append(card(todays,completed(todays)));
    const note=document.createElement('p');note.className='muted';
    note.textContent='每日根据本地日期选择一件岛屿小事。重复阅读不会获得金币或道具；离线不会错失主线。';
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
  $('reset-story').disabled=reason==='STORAGE_UNAVAILABLE';
  $('export-corrupt-story').disabled=reason!=='CORRUPT_SAVE'||typeof raw!=='string';
}
function lineElement(line){
  const row=document.createElement('div');row.className='dialog-line';
  const name=document.createElement('strong');name.textContent=line.speaker;
  const text=document.createElement('p');text.textContent=line.text;
  row.append(name,text);return row;
}
function open(entry){
  selected=entry;selectedChoice=null;
  const done=completed(entry);
  $('dialog-chapter').textContent=entry.chapter;
  $('dialog-title').textContent=entry.title;
  $('dialog-place').textContent=entry.place;
  $('dialog-lines').replaceChildren(...entry.lines.map(lineElement));
  $('dialog-choices').replaceChildren();
  $('dialog-reply').textContent='';
  const previous=progress.packs.core?.choices[entry.id]??null;
  if(done&&previous){
    const picked=entry.choices.find(c=>c.id===previous);
    if(picked)$('dialog-reply').textContent='上次选择：'+picked.label+'。'+picked.reply;
  }
  const requirement=inspectStoryWorkshopRequirement(entry.id,store);
  if(!done&&requirement.required&&!requirement.met){
    const notice=document.createElement('p');notice.className='muted';
    notice.textContent=requirement.blocked?'剧情工作台进度不可用，请保留存档并检查工作台状态。':'请先在剧情工作台'+requirement.description+'，再返回继续此幕。';
    const link=document.createElement('a');link.className='back';link.href='./story-workshop.html';link.textContent='前往剧情工作台 →';
    $('dialog-choices').append(notice,link);
  }
  if(!done&&(!requirement.required||requirement.met)){
    for(const choice of entry.choices){
      const button=document.createElement('button');button.type='button';
      button.textContent=choice.label;
      button.setAttribute('aria-pressed','false');
      button.addEventListener('click',()=>{
        selectedChoice=choice.id;
        $('dialog-choices').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
        $('dialog-reply').textContent=choice.reply;
        $('complete-story').disabled=blocked||!inspectStoryWorkshopRequirement(entry.id,store).met;
      });
      $('dialog-choices').append(button);
    }
  }
  const finish=$('complete-story');
  finish.textContent=done?'已阅读 · 关闭':entry.choices.length?'确认选择并继续':'完成阅读并继续';
  finish.disabled=!done&&(blocked||!requirement.met||entry.choices.length>0);
  $('story-dialog').showModal();
}
$('close-dialog').addEventListener('click',()=>$('story-dialog').close());
$('complete-story').addEventListener('click',()=>{
  if(!selected)return;
  if(completed(selected)){$('story-dialog').close();return;}
  try{
    if(!inspectStoryWorkshopRequirement(selected.id,store).met){
      $('dialog-reply').textContent='尚未完成剧情工作台的委托，无法推进这一幕。';return;
    }
    const next=completeStoryEntry(progress,CORE_STORY_PACK,selected.id,selectedChoice);
    if(save(next)){
      $('story-dialog').close();render();
    }
  }catch{
    $('dialog-reply').textContent='当前剧情暂不可完成，请确认前置故事是否已解锁。';
  }
});
document.querySelectorAll('.tabs [data-kind]').forEach(btn=>btn.addEventListener('click',()=>{
  kind=btn.dataset.kind;render();
}));
$('export-corrupt-story').addEventListener('click',()=>{
  if(reason!=='CORRUPT_SAVE'||typeof raw!=='string')return;
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
$('reset-story').addEventListener('click',()=>{
  if(reason==='CORRUPT_SAVE'&&!window.confirm('异常剧情对白存档会被重置覆盖。建议先导出并确认备份文件可用。仍要继续重置吗？'))return;
  if(!window.confirm('确认重置此浏览器的剧情进度吗？此操作不影响普通经营存档，但剧情选择与已读记录不可恢复。'))return;
  const current=readStorySave(store);
  if(current.reason==='STORAGE_UNAVAILABLE')return;
  if(current.raw!==raw){
    blocked=true;reason='WRITE_CONFLICT';render();return;
  }
  const next=startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);
  if(save(next,true))render();
});
function recheckStoryOnResume(){
  if(!blocked){
    const check=checkStoryResumeSnapshot(store,{key:STORY_SAVE_KEY,expectedRaw:raw});
    if(!check.ok){blocked=true;reason=check.reason;}
  }
  if($('story-dialog').open)$('story-dialog').close();
  render();
}
window.addEventListener('pageshow',recheckStoryOnResume);
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible')recheckStoryOnResume();
});
window.addEventListener('storage',event=>{
  if(shouldBlockStoryStorageEvent(event,{key:STORY_SAVE_KEY,storage:store})){
    blocked=true;reason='WRITE_CONFLICT';selectedChoice=null;
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
render();
