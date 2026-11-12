/**
 * Read-only first-volume navigation for the isolated story workshop.
 * No mutations, no new unlock rules, no DLC routing and no normal-mode keys.
 */
import {nextCoreStoryJourney} from './journey-guide.mjs';

const unavailable=message=>Object.freeze({kind:'unavailable',message,href:null,label:''});
export function nextStoryWorkshopAction(storyRead,workshopRead){
  if(storyRead?.blocked!==false)
    return unavailable('剧情对白存档不可读取。请先返回剧情页核对原始记录；不要继续经营或重置。');
  if(workshopRead?.blocked!==false)
    return unavailable('剧情工作台存档不可读取。请先核对本页异常备份与存档状态，不要重复提交。');
  if(storyRead.raw===null)
    return Object.freeze({kind:'start',message:'尚未保存首卷剧情进度。请先返回剧情页开始故事。',
      href:'./story.html',label:'前往剧情页 →'});
  const plan=nextCoreStoryJourney(storyRead.progress,workshopRead);
  if(plan.kind==='workshop'){
    // Only the registered core-pack gate can provide a same-page fragment.
    const prefix='./story-workshop.html#';
    if(!plan.href?.startsWith(prefix))
      return unavailable('当前经营目标无法安全定位，请返回剧情页核对进度。');
    return Object.freeze({kind:'workshop',
      message:'下一步经营目标：'+plan.requirement.description+'（'+
        Math.min(plan.requirement.current,plan.requirement.goal)+' / '+
        plan.requirement.goal+'）。完成后返回剧情页继续《'+plan.entry.title+'》。',
      href:plan.href.slice('./story-workshop.html'.length),label:'定位当前经营目标 ↓'});
  }
  if(plan.kind==='story')
    return Object.freeze({kind:'story',
      message:'下一幕《'+plan.entry.title+'》已可阅读；无需继续消耗经营资源。',
      href:'./story.html#story-'+plan.entry.id,label:'返回阅读下一幕 →'});
  if(plan.kind==='complete')
    return Object.freeze({kind:'complete',
      message:'首卷四章主线已完成。可以返回剧情页回顾结局与已解锁的人物支线。',
      href:'./story.html',label:'查看首卷剧情 →'});
  return unavailable('当前主线进度无法安全判断。请返回剧情页核对存档和前置故事。');
}

/** Read-only link validity, bound to both exact rendered save strings. */
export function isStoryWorkshopRouteCurrent(snapshot,storyRead,workshopRead){
  if(!snapshot||typeof snapshot.href!=='string'||!snapshot.href)return false;
  if(storyRead?.blocked!==false||workshopRead?.blocked!==false)return false;
  if(storyRead.raw!==snapshot.storyRaw||workshopRead.raw!==snapshot.workshopRaw)return false;
  return nextStoryWorkshopAction(storyRead,workshopRead).href===snapshot.href;
}
