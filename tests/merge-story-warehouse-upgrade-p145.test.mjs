import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState,storeItem,produce,validateSave,MAX_TIER,MAX_ENERGY,ENERGY_REGEN_MS,PRODUCER_RECHARGE_MS,PRODUCER_CHARGES} from '../merge/engine.mjs';
import {STORY_WORKSHOP_KEY,readStoryWorkshop} from '../merge/story/workshop-storage.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';

const NOW=1_000_000;
let sequence=0;
function initial(coins=50){
  const state=createInitialState(NOW);
  state.xp=28;state.coins=coins;
  state.board=state.board.map(item=>item??{
    id:'m'+state.nextId++,kind:'material',chain:'tea',tier:MAX_TIER
  });
  for(let i=0;i<state.warehouse.capacity;i++)
    state.warehouse.slots[i]={id:'m'+state.nextId++,kind:'material',chain:'floral',tier:MAX_TIER};
  assert.equal(validateSave(state),true);
  return state;
}
async function mount(state,confirm=()=>true){
  const map=new Map([
    [STORY_WORKSHOP_KEY,JSON.stringify(state)],
    [SAVE_KEY,'normal-mode-sentinel'],
    [STORY_SAVE_KEY,'story-dialogue-sentinel']
  ]);
  let writes=0;
  const storage={
    getItem:key=>map.has(key)?map.get(key):null,
    setItem(key,value){writes++;map.set(key,value);}
  };
  class Element{
    constructor(){this.textContent='';this.disabled=false;this.dataset={};
      this.hidden=false;this.children=[];this.listeners=new Map();}
    setAttribute(){}
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(...nodes){this.children=nodes;}
    addEventListener(type,fn){const list=this.listeners.get(type)??[];
      list.push(fn);this.listeners.set(type,list);}
    async click(){for(const fn of this.listeners.get('click')??[])
      await fn({detail:1,preventDefault(){},stopImmediatePropagation(){}});
      await new Promise(resolve=>setImmediate(resolve));}
  }
  const elements=new Map();
  const document={
    visibilityState:'visible',
    getElementById(id){if(!elements.has(id))elements.set(id,new Element());
      return elements.get(id);},
    createElement(){return new Element();},
    createDocumentFragment(){return new Element();},
    addEventListener(){}
  };
  const windowEvents=new Map();
  const window={localStorage:storage,navigator:{locks:null},confirm,
    addEventListener(type,fn){
      const handlers=windowEvents.get(type)??[];
      handlers.push(fn);windowEvents.set(type,handlers);
    },
    emit(type){
      for(const handler of windowEvents.get(type)??[])handler({type});
    }};
  const priorWindow=globalThis.window,priorDocument=globalThis.document;
  globalThis.window=window;globalThis.document=document;
  try{
    await import(new URL('../merge/story/workshop.mjs?p145='+ ++sequence,import.meta.url));
  }catch(error){
    globalThis.window=priorWindow;globalThis.document=priorDocument;throw error;
  }
  return {map,document,window,storage,get writes(){return writes;},
    restore(){globalThis.window=priorWindow;globalThis.document=priorDocument;}};
}

test('P145 full-board story warehouse has a real paid expansion button and isolated save',async()=>{
  const f=await mount(initial());
  try{
    const button=f.document.getElementById('upgrade-story-warehouse');
    assert.equal(button.disabled,false);
    assert.match(button.textContent,/6 格 · ◈50/);
    await button.click();
    const next=readStoryWorkshop(f.storage);
    assert.equal(next.blocked,false);
    assert.equal(next.state.warehouse.capacity,6);
    assert.equal(next.state.coins,0);
    assert.equal(next.state.revision,1);
    assert.equal(f.writes,1);
    assert.equal(f.map.get(SAVE_KEY),'normal-mode-sentinel');
    assert.equal(f.map.get(STORY_SAVE_KEY),'story-dialogue-sentinel');
    const stored=storeItem(next.state,0);
    assert.equal(stored.ok,true);
    assert.equal(produce(stored.state,42,NOW,()=>0).ok,true);
  }finally{f.restore();}
});

test('P145 spending the next construction reserve requires explicit consent',async()=>{
  let confirms=0;
  const f=await mount(initial(170),()=>{confirms++;return false;});
  try{
    assert.match(f.document.getElementById('warehouse-upgrade-hint').textContent,/金币储备/);
    await f.document.getElementById('upgrade-story-warehouse').click();
    assert.equal(confirms,1);
    assert.equal(f.writes,0);
    assert.equal(readStoryWorkshop(f.storage).state.coins,170);
    assert.match(f.document.getElementById('board-notice').textContent,/已取消仓库扩容/);
  }finally{f.restore();}
});

test('P145 peer-tab save replacement during native consent cannot spend stale coins',async()=>{
  const state=initial(170);
  let f;
  f=await mount(state,()=>{
    const peer=structuredClone(state);peer.revision=1;peer.coins=165;
    f.map.set(STORY_WORKSHOP_KEY,JSON.stringify(peer));
    return true;
  });
  try{
    await f.document.getElementById('upgrade-story-warehouse').click();
    assert.equal(f.writes,0);
    assert.equal(readStoryWorkshop(f.storage).state.coins,165);
    assert.equal(readStoryWorkshop(f.storage).state.warehouse.capacity,4);
    assert.match(f.document.getElementById('board-notice').textContent,/存档已变化/);
  }finally{f.restore();}
});

test('P145 no bypass of level, price, or maximum capacity; mobile control contract',async()=>{
  const low=initial(0);low.xp=0;
  const f=await mount(low);
  try{
    assert.equal(f.document.getElementById('upgrade-story-warehouse').disabled,true);
    assert.equal(f.writes,0);
  }finally{f.restore();}
  const html=readFileSync(new URL('../merge/story-workshop.html',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../merge/story/workshop.mjs',import.meta.url),'utf8');
  const css=readFileSync(new URL('../merge/story/workshop.css',import.meta.url),'utf8');
  assert.match(html,/id="upgrade-story-warehouse"/);
  assert.match(html,/id="warehouse-upgrade-hint"/);
  assert.match(ui,/guardStoryPersistentGesture/);
  assert.match(ui,/commit\(upgradeWarehouse\(state\)\)/);
  assert.match(ui,/wouldSpendStoryConstructionReserve\(budget,rule.coins\)/);
  assert.match(css,/\.workshop-build\{[^}]*min-height:48px/);
  assert.equal(ui.includes('SAVE_KEY'),false);
});

test('P146 approved reserve spending expands warehouse exactly once',async()=>{
  const f=await mount(initial(170),()=>true);
  try{
    await f.document.getElementById('upgrade-story-warehouse').click();
    const saved=readStoryWorkshop(f.storage);
    assert.equal(saved.blocked,false);
    assert.equal(saved.state.warehouse.capacity,6);
    assert.equal(saved.state.coins,120);
    assert.equal(saved.state.revision,1);
    assert.equal(f.writes,1);
    assert.equal(f.map.get(SAVE_KEY),'normal-mode-sentinel');
    assert.equal(f.map.get(STORY_SAVE_KEY),'story-dialogue-sentinel');
  }finally{f.restore();}
});

test('P146 BFCache pagehide inside warehouse consent refuses stale payment',async()=>{
  let f,confirms=0;
  f=await mount(initial(170),()=>{
    confirms++;
    f.window.emit('pagehide');
    return true;
  });
  try{
    await f.document.getElementById('upgrade-story-warehouse').click();
    assert.equal(confirms,1);
    assert.equal(f.writes,0);
    assert.equal(readStoryWorkshop(f.storage).state.warehouse.capacity,4);
    assert.equal(readStoryWorkshop(f.storage).state.coins,170);
    assert.equal(f.document.getElementById('upgrade-story-warehouse').disabled,true);
    assert.equal(f.map.get(SAVE_KEY),'normal-mode-sentinel');
    assert.equal(f.map.get(STORY_SAVE_KEY),'story-dialogue-sentinel');
  }finally{f.restore();}
});

test('P146 same-revision peer replacement during warehouse consent is rejected',async()=>{
  const initialState=initial(170);
  let f;
  f=await mount(initialState,()=>{
    const peer=structuredClone(initialState);
    peer.coins=165; // Same revision, different raw bytes: ABA-style stale view.
    f.map.set(STORY_WORKSHOP_KEY,JSON.stringify(peer));
    return true;
  });
  try{
    await f.document.getElementById('upgrade-story-warehouse').click();
    const saved=readStoryWorkshop(f.storage);
    assert.equal(f.writes,0);
    assert.equal(saved.blocked,false);
    assert.equal(saved.state.revision,0);
    assert.equal(saved.state.coins,165);
    assert.equal(saved.state.warehouse.capacity,4);
    assert.match(f.document.getElementById('board-notice').textContent,/存档已变化/);
    assert.equal(f.map.get(SAVE_KEY),'normal-mode-sentinel');
    assert.equal(f.map.get(STORY_SAVE_KEY),'story-dialogue-sentinel');
  }finally{f.restore();}
});


test('P147 long background return projects recovered energy and producer without writing',async()=>{
  const now=Date.now(),state=createInitialState(now);
  state.energy=0;state.energyAt=now-3*ENERGY_REGEN_MS-1000;
  state.board[42].charges=0;state.board[42].cooldownUntil=now-5000;
  assert.equal(validateSave(state),true);
  const f=await mount(state);
  try{
    const energy=f.document.getElementById('energy');
    const cell=()=>f.document.getElementById('workshop-board').children[0].children[42];
    assert.equal(energy.textContent,'3 / '+MAX_ENERGY);
    assert.equal(cell().children[1].textContent,PRODUCER_CHARGES+'次');
    assert.match(f.document.getElementById('story-supply-cooldown-hint').textContent,/没有正在冷却/);
    assert.equal(f.writes,0);
    f.window.emit('pagehide');
    assert.equal(cell().disabled,true);
    f.window.emit('pageshow');
    assert.equal(cell().disabled,false);
    assert.equal(energy.textContent,'3 / '+MAX_ENERGY);
    assert.equal(f.writes,0);
    await cell().click();
    const saved=readStoryWorkshop(f.storage);
    assert.equal(saved.blocked,false);
    assert.equal(saved.state.energy,2);
    assert.equal(saved.state.board[42].charges,PRODUCER_CHARGES-1);
    assert.equal(saved.state.revision,1);
    assert.equal(f.writes,1);
    assert.equal(f.map.get(SAVE_KEY),'normal-mode-sentinel');
    assert.equal(f.map.get(STORY_SAVE_KEY),'story-dialogue-sentinel');
  }finally{f.restore();}
});

test('P147 recovered full energy disables wasteful supply use without a save write',async()=>{
  const now=Date.now(),state=createInitialState(now);
  state.energy=MAX_ENERGY-1;state.energyAt=now-2*ENERGY_REGEN_MS;
  state.bag.soda=1;state.shop.purchases.soda=1;
  assert.equal(validateSave(state),true);
  const f=await mount(state);
  try{
    const soda=f.document.getElementById('story-supply-bag').children[0];
    assert.equal(f.document.getElementById('energy').textContent,MAX_ENERGY+' / '+MAX_ENERGY);
    assert.equal(soda.disabled,true);
    assert.equal(f.writes,0);
    f.window.emit('pagehide');f.window.emit('pageshow');
    assert.equal(f.document.getElementById('story-supply-bag').children[0].disabled,true);
    assert.equal(f.writes,0);
    assert.equal(readStoryWorkshop(f.storage).state.energy,MAX_ENERGY-1);
  }finally{f.restore();}
});

test('P147 unexpired cooldown remains visibly blocked after BFCache and never auto-spends cards',async()=>{
  const now=Date.now(),state=createInitialState(now);
  state.board[42].charges=0;state.board[42].cooldownUntil=now+120000;
  state.bag.reset=1;state.shop.purchases.reset=1;
  assert.equal(validateSave(state),true);
  const f=await mount(state);
  try{
    const cell=()=>f.document.getElementById('workshop-board').children[0].children[42];
    assert.equal(cell().children[1].textContent,'冷却中');
    f.window.emit('pagehide');f.window.emit('pageshow');
    assert.equal(cell().children[1].textContent,'冷却中');
    assert.match(f.document.getElementById('story-supply-cooldown-hint').textContent,/正在冷却/);
    assert.equal(f.writes,0);
    assert.equal(readStoryWorkshop(f.storage).state.bag.reset,1);
  }finally{f.restore();}
});


test('P149 rollback energy warning is actionable after BFCache and never writes saves',async()=>{
  const now=Date.now(),state=createInitialState(now);
  state.energy=0;state.energyAt=now+2*ENERGY_REGEN_MS;
  assert.equal(validateSave(state),true);
  const f=await mount(state);
  try{
    const cell=()=>f.document.getElementById('workshop-board').children[0].children[42];
    f.window.emit('pagehide');f.window.emit('pageshow');
    assert.equal(cell().disabled,false);
    await cell().click();
    const notice=f.document.getElementById('board-notice').textContent;
    assert.match(notice,/设备时间早于存档的体力计时/);
    assert.doesNotMatch(notice,/预计\d+秒后自然恢复/);
    assert.equal(f.writes,0);
    assert.equal(f.map.get(STORY_WORKSHOP_KEY),JSON.stringify(state));
    assert.equal(f.map.get(SAVE_KEY),'normal-mode-sentinel');
    assert.equal(f.map.get(STORY_SAVE_KEY),'story-dialogue-sentinel');
  }finally{f.restore();}
});

test('P149 impossible cooldown suppresses misleading engine countdown without spending a card',async()=>{
  const now=Date.now(),state=createInitialState(now);
  state.board=state.board.map(item=>item?.kind==='producer'
    ? {...item,charges:0,cooldownUntil:now+2*PRODUCER_RECHARGE_MS}:item);
  state.bag.reset=1;state.shop.purchases.reset=1;
  assert.equal(validateSave(state),true);
  const f=await mount(state);
  try{
    const cell=f.document.getElementById('workshop-board').children[0].children[42];
    await cell.click();
    const notice=f.document.getElementById('board-notice').textContent;
    assert.match(notice,/工坊冷却时间超出正常上限/);
    assert.doesNotMatch(notice,/冷却中，剩余\s*\d+\s*秒/);
    assert.equal(f.writes,0);
    assert.equal(f.map.get(STORY_WORKSHOP_KEY),JSON.stringify(state));
    assert.equal(readStoryWorkshop(f.storage).state.bag.reset,1);
    assert.equal(f.map.get(SAVE_KEY),'normal-mode-sentinel');
    assert.equal(f.map.get(STORY_SAVE_KEY),'story-dialogue-sentinel');
  }finally{f.restore();}
});

test('P150 cold start warns about a future energy timestamp before any failed tap',async()=>{
  const now=Date.now(),state=createInitialState(now);
  state.energy=0;state.energyAt=now+2*ENERGY_REGEN_MS;
  assert.equal(validateSave(state),true);
  const f=await mount(state);
  try{
    const notice=()=>f.document.getElementById('board-notice').textContent;
    assert.match(notice(),/设备时间早于存档的体力计时/);
    assert.doesNotMatch(notice(),/预计\d+秒后自然恢复/);
    assert.equal(f.writes,0);
    f.window.emit('pagehide');f.window.emit('pageshow');
    assert.match(notice(),/设备时间早于存档的体力计时/);
    assert.equal(f.writes,0);
    assert.equal(f.map.get(STORY_WORKSHOP_KEY),JSON.stringify(state));
    assert.equal(f.map.get(SAVE_KEY),'normal-mode-sentinel');
    assert.equal(f.map.get(STORY_SAVE_KEY),'story-dialogue-sentinel');
  }finally{f.restore();}
});

test('P150 BFCache return warns about impossible producer cooldown without spending a card',async()=>{
  const now=Date.now(),state=createInitialState(now);
  state.board=state.board.map(item=>item?.kind==='producer'
    ? {...item,charges:0,cooldownUntil:now+2*PRODUCER_RECHARGE_MS}:item);
  state.bag.reset=1;state.shop.purchases.reset=1;
  assert.equal(validateSave(state),true);
  const f=await mount(state);
  try{
    const notice=()=>f.document.getElementById('board-notice').textContent;
    assert.match(notice(),/工坊冷却时间超出正常上限/);
    f.window.emit('pagehide');f.window.emit('pageshow');
    assert.match(notice(),/工坊冷却时间超出正常上限/);
    assert.equal(f.writes,0);
    assert.equal(readStoryWorkshop(f.storage).state.bag.reset,1);
    assert.equal(f.map.get(SAVE_KEY),'normal-mode-sentinel');
    assert.equal(f.map.get(STORY_SAVE_KEY),'story-dialogue-sentinel');
  }finally{f.restore();}
});

test('P150 ordinary cooldown must not be mistaken for device clock rollback',async()=>{
  const now=Date.now(),state=createInitialState(now);
  state.board[42].charges=0;
  state.board[42].cooldownUntil=now+PRODUCER_RECHARGE_MS;
  assert.equal(validateSave(state),true);
  const f=await mount(state);
  try{
    assert.doesNotMatch(f.document.getElementById('board-notice').textContent,/设备时间|冷却时间超出正常上限/);
    assert.equal(f.writes,0);
    assert.equal(f.map.get(STORY_WORKSHOP_KEY),JSON.stringify(state));
  }finally{f.restore();}
});
