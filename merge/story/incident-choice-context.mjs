/**
 * P31: optional, read-only echoes of choices already committed in the core pack.
 * No rewards, save writes, incident rerolls, or assumptions about DLC choices.
 */
import {validateStoryProgress} from '../mode-boundaries.mjs';
import {CORE_STORY_PACK} from './core-pack.mjs';

const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const ECHOES=Object.freeze({
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
