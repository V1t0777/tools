import {WIDTH,MAX_ENERGY,CHAINS,advanceTime,moveOrMerge,produce,fulfillOrder,getItemIcon,getItemName} from '../engine.mjs';
import {readStoryWorkshop,writeStoryWorkshop,STORY_WORKSHOP_KEY} from './workshop-storage.mjs';
const $=id=>document.getElementById(id);
const storage=(()=>{try{return window.localStorage;}catch{return null;}})();
const loaded=readStoryWorkshop(storage);
let state=loaded.state,raw=loaded.raw,blocked=loaded.blocked,reason=loaded.reason,selected=-1;
function status(){
  $('workshop-status').textContent=blocked
    ? reason==='CORRUPT_SAVE'
      ? '剧情工作台存档损坏：原数据未覆盖。只有明确确认重置才会重新开始。'
      : reason==='STORAGE_UNAVAILABLE'
        ? '无法访问浏览器存储，经营操作已暂停。'
        : '存档变化或写入失败：已停止操作，请重新打开页面核对。'
    : '剧情工作台数据只保存在此浏览器，与普通模式金币及背包完全隔离。';
}
function render(){
  status();
  $('energy').textContent=state.energy+' / '+MAX_ENERGY;
  $('coins').textContent=String(state.coins);
  $('xp').textContent=String(state.xp);
  const count=state.progress.orders;
  $('order-count').textContent=Math.min(count,1)+' / 1';
  $('milestone').textContent=count>=1?'委托完成！可以返回剧情页继续阅读《第一杯热茶》。':'还需完成 '+(1-count)+' 笔委托。';
  const board=$('workshop-board');board.replaceChildren();
  const fragment=document.createDocumentFragment();
  state.board.forEach((item,i)=>{
    const button=document.createElement('button');button.type='button';
    button.className='workshop-cell'+(item?.kind==='producer'?' producer':'')+(selected===i?' selected':'');
    button.disabled=blocked;
    button.dataset.slot=String(i);
    button.setAttribute('aria-label','第'+(Math.floor(i/WIDTH)+1)+'行第'+(i%WIDTH+1)+'列，'+(item?getItemName(item):'空格'));
    if(item){
      const glyph=document.createElement('span');glyph.className='glyph';glyph.textContent=getItemIcon(item);
      button.append(glyph);
      const info=document.createElement('span');info.className='tier';
      info.textContent=item.kind==='producer'?(item.charges>0?item.charges+'次':'冷却中'):'Lv.'+item.tier;
      button.append(info);
    }
    button.addEventListener('click',()=>touch(i));fragment.append(button);
  });
  board.append(fragment);
  const list=$('workshop-orders');list.replaceChildren();
  for(const order of state.orders){
    const row=document.createElement('div');row.className='workshop-order';
    const mark=document.createElement('span');
    mark.textContent=CHAINS[order.chain].icon[order.tier-1]+' '+CHAINS[order.chain].names[order.tier-1]+' · ◈'+order.coins;
    const btn=document.createElement('button');btn.type='button';btn.textContent='交付';
    btn.disabled=blocked||!state.board.some(item=>item?.kind==='material'&&item.chain===order.chain&&item.tier===order.tier);
    btn.addEventListener('click',()=>commit(fulfillOrder(state,order.id)));
    row.append(mark,btn);list.append(row);
  }
  $('reset-workshop').disabled=reason==='STORAGE_UNAVAILABLE';
}
function commit(result){
  if(!result.ok){$('board-notice').textContent=result.message;return;}
  if(!writeStoryWorkshop(storage,result.state,{expectedRaw:raw})){
    blocked=true;reason='WRITE_CONFLICT';render();return;
  }
  state=result.state;raw=JSON.stringify(state);selected=-1;
  $('board-notice').textContent=result.message;
  render();
}
function touch(index){
  if(blocked)return;
  const item=state.board[index];
  if(item?.kind==='producer'){commit(produce(state,index));return;}
  if(selected===-1){if(item){selected=index;render();}return;}
  if(selected===index){selected=-1;render();return;}
  commit(moveOrMerge(state,selected,index));
}
$('reset-workshop').addEventListener('click',()=>{
  if(!window.confirm('确认重置剧情工作台？此处的金币、物品和订单进度将丢失，不影响普通经营或已读剧情。'))return;
  const current=readStoryWorkshop(storage);
  if(current.reason==='STORAGE_UNAVAILABLE')return;
  if(current.raw!==raw){blocked=true;reason='WRITE_CONFLICT';render();return;}
  const fresh=readStoryWorkshop({getItem:()=>null,setItem:()=>{}});
  if(writeStoryWorkshop(storage,fresh.state,{expectedRaw:raw,confirmedReset:true})){
    state=fresh.state;raw=JSON.stringify(state);blocked=false;reason=null;selected=-1;render();
  }else{blocked=true;reason='WRITE_CONFLICT';render();}
});
window.addEventListener('storage',event=>{
  if(event.key===STORY_WORKSHOP_KEY){blocked=true;reason='WRITE_CONFLICT';render();}
});
render();
