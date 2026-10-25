/** Read-only first-volume story return routing.
 * Only registered core main/side IDs can become fragment focus targets.
 */
import {CORE_STORY_PACK} from './core-pack.mjs';

const kinds=new Map(CORE_STORY_PACK.entries
  .filter(entry=>entry.kind==='main'||entry.kind==='side')
  .map(entry=>[entry.id,entry.kind]));

export function readStoryHash(hash){
  if(hash==='#side')return {kind:'side',entryId:null};
  if(hash==='#incident')return {kind:'incident',entryId:null};
  if(typeof hash==='string'&&hash.startsWith('#story-')){
    const entryId=hash.slice('#story-'.length);
    const kind=kinds.get(entryId);
    if(kind)return {kind,entryId};
  }
  return {kind:'main',entryId:null};
}
