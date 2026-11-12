/**
 * P45: deterministic, read-only acknowledgements of *actual* story-workshop
 * milestones inside their first-volume chapters (not just daily incidents).
 * Goal logic is shared with the commit guard; this module never writes saves.
 */
import {validateStoryProgress} from '../mode-boundaries.mjs';
import {CORE_STORY_PACK} from './core-pack.mjs';
import {storyWorkshopRequirement} from './workshop-gate.mjs';

const ECHOES=Object.freeze({
  'first-order':Object.freeze({speaker:'阿澄',text:'阿澄核对了剧情工作台刚交付的街坊委托，才把第一杯热茶递到客人面前。她说，重新开门不是一句口号，是把眼前的小事做好。'}),
  toolbox:Object.freeze({speaker:'学徒',text:'学徒看着已经收进剧情仓库的材料，给空出的工作位置留下一条路。他终于明白，整理不是为了好看，而是让下一次修理更安全。'}),
  'tea-table':Object.freeze({speaker:'晚禾',text:'花园确实已经修复，晚禾摸了摸新整理的茶桌，却没有催促那些尚未发芽的种子。她说，修好一个地方，不等于要把过去原样重演。'}),
  'harbor-light':Object.freeze({speaker:'岚叔',text:'港湾街角的修缮已经完成。岚叔仍让学徒先检查岸上的标记和湿滑木板；灯亮起来，也不代表海雾里的航路已经安全。'}),
  festival:Object.freeze({speaker:'阿澄',text:'百物铺的门面终于修整妥当，阿澄把庆典用的小纸灯挂在新整理的檐下。大家为眼前的努力高兴，并没有因此忘记岛上仍有许多未解的事。'})
});

export function storyWorkshopChapterEcho(entry,storyProgress,workshopState){
  if(!entry||(entry.kind!=='main'&&entry.kind!=='side')||
    typeof entry.id!=='string'||!Object.hasOwn(ECHOES,entry.id)||
    !CORE_STORY_PACK.entries.includes(entry))return null;
  if(!validateStoryProgress(storyProgress))return null;
  const core=storyProgress.packs.core;
  if(!core)return null;
  // A forged or prematurely opened chapter cannot narrate an achievement.
  const completed=new Set(Object.values(core.completed).flat());
  if(!entry.requires.every(id=>completed.has(id)))return null;
  // The very same requirement used to gate dialogue commits: no invented
  // completion on absent/corrupt data, no duplicated business thresholds.
  if(!storyWorkshopRequirement(entry.id,workshopState).met)return null;
  return ECHOES[entry.id];
}
