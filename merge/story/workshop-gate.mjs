/**
 * Read-only story goals backed by the actual isolated 7x8 workshop state.
 * No rewards or inventory cross mode boundaries. Missing/corrupt workshop
 * data is never interpreted as an accomplished goal.
 */
import {validateSave} from '../engine.mjs';
import {readStoryWorkshop} from './workshop-storage.mjs';

const GOALS=Object.freeze({
  'first-order':Object.freeze({type:'orders',goal:1,description:'完成一笔街坊委托'}),
  'tea-table':Object.freeze({type:'building',building:'garden',goal:1,description:'修复后院花园'})
});
export function storyWorkshopRequirement(entryId,workshopState){
  const spec=Object.hasOwn(GOALS,entryId)?GOALS[entryId]:null;
  if(!spec)return Object.freeze({required:false,met:true,goal:0,current:0,description:''});
  const valid=validateSave(workshopState);
  const count=!valid?0:spec.type==='orders'
    ? workshopState.progress.orders
    : workshopState.buildings[spec.building];
  return Object.freeze({required:true,met:valid&&count>=spec.goal,
    goal:spec.goal,current:count,description:spec.description});
}
export function inspectStoryWorkshopRequirement(entryId,storage){
  if(!Object.hasOwn(GOALS,entryId))return storyWorkshopRequirement(entryId,null);
  const read=readStoryWorkshop(storage);
  const gate=read.blocked
    ? storyWorkshopRequirement(entryId,null)
    : storyWorkshopRequirement(entryId,read.state);
  return Object.freeze({...gate,blocked:read.blocked,reason:read.reason});
}
