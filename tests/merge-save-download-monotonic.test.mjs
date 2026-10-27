import test from 'node:test';
import assert from 'node:assert/strict';
import {requestBrowserSaveDownload,DOWNLOAD_URL_LIFETIME_MS} from '../merge/save-download.mjs';
const receipt={ok:true,content:'{"save":1}',mime:'application/json',filename:'save.json'};
function fixture(){
  const callbacks=[],revoked=[],urls=[];
  const urlApi={createObjectURL(){const url='blob:clock-'+(urls.length+1);urls.push(url);return url;},
    revokeObjectURL(url){revoked.push(url);}};
  const doc={body:{append(){}},createElement(){return {click(){},remove(){}};}};
  return {callbacks,revoked,urls,urlApi,doc,
    options:{urlApi,doc,schedule:fn=>callbacks.push(fn)}};
}
test('P2.65y wall-clock jump cannot revoke a still-young Safari download',()=>{
  const f=fixture(),oldPerformance=Object.getOwnPropertyDescriptor(globalThis,'performance');
  const oldDateNow=Date.now;let monotonic=1000,wall=1000;
  try {
    Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>monotonic}});
    Date.now=()=>wall;
    assert.equal(requestBrowserSaveDownload(receipt,f.options).ok,true);
    assert.equal(f.callbacks.length,1);
    wall+=3_600_000; // device time corrected while native download is pending
    f.callbacks.shift()();
    assert.deepEqual(f.revoked,[],'wall clock jump must not revoke young URL');
    assert.equal(f.callbacks.length,1,'early timer must be rearmed');
    monotonic+=DOWNLOAD_URL_LIFETIME_MS;
    f.callbacks.shift()();
    assert.deepEqual(f.revoked,['blob:clock-1']);
  } finally {
    Object.defineProperty(globalThis,'performance',oldPerformance);
    Date.now=oldDateNow;
  }
});
test('P2.65y old browser without performance.now falls back to wall clock',()=>{
  const f=fixture(),oldPerformance=Object.getOwnPropertyDescriptor(globalThis,'performance');
  const oldDateNow=Date.now;let wall=1000;
  try {
    Object.defineProperty(globalThis,'performance',{configurable:true,value:undefined});
    Date.now=()=>wall;
    assert.equal(requestBrowserSaveDownload(receipt,f.options).ok,true);
    wall+=DOWNLOAD_URL_LIFETIME_MS;
    f.callbacks.shift()();
    assert.deepEqual(f.revoked,['blob:clock-1']);
  } finally {
    Object.defineProperty(globalThis,'performance',oldPerformance);
    Date.now=oldDateNow;
  }
});
test('P2.65y invalid monotonic clock rejects before allocating a Blob URL',()=>{
  const f=fixture(),oldPerformance=Object.getOwnPropertyDescriptor(globalThis,'performance');
  try {
    Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>NaN}});
    assert.deepEqual(requestBrowserSaveDownload(receipt,f.options),
      {ok:false,reason:'DOWNLOAD_CLOCK_UNAVAILABLE'});
    assert.equal(f.urls.length,0);
  } finally {Object.defineProperty(globalThis,'performance',oldPerformance);}
});
test('P2.65y reentrant allocation never reclaims a URL-less reserved slot',()=>{
  const f=fixture();let clock=1000,nested=[];
  class ReentrantBlob {
    constructor(){
      if(nested.length===0){
        nested.push('entered');clock+=DOWNLOAD_URL_LIFETIME_MS;
        for(let i=0;i<9;i++)nested.push(requestBrowserSaveDownload(receipt,{
          ...f.options,BlobCtor:Blob,now:()=>clock}));
      }
      this.size=receipt.content.length;
    }
  }
  const result=requestBrowserSaveDownload(receipt,{
    ...f.options,BlobCtor:ReentrantBlob,now:()=>clock});
  assert.equal(result.ok,true);
  assert.equal(nested.filter(x=>x?.ok).length,7);
  assert.equal(nested.filter(x=>x?.reason==='DOWNLOAD_LIMIT_REACHED').length,2);
  assert.equal(f.urls.length,8,'outer reservation counts toward quota');
  assert.deepEqual(f.revoked,[],'no URL-less entry is revoked');
});
