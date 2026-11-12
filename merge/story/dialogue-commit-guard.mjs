/** Fail closed when a story completion depends on another localStorage key.
 * This protects the wait for the dialogue Web Lock, not an atomic two-key transaction.
 */
import {readStoryWorkshop} from './workshop-storage.mjs';
import {storyWorkshopRequirement} from './workshop-gate.mjs';

export function storyDialogueCommitAllowed(storage,entryId,expectedWorkshopRaw){
  const goal=storyWorkshopRequirement(entryId,null);
  if(!goal.required)return true;
  if(typeof expectedWorkshopRaw!=='string')return false;
  const current=readStoryWorkshop(storage);
  return !current.blocked&&current.raw===expectedWorkshopRaw&&
    storyWorkshopRequirement(entryId,current.state).met;
}
