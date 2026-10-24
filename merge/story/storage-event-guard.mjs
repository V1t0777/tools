/**
 * Conservative, read-only cross-tab invalidation for story-only localStorage.
 * StorageEvent.key === null means localStorage.clear(); ignoring it could leave
 * a suspended story page believing its cached snapshot is still current.
 * Does not create an atomic compare-and-swap or repair deleted saves.
 */
import {STORY_SAVE_KEY} from '../mode-boundaries.mjs';
import {STORY_WORKSHOP_KEY} from './workshop-storage.mjs';

export function shouldBlockStoryStorageEvent(event,{key,storage}={}){
  if(key!==STORY_SAVE_KEY&&key!==STORY_WORKSHOP_KEY)return false;
  if(!event||typeof event!=='object')return false;
  // A real StorageEvent identifies its storage area. Ignore sessionStorage
  // changes, while treating missing storageArea as conservative/ambiguous.
  if(event.storageArea!=null&&event.storageArea!==storage)return false;
  return event.key===null||event.key===key;
}
