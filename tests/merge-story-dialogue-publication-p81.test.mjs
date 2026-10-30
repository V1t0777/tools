import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyStoryDialoguePublication} from '../merge/story/dialogue-publication-guard.mjs';
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../merge/mode-boundaries.mjs';
import {STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory} from '../merge/story/runtime.mjs';

const initial=()=>JSON.stringify(startCoreStory(createEmptyStoryProgress(),CORE_STORY_PACK));
function store(raw){
  const data=new Map([[STORY_SAVE_KEY,raw],[STORY_WORKSHOP_KEY,'workshop-sentinel'],
    [SAVE_KEY,'normal-sentinel']]);
  return {data,getItem:key=>data.has(key)?data.get(key):null,
    setItem:(key,value)=>data.set(key,value)};
}

test('P81 publication requires exact current story bytes and intact lifecycle epoch',()=>{
  const raw=initial(),storage=store(raw);
  const options={expectedRaw:raw,expectedEpoch:3,currentEpoch:3,suspended:false};
  assert.deepEqual(verifyStoryDialoguePublication(storage,options),{ok:true,reason:null});
  storage.data.set(STORY_SAVE_KEY,JSON.stringify({...JSON.parse(raw),revision:99}));
  assert.deepEqual(verifyStoryDialoguePublication(storage,options),
    {ok:false,reason:'WRITE_CONFLICT'});
  assert.equal(storage.getItem(SAVE_KEY),'normal-sentinel');
  assert.equal(storage.getItem(STORY_WORKSHOP_KEY),'workshop-sentinel');
});

test('P81 stale epoch, suspended page and invalid storage fail closed',()=>{
  const raw=initial(),storage=store(raw);
  const base={expectedRaw:raw,expectedEpoch:4,currentEpoch:4};
  assert.equal(verifyStoryDialoguePublication(storage,{...base,currentEpoch:5}).reason,'WRITE_CONFLICT');
  assert.equal(verifyStoryDialoguePublication(storage,{...base,suspended:true}).reason,'WRITE_CONFLICT');
  assert.equal(verifyStoryDialoguePublication(storage,{...base,expectedRaw:null}).reason,'INVALID_SNAPSHOT');
  assert.equal(verifyStoryDialoguePublication(storage,{...base,currentEpoch:1.5}).reason,'INVALID_EPOCH');
  assert.equal(verifyStoryDialoguePublication({getItem(){throw Error('denied');}},base).reason,
    'STORAGE_UNAVAILABLE');
});

let sequence=0;
async function mount({replaceAfterLock=false,corruptStory=false}={}){
  const original=corruptStory?'{broken':initial();
  const peer=corruptStory?null:JSON.stringify({...JSON.parse(original),revision:50});
  const storage=store(original),writes=[];
  const set=storage.setItem;
  storage.setItem=(key,value)=>{writes.push(key);set(key,value);};
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
      const list=this.listeners.get(type)??[];list.push(fn);this.listeners.set(type,list);
    }
    async fire(type,event={}){
      for(const fn of this.listeners.get(type)??[])await fn({type,target:this,...event});
    }
  }
  const elements=new Map(),docEvents=new Node(),winEvents=new Node();
  const document={
    visibilityState:'visible',
    getElementById(id){if(!elements.has(id))elements.set(id,new Node());return elements.get(id);},
    querySelectorAll(){return [];},createElement(){return new Node();},
    addEventListener:(...args)=>docEvents.addEventListener(...args),body:new Node()
  };
  const locks={request(_name,_options,callback){
    return Promise.resolve().then(async()=>{
      const value=await callback({name:_name,mode:'exclusive'});
      // Simulate another participating tab committing after lock release
      // but before the waiting story page resumes from await.
      if(replaceAfterLock&&value===true)storage.data.set(STORY_SAVE_KEY,peer);
      return value;
    });
  }};
  const window={
    localStorage:storage,navigator:{locks},location:{hash:''},
    confirm:()=>true,setInterval(){},setTimeout(){},requestAnimationFrame(){},
    addEventListener:(...args)=>winEvents.addEventListener(...args),
    emit:(...args)=>winEvents.fire(...args)
  };
  const oldWindow=globalThis.window,oldDocument=globalThis.document;
  globalThis.window=window;globalThis.document=document;
  try{
    await import(new URL('../merge/story/ui.mjs?publication-p81='+ ++sequence,import.meta.url));
  }catch(error){
    globalThis.window=oldWindow;globalThis.document=oldDocument;throw error;
  }
  return {
    storage,original,peer,writes,window,document,
    reset:()=>document.getElementById('reset-story').fire('click'),
    status:()=>document.getElementById('save-state').textContent,
    restore(){globalThis.window=oldWindow;globalThis.document=oldDocument;}
  };
}

test('P81 story UI refuses success when peer replaces committed reset after lock',async()=>{
  const h=await mount({replaceAfterLock:true});
  try{
    await h.reset();
    assert.equal(h.storage.getItem(STORY_SAVE_KEY),h.peer);
    assert.deepEqual(h.writes,[STORY_SAVE_KEY]);
    assert.match(h.status(),/存档已被其他标签页改动或写入失败/);
    assert.equal(h.storage.getItem(SAVE_KEY),'normal-sentinel');
    assert.equal(h.storage.getItem(STORY_WORKSHOP_KEY),'workshop-sentinel');
  }finally{h.restore();}
});

test('P81 unchanged story reset publishes normally and leaves other modes intact',async()=>{
  const h=await mount();
  try{
    await h.reset();
    assert.deepEqual(h.writes,[STORY_SAVE_KEY]);
    assert.notEqual(h.storage.getItem(STORY_SAVE_KEY),h.original);
    assert.match(h.status(),/剧情进度已保存/);
    assert.equal(h.storage.getItem(SAVE_KEY),'normal-sentinel');
    assert.equal(h.storage.getItem(STORY_WORKSHOP_KEY),'workshop-sentinel');
  }finally{h.restore();}
});


test('P82 dialogue reset refuses consent after pagehide without any write',async()=>{
  const h=await mount();
  try{
    let calls=0;
    h.window.confirm=()=>{calls++;h.window.emit('pagehide');return true;};
    await h.reset();
    assert.equal(calls,1);
    assert.deepEqual(h.writes,[]);
    assert.equal(h.storage.getItem(STORY_SAVE_KEY),h.original);
    assert.equal(h.storage.getItem(SAVE_KEY),'normal-sentinel');
  }finally{h.restore();}
});

test('P82 corrupt dialogue export rejects pagehide during native consent',async()=>{
  const h=await mount({corruptStory:true});
  try{
    h.window.confirm=()=>{h.window.emit('pagehide');return true;};
    await h.document.getElementById('export-corrupt-story').fire('click');
    assert.deepEqual(h.writes,[]);
    assert.equal(h.storage.getItem(STORY_SAVE_KEY),'{broken');
    assert.equal(h.storage.getItem(STORY_WORKSHOP_KEY),'workshop-sentinel');
  }finally{h.restore();}
});
