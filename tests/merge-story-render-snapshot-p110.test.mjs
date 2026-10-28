import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmptyStoryProgress,STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry} from '../merge/story/runtime.mjs';
import {createInitialState,fulfillOrder} from '../merge/engine.mjs';

// Real story UI module, deterministic DOM/storage fault injection.
// This is not a browser emulator and does not prove cross-tab atomicity.
let serial=0;
async function mount(){
  let progress=startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK);
  for(const id of ['arrival','signboard']){
    const entry=CORE_STORY_PACK.entries.find(e=>e.id===id);
    progress=completeStoryEntry(progress,CORE_STORY_PACK,id,entry.choices[0]?.id??null);
  }
  const workshop=createInitialState(20261029);
  const data=new Map([
    [STORY_SAVE_KEY,JSON.stringify(progress)],
    [STORY_WORKSHOP_KEY,JSON.stringify(workshop)],
    [SAVE_KEY,'normal-mode-unchanged']
  ]);
  const writes=[];
  let workshopReads=0,afterRead=null;
  const storage={
    getItem(key){
      const value=data.has(key)?data.get(key):null;
      if(key===STORY_WORKSHOP_KEY){
        workshopReads++;
        if(afterRead){const callback=afterRead;afterRead=null;callback(data);}
      }
      return value;
    },
    setItem(key,value){writes.push(key);data.set(key,value);}
  };
  class Node {
    constructor(){
      this.children=[];this.listeners=new Map();this.textContent='';
      this.dataset={};this.style={};this.className='';this.id='';
      this.hidden=false;this.disabled=false;this.open=false;
    }
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=[...children];}
    setAttribute(){}
    querySelector(selector){
      if(selector==='.story-card')
        return this.children.find(child=>child.className==='story-card')??null;
      return null;
    }
    querySelectorAll(){return [];}
    addEventListener(name,fn){
      const listeners=this.listeners.get(name)??[];
      listeners.push(fn);this.listeners.set(name,listeners);
    }
    fire(name,event={}){for(const fn of this.listeners.get(name)??[])fn(event);}
    focus(){}
    scrollIntoView(){}
    showModal(){this.open=true;}
    close(){this.open=false;}
  }
  const nodes=new Map(),winEvents=new Node(),docEvents=new Node();
  const document={
    visibilityState:'visible',
    getElementById(id){
      if(!nodes.has(id))nodes.set(id,new Node());
      return nodes.get(id);
    },
    querySelectorAll(){return [];},
    createElement(){return new Node();},
    addEventListener:(...args)=>docEvents.addEventListener(...args),
    body:new Node()
  };
  const window={
    localStorage:storage,
    navigator:{locks:{request:async(_name,_opts,callback)=>callback()}},
    location:{hash:''},setInterval(){},setTimeout(){},requestAnimationFrame(){},
    addEventListener:(...args)=>winEvents.addEventListener(...args),
    emit:(...args)=>winEvents.fire(...args)
  };
  const oldWindow=globalThis.window,oldDocument=globalThis.document;
  globalThis.window=window;globalThis.document=document;
  try{
    await import(new URL('../merge/story/ui.mjs?render-p110='+ ++serial,import.meta.url));
    await new Promise(resolve=>setImmediate(resolve));
  }catch(error){
    globalThis.window=oldWindow;globalThis.document=oldDocument;
    throw error;
  }
  return {
    data,writes,window,workshop,
    get reads(){return workshopReads;},
    resetReads(){workshopReads=0;},
    onWorkshopRead(fn){afterRead=fn;},
    redraw(){window.emit('hashchange');},
    element:id=>document.getElementById(id),
    restore(){globalThis.window=oldWindow;globalThis.document=oldDocument;}
  };
}
function firstOrderCard(h){
  const card=h.element('story-list').children.find(node=>node.id==='story-first-order');
  assert.ok(card,'first-order card should be available after signboard');
  return card;
}
function cardStatus(h){return firstOrderCard(h).children[0].children[1].textContent;}

test('P110 one render uses one workshop snapshot for chapter hint and gated story card',async()=>{
  const h=await mount();
  try{
    const fulfilled=fulfillOrder(h.workshop,h.workshop.orders[0].id);
    assert.equal(fulfilled.ok,true);
    const newer=JSON.stringify(fulfilled.state);
    h.resetReads();
    // Peer update is not accompanied by a StorageEvent. The first read returns
    // the old bytes; any second read in the same render would see the new save.
    h.onWorkshopRead(data=>data.set(STORY_WORKSHOP_KEY,newer));
    h.redraw();
    assert.equal(h.reads,1,'one render must not mix two workshop generations');
    assert.match(h.element('journey-guidance').textContent,/完成一笔街坊委托/);
    assert.equal(cardStatus(h),'待完成经营目标');
    assert.equal(h.data.get(STORY_WORKSHOP_KEY),newer);
    assert.equal(h.writes.includes(STORY_WORKSHOP_KEY),false);
    assert.equal(h.data.get(SAVE_KEY),'normal-mode-unchanged');

    // A new render sees the updated goal consistently; it never grants it.
    h.resetReads();h.redraw();
    assert.equal(h.reads,1);
    assert.match(h.element('journey-guidance').textContent,/下一步：继续/);
    assert.equal(cardStatus(h),'经营已达标');
    assert.equal(h.writes.includes(STORY_WORKSHOP_KEY),false);
  }finally{h.restore();}
});

test('P110 corrupt workshop cannot yield a completed chapter in any render surface',async()=>{
  const h=await mount();
  try{
    const storyBefore=h.data.get(STORY_SAVE_KEY);
    const corrupt='{"broken":';
    h.data.set(STORY_WORKSHOP_KEY,corrupt);
    h.resetReads();h.redraw();
    assert.equal(h.reads,1);
    assert.equal(cardStatus(h),'工作台需核对');
    assert.match(h.element('journey-workshop').textContent,/核对剧情工作台存档/);
    assert.equal(h.element('journey-read').hidden,true);
    assert.equal(h.data.get(STORY_WORKSHOP_KEY),corrupt);
    assert.equal(h.data.get(STORY_SAVE_KEY),storyBefore);
    assert.equal(h.data.get(SAVE_KEY),'normal-mode-unchanged');
    assert.equal(h.writes.includes(STORY_WORKSHOP_KEY),false);
  }finally{h.restore();}
});


test('P111 nested workshop StorageEvent cannot repaint a stale locked chapter over a newer render',async()=>{
  const h=await mount();
  try{
    const fulfilled=fulfillOrder(h.workshop,h.workshop.orders[0].id);
    assert.equal(fulfilled.ok,true);
    const newer=JSON.stringify(fulfilled.state);
    h.resetReads();
    h.onWorkshopRead(data=>{
      data.set(STORY_WORKSHOP_KEY,newer);
      h.window.emit('storage',{key:STORY_WORKSHOP_KEY,storageArea:h.window.localStorage});
    });
    h.redraw();
    assert.equal(h.reads,2,'one nested render must replace the interrupted frame');
    assert.equal(cardStatus(h),'经营已达标');
    assert.match(h.element('journey-guidance').textContent,/下一步：继续/);
    assert.equal(h.element('journey-read').hidden,false);
    assert.equal(h.data.get(STORY_WORKSHOP_KEY),newer);
    assert.equal(h.writes.length,0,'cross-tab refresh cannot write either save');
    assert.equal(h.data.get(SAVE_KEY),'normal-mode-unchanged');
  }finally{h.restore();}
});
