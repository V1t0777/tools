import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmptyStoryProgress,STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory} from '../merge/story/runtime.mjs';
import {STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {readFileSync} from 'node:fs';

// Exercises the real story UI and Web Lock callback, not an iPhone emulator.
let sequence=0;
async function mount({makeLocks}={}){
  const original=JSON.stringify(startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK));
  const data=new Map([[STORY_SAVE_KEY,original],[SAVE_KEY,'normal-sentinel'],
    [STORY_WORKSHOP_KEY,'workshop-sentinel']]);
  const writes=[];
  const storage={
    getItem(key){return data.has(key)?data.get(key):null;},
    setItem(key,value){writes.push(key);data.set(key,value);}
  };
  class Node {
    constructor(){
      this.textContent='';this.style={};this.dataset={};this.children=[];
      this.disabled=false;this.hidden=false;this.open=false;this.listeners=new Map();
    }
    setAttribute(){}
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(...nodes){this.children=[...nodes];}
    remove(){}
    querySelector(){return null;}
    querySelectorAll(){return [];}
    focus(){}
    scrollIntoView(){}
    showModal(){this.open=true;}
    close(){this.open=false;}
    addEventListener(type,fn){
      const list=this.listeners.get(type)??[];
      list.push(fn);this.listeners.set(type,list);
    }
    async fire(type,event={}){
      for(const fn of this.listeners.get(type)??[])
        await fn({type,target:this,...event});
    }
  }
  const elements=new Map(),docEvents=new Node(),winEvents=new Node();
  const document={
    visibilityState:'visible',
    getElementById(id){
      if(!elements.has(id))elements.set(id,new Node());
      return elements.get(id);
    },
    querySelectorAll(){return [];},
    createElement(){return new Node();},
    addEventListener:(...args)=>docEvents.addEventListener(...args),
    emit:(...args)=>docEvents.fire(...args),
    body:new Node()
  };
  const window={
    localStorage:storage,navigator:{locks:makeLocks?makeLocks(data):null},
    location:{hash:''},confirm:()=>true,setInterval(){},setTimeout(){},
    requestAnimationFrame(){},
    addEventListener:(...args)=>winEvents.addEventListener(...args),
    emit:(...args)=>winEvents.fire(...args)
  };
  const oldWindow=globalThis.window,oldDocument=globalThis.document;
  globalThis.window=window;globalThis.document=document;
  try{
    await import(new URL('../merge/story/ui.mjs?lifecycle-p78='+ ++sequence,import.meta.url));
  }catch(error){
    globalThis.window=oldWindow;globalThis.document=oldDocument;
    throw error;
  }
  return {
    original,data,writes,window,document,
    reset:()=>document.getElementById('reset-story').fire('click'),
    status:()=>document.getElementById('save-state').textContent,
    restore(){globalThis.window=oldWindow;globalThis.document=oldDocument;}
  };
}

test('P78 pagehide cancels a queued narrative reset before the Web Lock writes',async()=>{
  let release;
  const h=await mount({makeLocks:()=>({
    request(_name,_options,callback){
      return new Promise(resolve=>{release=async()=>resolve(await callback());});
    }
  })});
  try{
    const pending=h.reset();
    assert.equal(typeof release,'function');
    await h.window.emit('pagehide');
    assert.equal(h.document.getElementById('reset-story').disabled,true);
    await release();
    await pending;
    assert.deepEqual(h.writes,[]);
    assert.equal(h.data.get(STORY_SAVE_KEY),h.original);
    assert.equal(h.data.get(SAVE_KEY),'normal-sentinel');
    assert.equal(h.data.get(STORY_WORKSHOP_KEY),'workshop-sentinel');
    assert.match(h.status(),/重新打开页面核对进度/);
  }finally{h.restore();}
});

test('P78 hidden pageshow and visibility alone cannot revive a pagehide reset',async()=>{
  const h=await mount();
  try{
    await h.window.emit('pagehide');
    h.document.visibilityState='hidden';
    await h.document.emit('visibilitychange');
    await h.reset();
    await h.window.emit('pageshow',{persisted:true});
    await h.reset();
    assert.deepEqual(h.writes,[]);
    assert.equal(h.document.getElementById('reset-story').disabled,true);
    h.document.visibilityState='visible';
    await h.document.emit('visibilitychange');
    await h.reset();
    assert.equal(h.writes.length,1,'visible resume must verify before a new reset');
    assert.equal(h.writes[0],STORY_SAVE_KEY);
    assert.equal(h.data.get(SAVE_KEY),'normal-sentinel');
  }finally{h.restore();}
});

test('P78 changed story save during BFCache blocks old reset and preserves other modes',async()=>{
  const h=await mount();
  try{
    await h.window.emit('pagehide');
    h.data.set(STORY_SAVE_KEY,'{peer-changed-while-hidden');
    await h.window.emit('pageshow',{persisted:true});
    await h.reset();
    assert.deepEqual(h.writes,[]);
    assert.equal(h.data.get(STORY_SAVE_KEY),'{peer-changed-while-hidden');
    assert.match(h.status(),/重新打开页面核对进度/);
    assert.equal(h.data.get(SAVE_KEY),'normal-sentinel');
    assert.equal(h.data.get(STORY_WORKSHOP_KEY),'workshop-sentinel');
  }finally{h.restore();}
});

test('P78 ordinary hidden/visible return rechecks unchanged story before reset',async()=>{
  const h=await mount();
  try{
    h.document.visibilityState='hidden';
    await h.document.emit('visibilitychange');
    await h.reset();
    assert.deepEqual(h.writes,[]);
    h.document.visibilityState='visible';
    await h.document.emit('visibilitychange');
    await h.reset();
    assert.deepEqual(h.writes,[STORY_SAVE_KEY]);
    assert.equal(h.data.get(SAVE_KEY),'normal-sentinel');
    assert.equal(h.data.get(STORY_WORKSHOP_KEY),'workshop-sentinel');
  }finally{h.restore();}
});

test('P78 lifecycle contract suspends story writes, daily pin and damaged export',()=>{
  const ui=readFileSync(new URL('../merge/story/ui.mjs',import.meta.url),'utf8');
  assert.ok(ui.includes("window.addEventListener('pagehide',()=>suspendStoryPage({gone:true}))"));
  assert.ok(ui.includes('storageEpoch++; // invalidate every pending story Web Lock callback'));
  assert.ok(ui.includes('isCurrent:()=>storageEpoch===expectedEpoch&&(!blocked||reset)'));
  assert.ok(ui.includes('commitGuard=()=>!pageSuspended()&&originalCommitGuard()'));
  assert.ok(ui.includes('if(!blocked&&!saving&&!pageSuspended()&&!pinQueued'));
  assert.ok(ui.includes("if(saving||pageSuspended()||reason!=='CORRUPT_SAVE'"));
  assert.ok(ui.includes("if(document.visibilityState==='hidden'||(pageGone&&!resumePending))return;"));
  assert.equal(ui.includes('innerHTML'),false);
});
