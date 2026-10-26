import test from 'node:test';
import assert from 'node:assert/strict';
import {requestBrowserSaveDownload} from '../merge/save-download.mjs';
const receipt={ok:true,content:'{"raw":"中文"}',mime:'application/json;charset=utf-8',filename:'yunyu.json'};
function env({throwClick=false,throwTimer=false}={}){
  const calls=[],doc={body:{append(el){calls.push(['append',el.href,el.download]);}},
    createElement(tag){assert.equal(tag,'a');return {
      click(){calls.push(['click']);if(throwClick)throw Error('blocked');},
      remove(){calls.push(['remove']);}
    };}},
    urlApi={
      createObjectURL(blob){assert.equal(blob.type,receipt.mime);
        calls.push(['create']);return 'blob:test';},
      revokeObjectURL(url){calls.push(['revoke',url]);}
    },
    e={calls,doc,urlApi,schedule:null,timer:null};
  e.schedule=(cb,ms)=>{
    if(throwTimer)throw Error('suspended');
    calls.push(['schedule',ms]);e.timer=cb;
  };
  return e;
}
test('P2.65b normal download requests click and revokes only on delayed timer',()=>{
  const e=env();
  const result=requestBrowserSaveDownload(receipt,{...e,schedule:e.schedule});
  assert.deepEqual(result,{ok:true,cleanupDeferred:false});
  assert.deepEqual(e.calls.map(x=>x[0]),['create','append','click','remove','schedule']);
  assert.equal(e.calls[4][1],120000);
  e.timer();assert.deepEqual(e.calls.at(-1),['revoke','blob:test']);
});
test('P2.65b blocked click removes anchor and revokes immediately, never claims success',()=>{
  const e=env({throwClick:true});
  assert.deepEqual(requestBrowserSaveDownload(receipt,{...e,schedule:e.schedule}),
    {ok:false,reason:'DOWNLOAD_REQUEST_FAILED'});
  assert.deepEqual(e.calls.map(x=>x[0]),['create','append','click','revoke','remove']);
});
test('P2.65b mobile suspended timer never revokes before delayed download',()=>{
  const e=env({throwTimer:true});
  assert.deepEqual(requestBrowserSaveDownload(receipt,{...e,schedule:e.schedule}),
    {ok:true,cleanupDeferred:true});
  assert.equal(e.calls.some(x=>x[0]==='revoke'),false);
});
test('P2.65b invalid export receipt and unsupported object URLs fail without clicking',()=>{
  const e=env();
  assert.deepEqual(requestBrowserSaveDownload({...receipt,ok:false},{...e}),
    {ok:false,reason:'INVALID_EXPORT_RECEIPT'});
  assert.deepEqual(requestBrowserSaveDownload(receipt,{...e,urlApi:{}}),
    {ok:false,reason:'DOWNLOAD_UNSUPPORTED'});
  assert.deepEqual(e.calls,[]);
});
test('P2.65b invalid blob URL never reaches anchor click',()=>{
  const e=env();e.urlApi.createObjectURL=()=>null;
  assert.deepEqual(requestBrowserSaveDownload(receipt,{...e,schedule:e.schedule}),
    {ok:false,reason:'DOWNLOAD_REQUEST_FAILED'});
  assert.equal(e.calls.some(x=>x[0]==='click'),false);
});
