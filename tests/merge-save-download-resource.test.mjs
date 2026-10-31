import test from 'node:test';
import assert from 'node:assert/strict';
import {requestBrowserSaveDownload} from '../merge/save-download.mjs';
const receipt={ok:true,content:'{"save":1}',mime:'application/json',filename:'save.json'};
function setup({clickThrows=false}={}){
  let clock=1000,canRevoke=true,revokes=0,creates=0;
  const callbacks=[];
  const urlApi={createObjectURL(){creates++;return `blob:${creates}`;},
    revokeObjectURL(){if(!canRevoke)throw Error('transient');revokes++;}};
  const doc={body:{append(){}},createElement(){return {
    click(){if(clickThrows)throw Error('blocked');},remove(){}};}};
  const options={urlApi,doc,now:()=>clock,schedule:(fn,ms)=>{callbacks.push(fn);}};
  return {options,callbacks,get creates(){return creates;},get revokes(){return revokes;},
    setClock(x){clock=x;},setRevoke(x){canRevoke=x;},setClickThrows(x){clickThrows=x;}};
}
test('P2.65x failed native click with failed revoke remains within eight tracked object URLs',()=>{
  const e=setup({clickThrows:true});e.setRevoke(false);
  for(let i=0;i<8;i++)assert.equal(requestBrowserSaveDownload(receipt,e.options).reason,'DOWNLOAD_REQUEST_FAILED');
  assert.equal(requestBrowserSaveDownload(receipt,e.options).reason,'DOWNLOAD_LIMIT_REACHED');
  assert.equal(e.creates,8);
  e.setRevoke(true);e.setClock(121001);e.setClickThrows(false);
  assert.equal(requestBrowserSaveDownload(receipt,e.options).ok,true);
  assert.equal(e.revokes,8);
  assert.equal(e.creates,9);
});
test('P2.65x successful click retries a transient cleanup revoke failure',()=>{
  const e=setup();assert.equal(requestBrowserSaveDownload(receipt,e.options).ok,true);
  e.setClock(121001);e.setRevoke(false);e.callbacks.shift()();
  assert.equal(e.revokes,0);assert.equal(e.callbacks.length,1);
  e.setRevoke(true);e.callbacks.shift()();assert.equal(e.revokes,1);
});
test('P2.65x synchronous timer callback re-arms cleanup without premature revoke',()=>{
  const e=setup();let first=true;
  e.options.schedule=(fn)=>{if(first){first=false;fn();}else e.callbacks.push(fn);};
  const result=requestBrowserSaveDownload(receipt,e.options);
  assert.deepEqual(result,{ok:true,cleanupDeferred:true});
  assert.equal(e.revokes,0);assert.equal(e.callbacks.length,1);
  e.setClock(121001);e.callbacks.shift()();assert.equal(e.revokes,1);
});
