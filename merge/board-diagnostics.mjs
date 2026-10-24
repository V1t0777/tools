/** P3.7 pure diagnostics; never modifies or auto-submits player state. */
import {validateSave,CELL_COUNT,MAX_TIER} from './engine.mjs';
import {getLevel,getWarehouseUpgrade} from './economy.mjs';
const material=x=>x?.kind==='material';
export function diagnoseBoard(s) {
  if(!validateSave(s))throw new TypeError('Invalid merge game state');
  const occupied=s.board.filter(Boolean).length,free=CELL_COUNT-occupied;
  const used=s.warehouse.slots.slice(0,s.warehouse.capacity).filter(Boolean).length;
  const warehouseFree=s.warehouse.capacity-used;
  const requests=s.orders.map(o=>({
    orderId:o.id,
    boardSlot:s.board.findIndex(x=>material(x)&&x.chain===o.chain&&x.tier===o.tier),
    warehouseSlot:s.warehouse.slots.findIndex((x,i)=>i<s.warehouse.capacity&&material(x)&&x.chain===o.chain&&x.tier===o.tier)
  }));
  const readyOrders=requests.filter(x=>x.boardSlot>=0);
  const hiddenOrders=requests.filter(x=>x.boardSlot<0&&x.warehouseSlot>=0);
  const groups=new Map();
  s.board.forEach((x,i)=>{
    if(!material(x)||x.tier>=MAX_TIER)return;
    const key=x.chain+':'+x.tier;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(i);
  });
  const merges=[];
  for(const slots of groups.values())for(let i=0;i+1<slots.length;i+=2)
    merges.push({from:slots[i],to:slots[i+1]});
  const storable=s.board.flatMap((x,i)=>material(x)?[i]:[]);
  const upgrade=getWarehouseUpgrade(s.warehouse.capacity);
  const canUpgrade=!!upgrade&&getLevel(s.xp)>=upgrade.minLevel&&s.coins>=upgrade.coins;
  const producerSlots=s.board.flatMap((x,i)=>x?.kind==='producer'&&x.charges>0?[i]:[]);
  const canProduce=free>0&&s.energy>0&&producerSlots.length>0;
  let hint=null;
  if(readyOrders.length)hint={type:'order',orderId:readyOrders[0].orderId,message:'可以交付现成委托，腾出棋盘空间'};
  else if(merges.length)hint={type:'move',...merges[0],message:'发现可合成物品，合成后可以腾出一格'};
  else if(free>0&&hiddenOrders.length)hint={type:'withdraw',slot:hiddenOrders[0].warehouseSlot,message:'仓库有委托材料，可取出后交付'};
  else if(free===0&&warehouseFree>0&&storable.length) {
    const slot=storable.slice().sort((a,b)=>s.board[a].tier-s.board[b].tier||a-b)[0];
    hint={type:'store',slot,message:'棋盘已满，可先将材料收入仓库'};
  } else if(free===0&&canUpgrade&&storable.length)hint={type:'upgradeWarehouse',message:'可先扩容仓库，再存入材料'};
  else if(canProduce)hint={type:'produce',slot:producerSlots[0],message:'可以使用工坊生产材料'};
  else if(free>0)hint={type:'wait',message:s.energy===0?'等待体力恢复':'等待工坊充能'};
  const recovery=free===0?(hint?'recoverable':'hard-deadlock'):
    (!canProduce&&!readyOrders.length&&!merges.length&&!hiddenOrders.length?'waiting':'playable');
  return {
    board:{occupied,free,capacity:CELL_COUNT,pressure:occupied/CELL_COUNT},
    warehouse:{used,free:warehouseFree,capacity:s.warehouse.capacity},
    actionable:{orders:readyOrders.length,merges:merges.length,
      storable:warehouseFree?storable.length:0,
      withdrawable:free?s.warehouse.slots.slice(0,s.warehouse.capacity).filter(Boolean).length:0,
      hiddenOrders:hiddenOrders.length,canUpgradeWarehouse:canUpgrade,
      producers:canProduce?producerSlots.length:0},
    recovery,hint
  };
}
