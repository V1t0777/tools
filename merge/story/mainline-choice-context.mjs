/** P41: replay-safe mainline echoes of earlier first-volume decisions.
 * These lines are purely narrative: no story progress, event rotation or
 * workshop/economy state is changed. Never apply core echoes to DLC entries.
 */
import {validateStoryProgress} from '../mode-boundaries.mjs';
import {CORE_STORY_PACK} from './core-pack.mjs';

const CHAPTER_ECHOES=Object.freeze({
  'tea-table':Object.freeze({previous:'seed',lines:Object.freeze({
    keep:Object.freeze({speaker:'晚禾',text:'晚禾把留下的旧种子标签轻轻放在茶桌边。她说，今年就算没有开花，这些名字也值得被好好记住。'}),
    try:Object.freeze({speaker:'晚禾',text:'晚禾指着花圃里标着“试种”的小牌，说还不知道新花能不能开，但已经很想请大家下次再来看看。'})
  })}),
  'harbor-light':Object.freeze({previous:'apprentice',lines:Object.freeze({
    teach:Object.freeze({speaker:'学徒',text:'学徒照着岚叔教过的步骤，先检查灯柱的固定绳和脚下木板，再请大家靠近。岚叔在一旁认真看着。'}),
    trust:Object.freeze({speaker:'学徒',text:'学徒主动围起仍有些湿滑的桥边，等岚叔复核了最后一道绳结，才请大家到灯下看海。他已经学会先把安全放在勇气前面。'})
  })})
});

export function mainlineChoiceEcho(entry,progress){
  if(!entry||entry.kind!=='main'||typeof entry.id!=='string'||
    !Object.hasOwn(CHAPTER_ECHOES,entry.id)||
    !CORE_STORY_PACK.entries.includes(entry))return null;
  if(!validateStoryProgress(progress))return null;
  const core=progress.packs.core;
  if(!core)return null;
  const {previous,lines}=CHAPTER_ECHOES[entry.id];
  if(!core.completed.main.includes(previous))return null;
  const choice=core.choices[previous];
  return typeof choice==='string'&&Object.hasOwn(lines,choice)?lines[choice]:null;
}
