import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,produce,validateSave,PRODUCER_CHARGES} from '../merge/engine.mjs';
import {STORY_WORKSHOP_KEY,readStoryWorkshop} from '../merge/story/workshop-storage.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';

let sequence=0;
const now=Date.now();
function initial({coins=600,cooldown=false}={}){
  let state=createInitialState(now);
  const count=cooldown?12:1;
  for(let i=0;i<count;i++){
    const result=produce(state,42,now,()=>0.5);
    assert.equal(result.ok,true);
    state=result.state;
  }
  state.coins=coins;
  assert.equal(validateSave(state),true);
  return state;
}
async function mount(state,{locks=null,confirm=()=>true}={}){
  const data=new Map([[STORY_WORKSHOP_KEY,JSON.stringify(state)],
    [STORY_SAVE_KEY,null],[SAVE_KEY,'normal-sentinel']]);
  const writes=[];
  const storage={
    getItem:key=>data.has(key)?data.get(key):null,
    setItem(key,value){writes.push(key);data.set(key,value);}
  };
  class Node {
    constructor(){this.textContent='';this.disabled=false;this.dataset={};
      this.children=[];this.listeners=new Map();}
    setAttribute(){}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=[...children];}
    remove(){}
    addEventListener(type,callback){
      const list=this.listeners.get(type)??[];
      list.push(callback);this.listeners.set(type,list);
    }
    async fire(type){
      for(const callback of this.listeners.get(type)??[])
        await callback({type,target:this});
    }
  }
  const elements=new Map();
  const document={
    getElementById(id){
      if(!elements.has(id))elements.set(id,new Node());
      return elements.get(id);
    },
    createElement(){return new Node();},
    createDocumentFragment(){return new Node();},
    addEventListener(){},
    visibilityState:'visible',
    body:new Node()
  };
  const window={localStorage:storage,navigator:{locks},
    addEventListener(){},confirm,setTimeout(){}};
  const priorWindow=globalThis.window,priorDocument=globalThis.document;
  globalThis.window=window;globalThis.document=document;
  try{
    await import(new URL('../merge/story/workshop.mjs?p74='+ ++sequence,import.meta.url));
  }catch(error){
    globalThis.window=priorWindow;globalThis.document=priorDocument;
    throw error;
  }
  return {
    data,writes,storage,document,
    node:id=>document.getElementById(id),
    saved:()=>readStoryWorkshop(storage,now).state,
    button:(container,key,value)=>document.getElementById(container).children
      .find(child=>child.dataset[key]===value),
    restore(){globalThis.window=priorWindow;globalThis.document=priorDocument;}
  };
}

test('P74 real story-only soda purchase and use persist without touching normal or narrative saves',async()=>{
  const f=await mount(initial());
  try{
    const before=f.saved();
    const buy=f.button('story-supply-shop','supplyBuy','soda');
    assert.equal(buy.disabled,false);
    await buy.fire('click');
    let state=f.saved();
    assert.equal(state.bag.soda,1);
    assert.equal(state.shop.purchases.soda,1);
    assert.equal(state.coins,before.coins-90);
    const use=f.button('story-supply-bag','supplyUse','soda');
    assert.equal(use.disabled,false);
    await use.fire('click');
    state=f.saved();
    assert.equal(state.bag.soda,0);
    assert.equal(state.energy,120);
    assert.equal(state.revision,before.revision+2);
    assert.equal(validateSave(state),true);
    assert.deepEqual(f.writes,[STORY_WORKSHOP_KEY,STORY_WORKSHOP_KEY]);
    assert.equal(f.data.get(SAVE_KEY),'normal-sentinel');
    assert.equal(f.data.get(STORY_SAVE_KEY),null);
  }finally{f.restore();}
});

test('P74 detached shop buttons cannot buy twice after a rerender',async()=>{
  const f=await mount(initial());
  try{
    const old=f.button('story-supply-shop','supplyBuy','soda');
    await old.fire('click');
    const saved=JSON.stringify(f.saved()),writes=f.writes.length;
    await old.fire('click');
    assert.equal(JSON.stringify(f.saved()),saved);
    assert.equal(f.writes.length,writes);
    assert.match(f.node('board-notice').textContent,/界面已更新/);
  }finally{f.restore();}
});

test('P74 real cooldown cards target only the selected story producer and retain finite stock',async()=>{
  const f=await mount(initial({cooldown:true,coins:1000}));
  try{
    assert.equal(f.saved().board[42].charges,0);
    for(const id of ['speed','reset']){
      const buy=f.button('story-supply-shop','supplyBuy',id);
      assert.equal(buy.disabled,false);
      await buy.fire('click');
    }
    const before=f.saved(),cooling=f.node('story-supply-cooldowns').children;
    assert.equal(cooling.length,1);
    const speed=cooling[0].children.find(x=>x.dataset.supplyUse==='speed');
    await speed.fire('click');
    let after=f.saved();
    assert.equal(after.board[42].charges,0);
    assert.ok(after.board[42].cooldownUntil<before.board[42].cooldownUntil);
    assert.deepEqual(after.board[44],before.board[44]);
    assert.equal(after.bag.speed,0);
    const reset=f.node('story-supply-cooldowns').children[0].children
      .find(x=>x.dataset.supplyUse==='reset');
    await reset.fire('click');
    after=f.saved();
    assert.equal(after.board[42].charges,PRODUCER_CHARGES);
    assert.equal(after.board[42].cooldownUntil,0);
    assert.equal(after.bag.reset,0);
    assert.equal(after.shop.purchases.speed,1);
    assert.equal(after.shop.purchases.reset,1);
    assert.equal(validateSave(after),true);
    assert.equal(f.data.get(SAVE_KEY),'normal-sentinel');
  }finally{f.restore();}
});

test('P74 lock failure blocks supply purchases without any save writes',async()=>{
  const f=await mount(initial(),{locks:{request(){return Promise.reject(new Error('lock unavailable'));}}});
  try{
    const original=f.data.get(STORY_WORKSHOP_KEY);
    await f.button('story-supply-shop','supplyBuy','soda').fire('click');
    assert.deepEqual(f.writes,[]);
    assert.equal(f.data.get(STORY_WORKSHOP_KEY),original);
    assert.equal(f.data.get(SAVE_KEY),'normal-sentinel');
    assert.match(f.node('board-notice').textContent,/无法确认/);
    assert.match(f.node('workshop-status').textContent,/已停止操作/);
  }finally{f.restore();}
});

test('P74 finite soda stock remains exhausted after reloading the isolated story save',async()=>{
  const f=await mount(initial({coins:1000}));
  try{
    for(let i=0;i<4;i++){
      const buy=f.button('story-supply-shop','supplyBuy','soda');
      assert.equal(buy.disabled,false);
      await buy.fire('click');
    }
    const state=f.saved();
    assert.equal(state.shop.purchases.soda,4);
    assert.equal(state.bag.soda,4);
    assert.equal(state.coins,640);
    assert.equal(validateSave(state),true);
    assert.equal(f.button('story-supply-shop','supplyBuy','soda').disabled,true);
    assert.equal(readStoryWorkshop(f.storage,now).state.shop.purchases.soda,4);
  }finally{f.restore();}
});

test('P75 spending a construction reserve needs confirmation; cancellation preserves both mode saves',async()=>{
  let prompts=0;
  const f=await mount(initial({coins:160}),{confirm:message=>{
    prompts++;assert.match(message,/后院花园/);return false;
  }});
  try{
    const buy=f.button('story-supply-shop','supplyBuy','soda');
    assert.match(f.node('story-supply-budget-hint').textContent,/后院花园/);
    assert.match(buy.textContent,/将动用建设储备/);
    await buy.fire('click');
    assert.equal(prompts,1);
    assert.deepEqual(f.writes,[]);
    assert.equal(f.saved().coins,160);
    assert.equal(f.saved().shop.purchases.soda,0);
    assert.match(f.node('board-notice').textContent,/已取消补给购买/);
    assert.equal(f.data.get(SAVE_KEY),'normal-sentinel');
    assert.equal(f.data.get(STORY_SAVE_KEY),null);
  }finally{f.restore();}
});

test('P75 confirmed reserve spend remains finite and shows exact next-building shortfall',async()=>{
  let prompts=0;
  const f=await mount(initial({coins:160}),{confirm:()=>{
    prompts++;return true;
  }});
  try{
    await f.button('story-supply-shop','supplyBuy','soda').fire('click');
    const saved=f.saved();
    assert.equal(prompts,1);
    assert.equal(saved.coins,70);
    assert.equal(saved.bag.soda,1);
    assert.equal(saved.shop.purchases.soda,1);
    assert.equal(validateSave(saved),true);
    assert.match(f.node('story-supply-budget-hint').textContent,/还差 ◈90/);
    assert.deepEqual(f.writes,[STORY_WORKSHOP_KEY]);
    assert.equal(f.data.get(SAVE_KEY),'normal-sentinel');
    assert.equal(f.data.get(STORY_SAVE_KEY),null);
  }finally{f.restore();}
});


// P76: A native confirm dialog can allow another tab to modify localStorage
// before the original page receives a storage event. These tests exercise the
// actual workshop module and do not emulate Safari or cross-process atomicity.
test('P76 stale workshop before tap blocks reserve prompt without writing',async()=>{
  let prompts=0;
  const f=await mount(initial({coins:160}),{confirm:()=>{prompts++;return true;}});
  try{
    const old=f.button('story-supply-shop','supplyBuy','soda');
    const outside={...f.saved(),coins:185,revision:f.saved().revision+1};
    assert.equal(validateSave(outside),true);
    f.data.set(STORY_WORKSHOP_KEY,JSON.stringify(outside)); // another tab, not our write
    await old.fire('click');
    assert.equal(prompts,0,'must not prompt against a stale budget');
    assert.deepEqual(f.writes,[]);
    assert.equal(f.saved().coins,185);
    assert.equal(f.saved().shop.purchases.soda,0);
    assert.match(f.node('board-notice').textContent,/存档已变化/);
    assert.match(f.node('workshop-status').textContent,/已停止操作/);
    assert.equal(f.data.get(SAVE_KEY),'normal-sentinel');
  }finally{f.restore();}
});

for(const consent of [false,true]){
  test('P76 external overwrite during '+(consent?'approved':'cancelled')+
    ' reserve dialog never publishes stale purchase feedback',async()=>{
    let prompts=0,f;
    f=await mount(initial({coins:160}),{confirm:()=>{
      prompts++;
      const outside={...f.saved(),coins:185,revision:f.saved().revision+1};
      assert.equal(validateSave(outside),true);
      f.data.set(STORY_WORKSHOP_KEY,JSON.stringify(outside)); // another tab during modal
      return consent;
    }});
    try{
      await f.button('story-supply-shop','supplyBuy','soda').fire('click');
      assert.equal(prompts,1);
      assert.deepEqual(f.writes,[],'stale page must not write or auto-retry');
      assert.equal(f.saved().coins,185);
      assert.equal(f.saved().shop.purchases.soda,0);
      assert.match(f.node('board-notice').textContent,/存档已变化/);
      assert.doesNotMatch(f.node('board-notice').textContent,
        /已取消补给购买，金币未扣除|购买成功/);
      assert.match(f.node('workshop-status').textContent,/已停止操作/);
      assert.equal(f.data.get(SAVE_KEY),'normal-sentinel');
      assert.equal(f.data.get(STORY_SAVE_KEY),null);
    }finally{f.restore();}
  });
}
