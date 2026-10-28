import test from 'node:test';
import assert from 'node:assert/strict';
import {STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory} from '../merge/story/runtime.mjs';
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
      const dispatched={type,target:this,defaultPrevented:false,
        preventDefault(){this.defaultPrevented=true;},
        stopImmediatePropagation(){this.immediateStopped=true;},...event};
      for(const callback of this.listeners.get(type)??[]){
        // Synchronous capture listeners must not insert a microtask gap
        // before the original async click handler begins acquiring its lock.
        const result=callback(dispatched);
        if(dispatched.immediateStopped)break;
        if(result&&typeof result.then==='function')await result;
      }
      return dispatched;
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

test('P99 workshop BFCache resume rejects pagehide during an unchanged storage read',async()=>{
  const h=await mount();
  try{
    await h.window.emit('pagehide');
    const original=h.window.localStorage.getItem.bind(h.window.localStorage);
    let injected=false;
    h.window.localStorage.getItem=key=>{
      const value=original(key);
      if(key===STORY_WORKSHOP_KEY&&!injected){
        injected=true;
        h.window.emit('pagehide');
      }
      return value;
    };
    await h.window.emit('pageshow',{persisted:true});
    assert.equal(injected,true);
    assert.equal(h.document.getElementById('reset-workshop').disabled,true);
    await h.reset();
    assert.equal(h.writes,0);
    assert.equal(h.data.has(STORY_WORKSHOP_KEY),false);
    h.window.localStorage.getItem=original;
    await h.window.emit('pageshow',{persisted:true});
    await h.reset();
    assert.equal(h.writes,1);
    assert.equal(h.data.get(SAVE_KEY),'normal-sentinel');
    assert.equal(h.data.get(STORY_SAVE_KEY),'story-sentinel');
  }finally{h.restore();}
});


test('P100 workshop reset refuses a peer replacement during native confirmation',async()=>{
  const h=await mount();
  try{
    let confirms=0;
    h.window.confirm=()=>{
      confirms++;
      h.data.set(STORY_WORKSHOP_KEY,'{"peer":"new-workshop-save"}');
      return true;
    };
    await h.reset();
    assert.equal(confirms,1);
    assert.equal(h.writes,0);
    assert.equal(h.data.get(STORY_WORKSHOP_KEY),'{"peer":"new-workshop-save"}');
    assert.equal(h.data.get(STORY_SAVE_KEY),'story-sentinel');
    assert.equal(h.data.get(SAVE_KEY),'normal-sentinel');
    assert.match(h.notice(),/确认期间工作台存档发生变化/);
  }finally{h.restore();}
});

test('P100 workshop reset preserves an independent peer narrative update',async()=>{
  const h=await mount();
  try{
    h.window.confirm=()=>{
      h.data.set(STORY_SAVE_KEY,'peer-story-updated');
      return true;
    };
    await h.reset();
    assert.equal(h.writes,1);
    assert.match(h.notice(),/^已重置剧情工作台/);
    assert.equal(h.data.get(STORY_SAVE_KEY),'peer-story-updated');
    assert.equal(h.data.get(SAVE_KEY),'normal-sentinel');
    assert.equal(typeof h.data.get(STORY_WORKSHOP_KEY),'string');
  }finally{h.restore();}
});

// A browser may deliver pagehide/visibilitychange synchronously while a
// prerequisite localStorage.getItem() runs. The real DOM must not re-enable
// stale board controls after the nested suspension render has completed.
async function checkNarrativeReadSuspension(kind){
  const h=await mount();
  try{
    const progress=startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);
    h.data.set(STORY_SAVE_KEY,JSON.stringify(progress));
    await h.window.emit('storage',{key:STORY_SAVE_KEY,storageArea:h.window.localStorage});
    const link=h.document.getElementById('workshop-next-action');
    assert.equal(link.hidden,false,'valid story should initially offer a route');
    const original=h.window.localStorage.getItem.bind(h.window.localStorage);
    let injected=false;
    h.window.localStorage.getItem=key=>{
      const value=original(key);
      if(key===STORY_SAVE_KEY&&!injected){
        injected=true;
        if(kind==='pagehide')void h.window.emit('pagehide');
        else{
          h.document.visibilityState='hidden';
          void h.document.emit('visibilitychange');
        }
      }
      return value;
    };
    await h.window.emit('storage',{key:STORY_SAVE_KEY,storageArea:h.window.localStorage});
    assert.equal(injected,true,'fault must run inside narrative getItem');
    assert.equal(link.hidden,true,'suspended page cannot advertise navigation');
    assert.equal(h.document.getElementById('reset-workshop').disabled,true);
    const board=h.document.getElementById('workshop-board').children[0];
    assert.equal(board.children.length,56);
    assert.equal(board.children.every(cell=>cell.disabled),true,
      'all rendered board cells must remain disabled after nested page suspension');
    assert.equal(h.writes,0);
    assert.equal(h.data.get(SAVE_KEY),'normal-sentinel');
    h.window.localStorage.getItem=original;
    if(kind==='pagehide')await h.window.emit('pageshow',{persisted:true});
    else{
      h.document.visibilityState='visible';
      await h.document.emit('visibilitychange');
    }
    assert.equal(link.hidden,false,'visible, rechecked return restores read-only route');
    assert.equal(h.document.getElementById('reset-workshop').disabled,false);
    assert.equal(h.writes,0,'resuming must never write a save automatically');
  }finally{h.restore();}
}

test('P104 workshop route and board remain suspended if story read triggers pagehide',async()=>{
  await checkNarrativeReadSuspension('pagehide');
});

test('P104 workshop route and board remain suspended if story read hides page',async()=>{
  await checkNarrativeReadSuspension('hidden');
});


test('P107 BFCache cancels reset pointer pressed before pagehide; fresh pointer still works',async()=>{
  const h=await mount();
  try{
    const reset=h.document.getElementById('reset-workshop');
    let confirmations=0;
    h.window.confirm=()=>{confirmations++;return true;};
    await reset.fire('pointerdown',{pointerId:107});
    await h.window.emit('pagehide');
    await h.window.emit('pageshow',{persisted:true});
    const oldClick=await reset.fire('click',{detail:1});
    assert.equal(oldClick.defaultPrevented,true);
    assert.equal(confirmations,0,'old gesture must not open native destructive confirmation');
    assert.equal(h.writes,0);
    assert.match(h.notice(),/旧触控已取消/);
    await reset.fire('pointerdown',{pointerId:108});
    await reset.fire('click',{detail:1});
    assert.equal(confirmations,1);
    assert.equal(h.writes,1,'fresh gesture may reset with confirmation');
    assert.equal(h.data.get(STORY_SAVE_KEY),'story-sentinel');
    assert.equal(h.data.get(SAVE_KEY),'normal-sentinel');
  }finally{h.restore();}
});

test('P107 pointercancel cannot trigger a delayed reset; fresh keyboard activation is independent',async()=>{
  const h=await mount();
  try{
    const reset=h.document.getElementById('reset-workshop');
    let confirmations=0;
    h.window.confirm=()=>{confirmations++;return true;};
    await reset.fire('pointerdown',{pointerId:109});
    await reset.fire('pointercancel',{pointerId:109});
    const cancelled=await reset.fire('click',{detail:1});
    assert.equal(cancelled.defaultPrevented,true);
    assert.equal(confirmations,0);
    assert.equal(h.writes,0);
    await reset.fire('click',{detail:0});
    assert.equal(confirmations,1,'keyboard click is a new deliberate action');
    assert.equal(h.writes,1);
    assert.equal(h.data.get(SAVE_KEY),'normal-sentinel');
  }finally{h.restore();}
});

test('P107 expired BFCache pointer cannot launch corrupt-save export or old story navigation',async()=>{
  const h=await mount({corruptWorkshop:true});
  try{
    let confirmations=0;
    h.window.confirm=()=>{confirmations++;return true;};
    const exportButton=h.document.getElementById('export-corrupt-workshop');
    const route=h.document.getElementById('workshop-next-action');
    await exportButton.fire('pointerdown',{pointerId:110});
    await route.fire('pointerdown',{pointerId:111});
    await h.window.emit('pagehide');
    await h.window.emit('pageshow',{persisted:true});
    const oldExport=await exportButton.fire('click',{detail:1});
    const oldRoute=await route.fire('click',{detail:1});
    assert.equal(oldExport.defaultPrevented,true);
    assert.equal(oldRoute.defaultPrevented,true);
    assert.equal(confirmations,0);
    assert.equal(h.writes,0);
    assert.equal(h.data.get(STORY_WORKSHOP_KEY),'{broken');
    assert.equal(h.data.get(STORY_SAVE_KEY),'story-sentinel');
    assert.equal(h.data.get(SAVE_KEY),'normal-sentinel');
  }finally{h.restore();}
});

test('P107 a story-save refresh invalidates a held persistent reset pointer',async()=>{
  const h=await mount();
  try{
    const reset=h.document.getElementById('reset-workshop');
    let confirmations=0;
    h.window.confirm=()=>{confirmations++;return true;};
    await reset.fire('pointerdown',{pointerId:112});
    await h.window.emit('storage',{key:STORY_SAVE_KEY,storageArea:h.window.localStorage});
    const stale=await reset.fire('click',{detail:1});
    assert.equal(stale.defaultPrevented,true);
    assert.equal(confirmations,0);
    assert.equal(h.writes,0);
    await reset.fire('pointerdown',{pointerId:113});
    await reset.fire('click',{detail:1});
    assert.equal(confirmations,1);
    assert.equal(h.writes,1);
    assert.equal(h.data.get(SAVE_KEY),'normal-sentinel');
  }finally{h.restore();}
});
