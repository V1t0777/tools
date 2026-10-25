/**
 * P30: Read-only consequences of real story-workshop actions in daily events.
 * Never changes the story pack, economic state, saves, or event selection.
 * Only core incident IDs have explicit narrative echoes. Unknown DLC IDs
 * remain untouched until their own reviewed content adapter is provided.
 */
import {validateSave} from '../engine.mjs';
import {CORE_STORY_PACK} from './core-pack.mjs';

const hasOwn=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
const ECHOES=Object.freeze({
  'cat-nap':Object.freeze({
    true:Object.freeze({speaker:'阿澄',text:'门面修整以后，小猫又发现了檐下的新阴影。阿澄把纸箱挪到不挡客人的地方，大家依旧能在这里歇脚。'}),
    false:Object.freeze({speaker:'阿澄',text:'门面还没有修整好，阿澄先给小猫铺了一块干净的旧布，没有让它占住客人的座位。'})
  }),
  'surprise-rain':Object.freeze({
    true:Object.freeze({speaker:'晚禾',text:'修复过的花园排水比以前顺畅。晚禾仍细心检查每一盆花，生怕雨水冲走刚冒头的嫩芽。'}),
    false:Object.freeze({speaker:'晚禾',text:'花圃还等着修复。晚禾把旧种子和标签收进屋里，决定等天气放晴，再慢慢商量怎么动工。'})
  }),
  'visitor':Object.freeze({
    true:Object.freeze({speaker:'旅人',text:'我听说这间小铺已经重新接下街坊的委托。旅人看着柜台，问起岛上现在需要怎样的帮忙。'}),
    false:Object.freeze({speaker:'阿澄',text:'柜台上的第一批委托还在准备。阿澄给旅人倒了一杯水，告诉他大家正在慢慢把铺子经营起来。'})
  }),
  'fog':Object.freeze({
    true:Object.freeze({speaker:'岚叔',text:'港湾街角虽然已经修缮，海雾大时还是不能贸然出航。岚叔让学徒先把岸上的引导标记检查一遍。'}),
    false:Object.freeze({speaker:'岚叔',text:'港湾街角还没有修好。岚叔先封住松动的木板，等雾散了再安排安全的修缮工作。'})
  }),
  'baking':Object.freeze({
    true:Object.freeze({speaker:'阿澄',text:'铺子已经认真交付过街坊委托，这一盘烤焦的饼干倒让大家想起：做生意之外，也可以允许自己偶尔失手。'}),
    false:Object.freeze({speaker:'阿澄',text:'工作台的委托还等着我们慢慢做。阿澄把烤焦的饼干放到一边，决定先把能做好的事做好。'})
  }),
  'old-crate':Object.freeze({
    true:Object.freeze({speaker:'岚叔',text:'修缮后的港湾街角有了安全的登记位置。岚叔依旧坚持先保管木箱，确认失主之前不擅自拆封。'}),
    false:Object.freeze({speaker:'岚叔',text:'港湾街角尚未修整，木箱暂时只登记外观与发现位置。岚叔提醒大家，先别把未知的东西搬进店里。'})
  })
});

export function incidentWorkshopEcho(entry,workshopState){
  if(!entry||entry.kind!=='incident'||typeof entry.id!=='string'||
    !hasOwn(ECHOES,entry.id)||!CORE_STORY_PACK.entries.includes(entry))
    return null;
  if(!validateSave(workshopState))return null;
  const built=workshopState.buildings;
  const delivered=workshopState.progress.orders>0;
  const condition=entry.id==='cat-nap'?built.storefront===1
    :entry.id==='surprise-rain'?built.garden===1
    :entry.id==='fog'||entry.id==='old-crate'?built.harbor===1
    :delivered;
  return ECHOES[entry.id][String(condition)];
}
