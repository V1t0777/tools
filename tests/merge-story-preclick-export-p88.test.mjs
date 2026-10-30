import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {STORY_WORKSHOP_KEY} from '../merge/story/workshop-storage.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';

// Real story entry modules with a minimal event-capable DOM and a synchronous
// append-time fault. This is not an iPhone Safari / WeChat WebView emulator.
let sequence=0;
async function mount(kind,onAppend){
  const target=kind==='dialogue'?STORY_SAVE_KEY:STORY_WORKSHOP_KEY;
  const raw=kind==='dialogue'?'{broken-dialogue':
    '{broken-workshop'+String.fromCharCode(0xD800);
  const other=kind==='dialogue'?STORY_WORKSHOP_KEY:STORY_SAVE_KEY;
  const otherRaw='{other-story-save';
  const data=new Map([[target,raw],[other,otherRaw],[SAVE_KEY,'normal-sentinel']]);
  const writes=[];
  const storage={
    getItem:key=>data.has(key)?data.get(key):null,
    setItem(key,value){writes.push(key);data.set(key,value);}
  };
  class Node {
    constructor(){
      this.textContent='';this.style={};this.dataset={};this.children=[];
      this.disabled=false;this.hidden=false;this.open=false;this.listeners=new Map();
    }
    setAttribute(){}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=[...children];}
    remove(){}
    querySelector(){return null;}
    querySelectorAll(){return [];}
    focus(){}
    scrollIntoView(){}
    showModal(){this.open=true;}
    close(){this.open=false;}
    addEventListener(type,fn){
      const callbacks=this.listeners.get(type)??[];
      callbacks.push(fn);this.listeners.set(type,callbacks);
    }
    async fire(type,event={}){
      for(const fn of this.listeners.get(type)??[])
        await fn({type,target:this,...event});
    }
  }
  const elements=new Map(),docEvents=new Node(),winEvents=new Node();
  let clicks=0,revokes=0,allocations=0,appends=0;
  const blobs=[],filenames=[];
  const document={
    visibilityState:'visible',
    getElementById(id){
      if(!elements.has(id))elements.set(id,new Node());
      return elements.get(id);
    },
    querySelectorAll(){return [];},
    createElement(tag){
      const el=new Node();
      if(tag==='a')el.click=()=>{clicks++;filenames.push(el.download);};
      return el;
    },
    createDocumentFragment(){return new Node();},
    addEventListener:(...args)=>docEvents.addEventListener(...args),
    body:new Node()
  };
  const window={
    localStorage:storage,navigator:{locks:null},location:{hash:''},
    confirm(){return true;},setTimeout(){},setInterval(){},requestAnimationFrame(){},
    addEventListener:(...args)=>winEvents.addEventListener(...args)
  };
  document.body.append=el=>{
    appends++;
    if(onAppend)onAppend({data,target,document,window,el});
  };
  const priorWindow=globalThis.window,priorDocument=globalThis.document;
  const priorUrl=globalThis.URL,priorTimer=globalThis.setTimeout;
  globalThis.window=window;globalThis.document=document;
  try{
    const modulePath=kind==='dialogue'?'../merge/story/ui.mjs':
      '../merge/story/workshop.mjs';
    await import(new URL(modulePath+'?preclick-p88='+ ++sequence,import.meta.url));
  }catch(error){
    globalThis.window=priorWindow;globalThis.document=priorDocument;
    throw error;
  }
  globalThis.URL={
    createObjectURL(blob){allocations++;blobs.push(blob);return 'blob:story-p88-'+allocations;},
    revokeObjectURL(){revokes++;}
  };
  // Avoid a 120-second live timer in the Node harness; never run cleanup early.
  globalThis.setTimeout=()=>0;
  return {
    target,raw,other,otherRaw,data,writes,document,window,blobs,filenames,
    get clicks(){return clicks;},
    get revokes(){return revokes;},
    get allocations(){return allocations;},
    get appends(){return appends;},
    notice:()=>document.getElementById(kind==='dialogue'?'save-state':'board-notice').textContent,
    export:()=>document.getElementById(kind==='dialogue'?'export-corrupt-story':'export-corrupt-workshop').fire('click'),
    restore(){
      globalThis.window=priorWindow;globalThis.document=priorDocument;
      globalThis.URL=priorUrl;globalThis.setTimeout=priorTimer;
    }
  };
}

for(const kind of ['dialogue','workshop']){
  test('P88 '+kind+' refuses an append-time cross-tab overwrite before native click',async()=>{
    const h=await mount(kind,({data,target})=>data.set(target,'{peer-updated'));
    try{
      await h.export();
      assert.equal(h.appends,1);
      assert.equal(h.allocations,1);
      assert.equal(h.clicks,0,'native download must not start');
      assert.equal(h.revokes,1,'rejected Blob URL must be revoked');
      assert.match(h.notice(),/下载发起前已变化/);
      assert.deepEqual(h.writes,[],'evidence export is read-only');
      assert.equal(h.data.get(h.target),'{peer-updated');
      assert.equal(h.data.get(h.other),h.otherRaw);
      assert.equal(h.data.get(SAVE_KEY),'normal-sentinel');
    }finally{h.restore();}
  });

  test('P88 '+kind+' refuses a hidden page during DOM append',async()=>{
    const h=await mount(kind,({document})=>{document.visibilityState='hidden';});
    try{
      await h.export();
      assert.equal(h.clicks,0);
      assert.equal(h.revokes,1);
      assert.match(h.notice(),/页面暂停/);
      assert.equal(h.data.get(h.target),h.raw);
      assert.deepEqual(h.writes,[]);
    }finally{h.restore();}
  });

  test('P88 '+kind+' unchanged source requests a reversible offline download',async()=>{
    const h=await mount(kind);
    try{
      await h.export();
      assert.equal(h.clicks,1);
      assert.equal(h.revokes,0,'Blob URL must outlive requested click');
      assert.match(h.notice(),/已尝试下载/);
      assert.equal(h.data.get(h.target),h.raw);
      assert.equal(h.data.get(SAVE_KEY),'normal-sentinel');
      assert.deepEqual(h.writes,[]);
      if(kind==='workshop'){
        assert.match(h.filenames[0],/\.utf16\.json$/);
        const wrapped=JSON.parse(await h.blobs[0].text());
        assert.equal(wrapped.raw,h.raw);
      }else{
        assert.match(h.filenames[0],/\.txt$/);
        assert.equal(await h.blobs[0].text(),h.raw);
      }
    }finally{h.restore();}
  });
}

test('P88 both actual story entry modules pass pre-click authorization to shared downloader',()=>{
  for(const path of ['../merge/story/ui.mjs','../merge/story/workshop.mjs']){
    const source=readFileSync(new URL(path,import.meta.url),'utf8');
    assert.ok(source.includes('authorizeClick:()=>!saving&&!pageSuspended()&&storageEpoch===confirmationEpoch'),path);
    assert.ok(source.includes("receipt.reason==='DOWNLOAD_SOURCE_CHANGED'"),path);
    assert.ok(source.includes('isPreparedStoryEvidenceCurrent('),path);
    assert.ok(!source.includes('localStorage.setItem'),path);
  }
});
