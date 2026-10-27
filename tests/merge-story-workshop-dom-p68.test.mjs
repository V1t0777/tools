import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';

// A minimal event-capable DOM: exercises the REAL workshop entry module,
// not a copy of its reset logic. This is not an iPhone/WebView emulator.
let moduleSequence=0;
async function mountWorkshop({makeLocks}={}){
  const map=new Map([[STORY_SAVE_KEY,'story-sentinel'],[SAVE_KEY,'normal-sentinel']]);
  let writes=0;
  const storage={
    getItem(key){return map.has(key)?map.get(key):null;},
    setItem(key,value){writes++;map.set(key,value);}
  };
  class Node {
    constructor(){
      this.textContent='';this.disabled=false;this.dataset={};
      this.children=[];this.listeners=new Map();
    }
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
    click(){return this.fire('click');}
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
  const window={
    localStorage:storage,
    navigator:{locks:makeLocks?makeLocks(map):null},
    confirm(){return true;},
    addEventListener(){},
    setTimeout(){}
  };
  const priorWindow=globalThis.window,priorDocument=globalThis.document;
  globalThis.window=window;globalThis.document=document;
  try{
    await import(new URL('../merge/story/workshop.mjs?dom-p68='+ ++moduleSequence,import.meta.url));
  }catch(error){
    globalThis.window=priorWindow;globalThis.document=priorDocument;
    throw error;
  }
  return {
    map,storage,document,
    get writes(){return writes;},
    notice(){return document.getElementById('board-notice').textContent;},
    async reset(){await document.getElementById('reset-workshop').fire('click');},
    restore(){globalThis.window=priorWindow;globalThis.document=priorDocument;}
  };
}

test('P68 rejected Web Lock retracts previous success notice without writing either save',async()=>{
  const f=await mountWorkshop({makeLocks:()=>({
    request(){return Promise.reject(new Error('lock unavailable'));}
  })});
  try{
    f.document.getElementById('board-notice').textContent='上次交单成功';
    await f.reset();
    assert.match(f.notice(),/重置操作的最终状态无法确认/);
    assert.match(f.notice(),/请勿重复重置/);
    assert.doesNotMatch(f.notice(),/上次交单成功/);
    assert.match(f.document.getElementById('workshop-status').textContent,/已停止操作/);
    assert.equal(f.writes,0);
    assert.equal(f.map.has(STORY_WORKSHOP_KEY),false);
    assert.equal(f.map.get(STORY_SAVE_KEY),'story-sentinel');
    assert.equal(f.map.get(SAVE_KEY),'normal-sentinel');
  }finally{f.restore();}
});

test('P68 external overwrite after lock release prevents reset success and automatic retry',async()=>{
  const f=await mountWorkshop({makeLocks:map=>({
    async request(_name,_options,callback){
      const result=await callback();
      map.set(STORY_WORKSHOP_KEY,'{"changedByOtherTab":true}');
      return result;
    }
  })});
  try{
    f.document.getElementById('board-notice').textContent='上次生产成功';
    await f.reset();
    assert.match(f.notice(),/重置后的存档状态无法确认/);
    assert.doesNotMatch(f.notice(),/上次生产成功|已重置剧情工作台/);
    assert.equal(f.map.get(STORY_WORKSHOP_KEY),'{"changedByOtherTab":true}');
    assert.equal(f.writes,1,'one attempted reset, no automatic retry');
    assert.equal(f.map.get(SAVE_KEY),'normal-sentinel');
  }finally{f.restore();}
});

test('P68 synchronous DOM render overwrite retracts reset success after second readback',async()=>{
  const f=await mountWorkshop();
  try{
    const energy=f.document.getElementById('energy');
    let text=energy.textContent,renderCount=0;
    Object.defineProperty(energy,'textContent',{
      get(){return text;},
      set(next){
        text=next;
        if(++renderCount===2)f.map.set(STORY_WORKSHOP_KEY,'{"changedDuringRender":true}');
      }
    });
    await f.reset();
    assert.equal(renderCount>=3,true,'blocked UI must rerender after the fault');
    assert.match(f.notice(),/重置成功提示已撤回/);
    assert.doesNotMatch(f.notice(),/^已重置剧情工作台/);
    assert.equal(f.writes,1);
    assert.equal(f.map.get(STORY_WORKSHOP_KEY),'{"changedDuringRender":true}');
    assert.equal(f.map.get(STORY_SAVE_KEY),'story-sentinel');
  }finally{f.restore();}
});

test('P68 uncontested reset keeps its success notice and both other saves intact',async()=>{
  const f=await mountWorkshop();
  try{
    await f.reset();
    assert.match(f.notice(),/^已重置剧情工作台/);
    assert.equal(f.writes,1);
    assert.equal(typeof f.map.get(STORY_WORKSHOP_KEY),'string');
    assert.equal(f.map.get(STORY_SAVE_KEY),'story-sentinel');
    assert.equal(f.map.get(SAVE_KEY),'normal-sentinel');
    assert.match(f.document.getElementById('workshop-status').textContent,/完全隔离/);
  }finally{f.restore();}
});

test('P68 disabled storage reset cannot be bypassed by a queued DOM click',()=>{
  const ui=readFileSync(new URL('../merge/story/workshop.mjs',import.meta.url),'utf8');
  const handler=ui.slice(ui.indexOf("$('reset-workshop').addEventListener('click',async()=>{"),
    ui.indexOf('function recheckWorkshopOnResume(){'));
  assert.ok(handler.includes("if(reason==='STORAGE_UNAVAILABLE')return;"));
  assert.equal((handler.match(/blockWorkshopWithNotice\(/g)??[]).length,3);
  assert.ok(handler.includes('expectedRaw,isCurrent:()=>storageEpoch===expectedEpoch'));
  assert.ok(handler.includes('const afterResetRender=verifyStoryWorkshopPublication('));
});
