/**
 * P31: optional, read-only echoes of choices already committed in the core pack.
 * No rewards, save writes, incident rerolls, or assumptions about DLC choices.
 */
import {validateStoryProgress} from '../mode-boundaries.mjs';
import {CORE_STORY_PACK} from './core-pack.mjs';

const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const ECHOES=Object.freeze({
  'cat-nap':Object.freeze({node:'arrival',kind:'main',lines:Object.freeze({
    help:Object.freeze({speaker:'阿澄',text:'阿澄把给小猫准备的纸箱放稳，想起你初到云屿时一起打开店门的那个早晨。她说，帮忙有时只是把身边的小事做好。'}),
    ask:Object.freeze({speaker:'阿澄',text:'阿澄一边替小猫整理纸箱，一边又讲起老店以前收留流浪猫的故事。她记得你初来时，先问起的就是这间店的过去。'})
  })}),
  baking:Object.freeze({node:'first-order',kind:'main',lines:Object.freeze({
    listen:Object.freeze({speaker:'阿澄',text:'阿澄看着烤焦的饼干，想起第一位客人说过在店里等雨停的日子。她决定下次慢慢听完食谱，再试一次。'}),
    smile:Object.freeze({speaker:'阿澄',text:'阿澄把烤焦的饼干放到一旁，想起第一杯热茶递到客人手里时的笑容。她说，招待客人不必每一次都完美。'})
  })}),
  'surprise-rain':Object.freeze({node:'seed',kind:'main',lines:Object.freeze({
    keep:Object.freeze({speaker:'晚禾',text:'晚禾把留下的旧花种和标签移到干燥的木架上。她说，保存记忆不等于必须让每一粒种子重新发芽。'}),
    try:Object.freeze({speaker:'晚禾',text:'晚禾为新试种的一角搭起遮雨棚。她想看看雨停以后，新花和旧花能否一起生长。'})
  })}),
  fog:Object.freeze({node:'apprentice',kind:'main',lines:Object.freeze({
    teach:Object.freeze({speaker:'学徒',text:'学徒照着岚叔示范的步骤检查岸上的引导标记，遇到湿滑木板就停下来请岚叔复核。'}),
    trust:Object.freeze({speaker:'学徒',text:'学徒主动封好湿滑的栈桥入口，等岚叔检查完毕再继续修理；今天谁也不冒险出海。'})
  })}),
  visitor:Object.freeze({node:'postcard',kind:'side',lines:Object.freeze({
    send:Object.freeze({speaker:'晚禾',text:'旅人说起邻岛，晚禾想起那张写好收件人的明信片。她仍打算亲自投递，不让别人替她决定。'}),
    hold:Object.freeze({speaker:'晚禾',text:'旅人说起邻岛，晚禾把尚未寄出的明信片收好。没有人催她，现在不寄也是她自己的决定。'})
  })})
});

export function incidentChoiceEcho(entry,progress){
  if(!entry||entry.kind!=='incident'||typeof entry.id!=='string'||
    !own(ECHOES,entry.id)||!CORE_STORY_PACK.entries.includes(entry))return null;
  if(!validateStoryProgress(progress))return null;
  const core=progress.packs.core;
  if(!core)return null;
  const {node,kind,lines}=ECHOES[entry.id];
  if(!core.completed[kind].includes(node))return null;
  const choice=core.choices[node];
  return typeof choice==='string'&&own(lines,choice)?lines[choice]:null;
}
