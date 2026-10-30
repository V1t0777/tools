/** P57: read-only, core-only next-step guidance, never an unlock or reward. */
import {validateStoryProgress} from '../mode-boundaries.mjs';
import {CORE_STORY_PACK} from './core-pack.mjs';
import {availableStoryEntries,completedStoryEntries,dailyStoryIncident,pinnedDailyStoryIncident} from './runtime.mjs';
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

/** P58: optional side-story shortcut. Prefer a genuinely readable scene;
 * never let a workshop-gated side quest hide other unlocked stories.
 * No state changes, rewards, or cross-pack dependencies.
 */
export function nextCoreSideJourney(progress,workshopRead){
  if(!validateStoryProgress(progress)||!Object.hasOwn(progress.packs,'core'))
    return Object.freeze({kind:'unavailable',available:0});
  const unlocked=availableStoryEntries(progress,CORE_STORY_PACK,'side');
  if(!unlocked.length)return Object.freeze({kind:'complete',available:0});
  let firstGated=null;
  for(const entry of unlocked){
    const requirement=inspectStoryWorkshopRequirementFromRead(entry.id,workshopRead);
    if(!requirement.required||requirement.met)
      return Object.freeze({kind:'story',entry,available:unlocked.length});
    if(!firstGated)firstGated={entry,requirement};
  }
  return Object.freeze({kind:'workshop',entry:firstGated.entry,available:unlocked.length,
    requirement:firstGated.requirement,blocked:firstGated.requirement.blocked,
    href:storyWorkshopGoalHref(firstGated.entry.id)});
}

/** P60: only an already durably pinned local-day incident is actionable.
 * A provisional hash selection must never be advertised as an available
 * event while the story Web Lock is still committing its daily marker.
 * Read-only, core-only, and independent of workshop/normal-mode resources.
 */
export function nextCoreDailyJourney(progress,dayKey){
  if(!validateStoryProgress(progress)||!Object.hasOwn(progress.packs,'core'))
    return Object.freeze({kind:'unavailable'});
  try{
    const pinned=pinnedDailyStoryIncident(progress,CORE_STORY_PACK,dayKey);
    const entry=dailyStoryIncident(progress,CORE_STORY_PACK,dayKey);
    if(!pinned)return Object.freeze({kind:entry?'pending':'none'});
    // A pin referring to a no-longer-eligible scene is a consistency error,
    // not permission to reroll or display a different event.
    if(!entry)return Object.freeze({kind:'blocked'});
    return Object.freeze({kind:'story',entry,
      completed:progress.packs.core.completed.incident.includes(entry.id)});
  }catch{
    return Object.freeze({kind:'unavailable'});
  }
}
