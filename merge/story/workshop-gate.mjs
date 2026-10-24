/**
 * Read-only gameplay milestone for the first customer story.
 * Never grants or transfers rewards. A malformed or unavailable workshop
 * must NOT be interpreted as proof of completing an order.
 */
import {validateSave} from '../engine.mjs';
import {readStoryWorkshop} from './workshop-storage.mjs';
export function storyWorkshopRequirement(entryId,workshopState){
  if(entryId!=='first-order')return Object.freeze({required:false,met:true,goal:0,current:0});
  const good=validateSave(workshopState);
  const count=good?workshopState.progress.orders:0;
  return Object.freeze({required:true,met:good&&count>=1,goal:1,current:count});
}
export function inspectStoryWorkshopRequirement(entryId,storage){
  if(entryId!=='first-order')return storyWorkshopRequirement(entryId,null);
  const read=readStoryWorkshop(storage);
  const gate=read.blocked
    ? Object.freeze({required:true,met:false,goal:1,current:0})
    : storyWorkshopRequirement(entryId,read.state);
  return Object.freeze({...gate,blocked:read.blocked,reason:read.reason});
}
