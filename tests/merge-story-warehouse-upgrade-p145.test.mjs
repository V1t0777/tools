import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState,storeItem,produce,validateSave,MAX_TIER} from '../merge/engine.mjs';
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
  const window={localStorage:storage,navigator:{locks:null},confirm,
    addEventListener(){}};
  const priorWindow=globalThis.window,priorDocument=globalThis.document;
  globalThis.window=window;globalThis.document=document;
  try{
    await import(new URL('../merge/story/workshop.mjs?p145='+ ++sequence,import.meta.url));
  }catch(error){
    globalThis.window=priorWindow;globalThis.document=priorDocument;throw error;
  }
  return {map,document,storage,get writes(){return writes;},
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
