import test from 'node:test';
import assert from 'node:assert/strict';
import {STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';

// Runs the actual story workshop entry module with an event-capable DOM.
// This is a Node fault-injection harness, NOT an iPhone/WebView emulator.
let sequence=0;
async function mount({makeLocks,corruptWorkshop=false}={}){
  const data=new Map([[STORY_SAVE_KEY,'story-sentinel'],[SAVE_KEY,'normal-sentinel']]);
  if(corruptWorkshop)data.set(STORY_WORKSHOP_KEY,'{broken');
  let writes=0;
  const storage={
    getItem:key=>data.has(key)?data.get(key):null,
    setItem(key,value){writes++;data.set(key,value);}
  };
  class Node {
    constructor(){
      this.textContent='';this.disabled=false;this.dataset={};
      this.children=[];this.listeners=new Map();
    }
    setAttribute(){}
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(...nodes){this.children=[...nodes];}
    remove(){}
    addEventListener(type,callback){
      const callbacks=this.listeners.get(type)??[];
      callbacks.push(callback);this.listeners.set(type,callbacks);
    }
    async fire(type,event={}){
      for(const callback of this.listeners.get(type)??[])
        await callback({type,target:this,...event});
    }
  }
  const elements=new Map();
  const docEvents=new Node(),winEvents=new Node();
  const document={
    visibilityState:'visible',
    getElementById(id){
      if(!elements.has(id))elements.set(id,new Node());
      return elements.get(id);
    },
    createElement:()=>new Node(),
    createDocumentFragment:()=>new Node(),
    addEventListener:(...args)=>docEvents.addEventListener(...args),
    emit:(...args)=>docEvents.fire(...args),
    body:new Node()
  };
  const window={
    localStorage:storage,navigator:{locks:makeLocks?makeLocks(data):null},
    confirm:()=>true,setTimeout(){},
    addEventListener:(...args)=>winEvents.addEventListener(...args),
    emit:(...args)=>winEvents.fire(...args)
  };
  const previousWindow=globalThis.window,previousDocument=globalThis.document;
  globalThis.window=window;globalThis.document=document;
  try{
    await import(new URL('../merge/story/workshop.mjs?lifecycle-p70='+ ++sequence,import.meta.url));
  }catch(error){
    globalThis.window=previousWindow;globalThis.document=previousDocument;
    throw error;
  }
  return {
    data,window,document,
    get writes(){return writes;},
    notice:()=>document.getElementById('board-notice').textContent,
    status:()=>document.getElementById('workshop-status').textContent,
    reset:()=>document.getElementById('reset-workshop').fire('click'),
    restore(){
      globalThis.window=previousWindow;globalThis.document=previousDocument;
    }
  };
}

test('P70 hidden BFCache pageshow does not unlock reset before visible verification',async()=>{
  const h=await mount();
  try{
    await h.window.emit('pagehide');
    h.document.visibilityState='hidden';
    await h.document.emit('visibilitychange');
    await h.window.emit('pageshow',{persisted:true});
    await h.reset();
    assert.equal(h.writes,0);
    assert.match(h.status(),/页面已暂停/);
    assert.equal(h.document.getElementById('reset-workshop').disabled,true);
    h.document.visibilityState='visible';
    await h.document.emit('visibilitychange');
    await h.reset();
    assert.equal(h.writes,1);
    assert.match(h.notice(),/^已重置剧情工作台/);
    assert.equal(h.data.get(SAVE_KEY),'normal-sentinel');
  }finally{h.restore();}
});

test('P70 pagehide requires pageshow; visibility alone cannot revive queued reset',async()=>{
  const h=await mount();
  try{
    await h.window.emit('pagehide');
    h.document.visibilityState='hidden';
    await h.document.emit('visibilitychange');
    h.document.visibilityState='visible';
    await h.document.emit('visibilitychange');
    await h.reset();
    assert.equal(h.writes,0);
    assert.equal(h.document.getElementById('reset-workshop').disabled,true);
    await h.window.emit('pageshow',{persisted:true});
    await h.reset();
    assert.equal(h.writes,1);
  }finally{h.restore();}
});

test('P70 cross-tab overwrite during hidden BFCache prevents resume and reset',async()=>{
  const h=await mount();
  try{
    await h.window.emit('pagehide');
    h.document.visibilityState='hidden';
    await h.window.emit('pageshow',{persisted:true});
    h.data.set(STORY_WORKSHOP_KEY,'{"external":true}');
    h.document.visibilityState='visible';
    await h.document.emit('visibilitychange');
    await h.reset();
    assert.equal(h.writes,0);
    assert.match(h.status(),/已停止操作/);
    assert.match(h.notice(),/存档已变化/);
    assert.equal(h.data.get(STORY_WORKSHOP_KEY),'{"external":true}');
    assert.equal(h.data.get(STORY_SAVE_KEY),'story-sentinel');
    assert.equal(h.data.get(SAVE_KEY),'normal-sentinel');
  }finally{h.restore();}
});

test('P70 ordinary hidden/visible round trip can resume only after snapshot recheck',async()=>{
  const h=await mount();
  try{
    h.document.visibilityState='hidden';
    await h.document.emit('visibilitychange');
    await h.reset();
    assert.equal(h.writes,0);
    h.document.visibilityState='visible';
    await h.document.emit('visibilitychange');
    await h.reset();
    assert.equal(h.writes,1);
    assert.match(h.notice(),/^已重置剧情工作台/);
  }finally{h.restore();}
});

test('P70 pending Web Lock reset is cancelled by pagehide without a second write',async()=>{
  let release;
  const h=await mount({makeLocks:()=>({
    request(_name,_options,callback){
      return new Promise(resolve=>{
        release=async()=>resolve(await callback());
      });
    }
  })});
  try{
    const pending=h.reset();
    assert.equal(typeof release,'function','the reset must be waiting for a lock');
    await h.window.emit('pagehide');
    await release();
    await pending;
    assert.equal(h.writes,0);
    assert.match(h.notice(),/重置操作的最终状态无法确认/);
    assert.equal(h.data.has(STORY_WORKSHOP_KEY),false);
    assert.equal(h.data.get(SAVE_KEY),'normal-sentinel');
  }finally{h.restore();}
});


test('P82 workshop reset refuses consent after pagehide without any write',async()=>{
  const h=await mount();
  try{
    let calls=0;
    h.window.confirm=()=>{calls++;h.window.emit('pagehide');return true;};
    await h.reset();
    assert.equal(calls,1);
    assert.equal(h.writes,0);
    assert.equal(h.data.has(STORY_WORKSHOP_KEY),false);
    assert.equal(h.data.get(SAVE_KEY),'normal-sentinel');
  }finally{h.restore();}
});

test('P82 corrupt workshop export rejects pagehide during native consent',async()=>{
  const h=await mount({corruptWorkshop:true});
  try{
    h.window.confirm=()=>{h.window.emit('pagehide');return true;};
    await h.document.getElementById('export-corrupt-workshop').fire('click');
    assert.equal(h.writes,0);
    assert.equal(h.data.get(STORY_WORKSHOP_KEY),'{broken');
    assert.equal(h.data.get(SAVE_KEY),'normal-sentinel');
  }finally{h.restore();}
});

// A visibilityState change can be observable before the browser delivers
// visibilitychange. This is a Node timing injection, not a mobile device test.
test('P84 reset committed before a delayed hidden event cannot announce success',async()=>{
  const h=await mount({makeLocks:()=>({
    async request(_name,_options,callback){
      const result=await callback();
      globalThis.document.visibilityState='hidden';
      return result;
    }
  })});
  try{
    await h.reset();
    assert.equal(h.writes,1,'the write may already have happened');
    assert.match(h.notice(),/重置后的存档状态无法确认/);
    assert.doesNotMatch(h.notice(),/^已重置剧情工作台/);
    assert.match(h.status(),/已停止操作/);
    assert.equal(h.data.get(STORY_SAVE_KEY),'story-sentinel');
    assert.equal(h.data.get(SAVE_KEY),'normal-sentinel');
    h.document.visibilityState='visible';
    await h.document.emit('visibilitychange');
    assert.equal(h.writes,1,'resuming must not automatically replay reset');
  }finally{h.restore();}
});
