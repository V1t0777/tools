/** P57: read-only, core-only next-step guidance, never an unlock or reward. */
import {validateStoryProgress} from '../mode-boundaries.mjs';
import {CORE_STORY_PACK} from './core-pack.mjs';
import {availableStoryEntries,completedStoryEntries} from './runtime.mjs';
import {inspectStoryWorkshopRequirementFromRead,storyWorkshopGoalHref} from './workshop-gate.mjs';

/** Return the next real unlocked first-volume action. Never trust injected DLC IDs. */
export function nextCoreStoryJourney(progress,workshopRead){
  if(!validateStoryProgress(progress)||!Object.hasOwn(progress.packs,'core'))
    return Object.freeze({kind:'unavailable',sideCount:0});
  const pack=CORE_STORY_PACK;
  const allMain=pack.entries.filter(item=>item.kind==='main');
  const finished=completedStoryEntries(progress,pack,'main');
  const sideCount=availableStoryEntries(progress,pack,'side').length;
  if(finished.length===allMain.length)
    return Object.freeze({kind:'complete',sideCount});
  const next=availableStoryEntries(progress,pack,'main')[0];
  if(!next)return Object.freeze({kind:'unavailable',sideCount});
  const requirement=inspectStoryWorkshopRequirementFromRead(next.id,workshopRead);
  if(requirement.required&&!requirement.met){
    return Object.freeze({kind:'workshop',entry:next,sideCount,
      requirement,blocked:requirement.blocked,
      href:storyWorkshopGoalHref(next.id)});
  }
  return Object.freeze({kind:'story',entry:next,sideCount});
}
