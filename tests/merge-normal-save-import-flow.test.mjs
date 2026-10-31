import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState} from '../merge/engine.mjs';
import {SAVE_KEY,MAX_LOCAL_SAVE_BYTES} from '../merge/storage.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {performNormalSaveImport,MAX_NORMAL_IMPORT_FILE_BYTES} from '../merge/normal-save-import-flow.mjs';

function fixture(){
  const current=JSON.stringify(createInitialState(1));
  const candidate=JSON.stringify({...createInitialState(1),coins:37,revision:1});
  const map=new Map([[SAVE_KEY,current],[STORY_SAVE_KEY,'story-untouched']]);
  const storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v))};
  const calls=[];
  const runtime={phase:'ready',blocked:false,busy:false,raw:current,
    async restore(text,options){calls.push({text,options});return {ok:true};}};
  const file={size:new TextEncoder().encode(candidate).length,text:async()=>candidate};
  const config={file,storage,runtime,confirm:()=>true,isSuspended:()=>false,
    revalidate:()=>true,getEpoch:()=>0};
  return {current,candidate,map,calls,config};
}
test('P2.65i valid normal file is previewed, confirmed and sent to locked runtime once',async()=>{
  const f=fixture();
  const result=await performNormalSaveImport(f.config);
  assert.equal(result.ok,true);
  assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].options.expectedRaw,f.current);
  assert.equal(f.calls[0].options.confirmed,true);
  assert.equal(f.calls[0].options.allowDowngrade,false);
  assert.equal(f.map.get(SAVE_KEY),f.current,'preflight itself performs no writes');
  assert.equal(f.map.get(STORY_SAVE_KEY),'story-untouched');
});
test('P2.65i cancelled confirmation never reaches restore',async()=>{
  const f=fixture();f.config.confirm=()=>false;
  assert.equal((await performNormalSaveImport(f.config)).reason,'USER_CANCELLED');
  assert.equal(f.calls.length,0);
});
test('P2.65i downgrade requires two distinct confirmations',async()=>{
  const f=fixture();
  const current=JSON.stringify({...createInitialState(1),revision:5});
  f.map.set(SAVE_KEY,current);f.config.runtime.raw=current;
  let count=0;f.config.confirm=()=>++count===1;
  assert.equal((await performNormalSaveImport(f.config)).reason,'DOWNGRADE_CANCELLED');
  assert.equal(count,2);assert.equal(f.calls.length,0);
  f.config.confirm=()=>true;
  assert.equal((await performNormalSaveImport(f.config)).ok,true);
  assert.equal(f.calls[0].options.allowDowngrade,true);
});
test('P2.65i cross-tab change during asynchronous file read never restores',async()=>{
  const f=fixture();let release;
  f.config.file.text=()=>new Promise(resolve=>{release=()=>resolve(f.candidate);});
  const pending=performNormalSaveImport(f.config);
  f.map.set(SAVE_KEY,JSON.stringify({...createInitialState(1),coins:1}));
  release();
  assert.equal((await pending).reason,'CURRENT_SAVE_CHANGED');
  assert.equal(f.calls.length,0);
});
test('P2.65i background and BFCache epoch changes cancel an in-flight file read',async()=>{
  const f=fixture();let release,epoch=0;
  f.config.getEpoch=()=>epoch;
  f.config.file.text=()=>new Promise(resolve=>{release=()=>resolve(f.candidate);});
  const pending=performNormalSaveImport(f.config);
  epoch++;release();
  assert.equal((await pending).reason,'PAGE_SUSPENDED');
  assert.equal(f.calls.length,0);
});
test('P2.65i file size, malformed data and story namespace fail before confirmation',async()=>{
  const f=fixture();let confirms=0;f.config.confirm=()=>{confirms++;return true;};
  f.config.file.size=MAX_NORMAL_IMPORT_FILE_BYTES+1;
  assert.equal((await performNormalSaveImport(f.config)).reason,'FILE_TOO_LARGE');
  f.config.file.size=10;f.config.file.text=async()=>'{bad';
  assert.equal((await performNormalSaveImport(f.config)).reason,'INVALID_JSON');
  f.config.file.text=async()=>JSON.stringify({mode:'story'});
  assert.equal((await performNormalSaveImport(f.config)).reason,'STORY_MODE_FILE');
  f.config.file.text=async()=>('x'.repeat(MAX_LOCAL_SAVE_BYTES+1));
  assert.equal((await performNormalSaveImport(f.config)).reason,'FILE_TOO_LARGE');
  assert.equal(confirms,0);assert.equal(f.calls.length,0);
});
test('P2.65i suspended page and locked UI fail closed before file read',async()=>{
  const f=fixture();let reads=0;
  f.config.file.text=async()=>{reads++;return f.candidate;};
  f.config.isSuspended=()=>true;
  assert.equal((await performNormalSaveImport(f.config)).reason,'PAGE_SUSPENDED');
  f.config.isSuspended=()=>false;f.config.runtime.busy=true;
  assert.equal((await performNormalSaveImport(f.config)).reason,'SAVE_NOT_READY');
  assert.equal(reads,0);assert.equal(f.calls.length,0);
});

test('P2.65o a hung native file read times out without any restore or confirmation',async()=>{
  const f=fixture();let timeout,late,cleared=0,confirms=0;
  f.config.file.text=()=>new Promise(resolve=>{late=resolve;});
  f.config.schedule=(callback,ms)=>{
    assert.equal(ms,45_000);timeout=callback;return 12;
  };
  f.config.cancelSchedule=id=>{assert.equal(id,12);cleared++;};
  f.config.confirm=()=>{confirms++;return true;};
  const pending=performNormalSaveImport(f.config);
  assert.equal(typeof timeout,'function');
  timeout();
  assert.equal((await pending).reason,'FILE_READ_TIMEOUT');
  late(f.candidate);
  await Promise.resolve();
  assert.equal(cleared,1);
  assert.equal(confirms,0);
  assert.equal(f.calls.length,0);
  assert.equal(f.map.get(SAVE_KEY),f.current);
  assert.equal(f.map.get(STORY_SAVE_KEY),'story-untouched');
});
test('P2.65o successful file read clears deadline before confirmation',async()=>{
  const f=fixture();let timeout,cleared=0;
  f.config.schedule=(callback,ms)=>{timeout=callback;return 13;};
  f.config.cancelSchedule=id=>{assert.equal(id,13);cleared++;};
  assert.equal((await performNormalSaveImport(f.config)).ok,true);
  assert.equal(cleared,1);
  timeout();
  assert.equal(f.calls.length,1,'late timer cannot replay a restore');
});
test('P2.65o a missing timer fails closed without reading the file',async()=>{
  const f=fixture();let reads=0;
  f.config.schedule=undefined;
  // Explicitly unavailable timer: avoid the default parameter.
  f.config.schedule=null;
  f.config.file.text=()=>{reads++;return Promise.resolve(f.candidate);};
  assert.equal((await performNormalSaveImport(f.config)).reason,'FILE_READ_UNAVAILABLE');
  assert.equal(reads,0);
  assert.equal(f.calls.length,0);
});
test('P2.65o changed lifecycle during a hung read takes priority over timeout',async()=>{
  const f=fixture();let timeout,epoch=0;
  f.config.getEpoch=()=>epoch;
  f.config.file.text=()=>new Promise(()=>{});
  f.config.schedule=callback=>{timeout=callback;return 14;};
  f.config.cancelSchedule=()=>{};
  const pending=performNormalSaveImport(f.config);
  epoch++;timeout();
  assert.equal((await pending).reason,'PAGE_SUSPENDED');
  assert.equal(f.calls.length,0);
});

test('P2.65p pagehide abort releases hung File.text and discards late content',async()=>{
  const f=fixture(),controller=new AbortController();
  let late,timeout,cleared=0,confirms=0;
  f.config.signal=controller.signal;
  f.config.file.text=()=>new Promise(resolve=>{late=resolve;});
  f.config.schedule=callback=>{timeout=callback;return 21;};
  f.config.cancelSchedule=id=>{assert.equal(id,21);cleared++;};
  f.config.confirm=()=>{confirms++;return true;};
  const pending=performNormalSaveImport(f.config);
  controller.abort();
  assert.equal((await pending).reason,'PAGE_SUSPENDED');
  assert.equal(cleared,1);
  late(f.candidate);timeout();await Promise.resolve();
  assert.equal(confirms,0);
  assert.equal(f.calls.length,0);
  assert.equal(f.map.get(SAVE_KEY),f.current);
  assert.equal(f.map.get(STORY_SAVE_KEY),'story-untouched');
});
test('P2.65p pre-aborted signal never reads native file',async()=>{
  const f=fixture(),controller=new AbortController();
  let reads=0;
  controller.abort();f.config.signal=controller.signal;
  f.config.file.text=()=>{reads++;return Promise.resolve(f.candidate);};
  assert.equal((await performNormalSaveImport(f.config)).reason,'PAGE_SUSPENDED');
  assert.equal(reads,0);assert.equal(f.calls.length,0);
});
test('P2.65p backgrounding during confirmation cannot restore',async()=>{
  const f=fixture(),controller=new AbortController();
  f.config.signal=controller.signal;
  f.config.confirm=()=>{controller.abort();return true;};
  assert.equal((await performNormalSaveImport(f.config)).reason,'PAGE_SUSPENDED');
  assert.equal(f.calls.length,0);
  assert.equal(f.map.get(SAVE_KEY),f.current);
});

test('P2.65ag preview-time pagehide invalidates import before any confirmation',async()=>{
  const f=fixture();let epoch=0,confirms=0;
  f.config.getEpoch=()=>epoch;
  f.config.confirm=()=>{confirms++;return true;};
  const original=f.config.storage.getItem;
  f.config.storage.getItem=key=>{
    const value=original(key);
    if(key===SAVE_KEY)epoch++;
    return value;
  };
  assert.equal((await performNormalSaveImport(f.config)).reason,'PAGE_SUSPENDED');
  assert.equal(confirms,0,'stale preview must not open a native confirm');
  assert.equal(f.calls.length,0,'restore must not be authorized');
  assert.equal(f.map.get(SAVE_KEY),f.current);
  assert.equal(f.map.get(STORY_SAVE_KEY),'story-untouched');
});

test('P2.65ag preview-time cross-tab replacement never opens stale confirmation',async()=>{
  const f=fixture();let confirms=0;
  const newer=JSON.stringify({...createInitialState(1),revision:9,coins:99});
  f.config.confirm=()=>{confirms++;return true;};
  f.config.revalidate=()=>f.map.get(SAVE_KEY)===f.config.runtime.raw;
  const original=f.config.storage.getItem;
  f.config.storage.getItem=key=>{
    const value=original(key);
    if(key===SAVE_KEY)f.map.set(SAVE_KEY,newer);
    return value;
  };
  assert.equal((await performNormalSaveImport(f.config)).reason,'SAVE_CHANGED');
  assert.equal(confirms,0,'changed raw save must not be presented as reviewed');
  assert.equal(f.calls.length,0);
  assert.equal(f.map.get(SAVE_KEY),newer,'do not overwrite the other tab');
  assert.equal(f.map.get(STORY_SAVE_KEY),'story-untouched');
});

test('P2.65ag preview-time abort cannot proceed to confirmation or restore',async()=>{
  const f=fixture(),controller=new AbortController();let confirms=0;
  f.config.signal=controller.signal;
  f.config.confirm=()=>{confirms++;return true;};
  const original=f.config.storage.getItem;
  f.config.storage.getItem=key=>{
    const value=original(key);
    if(key===SAVE_KEY)controller.abort();
    return value;
  };
  assert.equal((await performNormalSaveImport(f.config)).reason,'PAGE_SUSPENDED');
  assert.equal(confirms,0);
  assert.equal(f.calls.length,0);
  assert.equal(f.map.get(SAVE_KEY),f.current);
});
