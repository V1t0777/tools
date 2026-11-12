/** P0 offline deadlock escape: one explicitly confirmed, irreversible action.
 * Never grants coins, XP, supplies or a free item. No automatic cleanup.
 */
import {validateSave} from './engine.mjs';
import {diagnoseBoard} from './board-diagnostics.mjs';
export function discardDeadlockedMaterial(state,slot,{confirmed=false,expectedItemId}={}){
  const fail=message=>({state,ok:false,message});
  if(!validateSave(state))return fail('存档异常，禁止弃置；请保留原始存档');
  if(confirmed!==true)return fail('必须先确认弃置');
  if(!Number.isInteger(slot)||slot<0||slot>=state.board.length)
    return fail('选中的格子无效');
  const item=state.board[slot];
  if(item?.kind!=='material'||typeof expectedItemId!=='string'||
      item.id!==expectedItemId)return fail('选中的原料已变化，请重新确认');
  if(diagnoseBoard(state).recovery!=='hard-deadlock')
    return fail('仍存在正常整理途径，禁止弃置');
  const next={...state,board:state.board.slice(),revision:state.revision+1};
  next.board[slot]=null;
  return {state:next,ok:true,kind:'deadlock-discard',
    message:'已弃置一件原料并腾出一格；没有返还任何资源'};
}
