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
