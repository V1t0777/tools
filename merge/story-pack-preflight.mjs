/** Read-only P2.14 story content-pack availability preflight. */
import {MAX_STORY_PACKS,createEmptyStoryProgress,createEmptyStoryPack,validateStoryProgress} from './mode-boundaries.mjs';

export function previewStoryPackAvailability(progress,installedPackIds){
  if(!validateStoryProgress(progress))throw new TypeError('Expected valid story progress');
  if(!Array.isArray(installedPackIds)||
    installedPackIds.length>MAX_STORY_PACKS||
    !installedPackIds.every(id=>typeof id==='string')||
    new Set(installedPackIds).size!==installedPackIds.length)
    throw new TypeError('Invalid installed pack list');
  const candidate=createEmptyStoryProgress();
  candidate.packs=Object.fromEntries(installedPackIds.map(id=>[id,createEmptyStoryPack()]));
  if(!validateStoryProgress(candidate))throw new TypeError('Invalid installed pack IDs');
  const installed=new Set(installedPackIds),savedIds=Object.keys(progress.packs);
  const available=savedIds.filter(id=>installed.has(id)).sort();
  const missing=savedIds.filter(id=>!installed.has(id)).sort();
  const unregistered=installedPackIds.filter(id=>!Object.hasOwn(progress.packs,id)).sort();
  return Object.freeze({
    mode:'story',projectionVersion:1,sourceRevision:progress.revision,
    activePackId:progress.activePackId,
    activePackAvailable:progress.activePackId===null?null:installed.has(progress.activePackId),
    savedPackCount:savedIds.length,installedPackCount:installedPackIds.length,
    available:Object.freeze(available),missing:Object.freeze(missing),
    unregistered:Object.freeze(unregistered),requiresAttention:missing.length>0
  });
}
