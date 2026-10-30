/**
 * P26: A building spend must still be justified by the exact story snapshot
 * observed before its asynchronous workshop Web Lock request.
 *
 * This is a conservative cross-save check, NOT an atomic two-key transaction.
 * Non-building actions do not depend on the story save.
 */
import {readStorySave} from './local-storage.mjs';
import {storyGardenBuildAvailable,storyHarborBuildAvailable,storyStorefrontBuildAvailable} from './workshop-gate.mjs';

const GATES=Object.freeze({
  garden:storyGardenBuildAvailable,
  harbor:storyHarborBuildAvailable,
  storefront:storyStorefrontBuildAvailable
});

export function storyBuildingWriteAllowed(storage,before,after,expectedStoryRaw){
  const changed=Object.keys(GATES).filter(name=>
    before?.buildings?.[name]!==after?.buildings?.[name]);
  if(changed.length===0)return true;
  // Do not authorize a changed building with an absent/ambiguous snapshot.
  if(expectedStoryRaw===undefined)return false;
  const story=readStorySave(storage);
  if(story.blocked||story.raw!==expectedStoryRaw)return false;
  // The engine supports one-time 0 -> 1 construction, never reversal here.
  return changed.every(name=>
    before.buildings[name]===0&&after.buildings[name]===1&&GATES[name](story.progress));
}
