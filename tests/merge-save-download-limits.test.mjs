import test from 'node:test';
import assert from 'node:assert/strict';
import {requestBrowserSaveDownload,MAX_PENDING_SAVE_DOWNLOADS,DOWNLOAD_URL_LIFETIME_MS} from '../merge/save-download.mjs';
const receipt={ok:true,content:'{"raw":"中文"}',mime:'application/json;charset=utf-8',filename:'yunyu.json'};
function env(){
  const created=[],revoked=[],clicked=[],timers=[];
  const urlApi={createObjectURL(blob){const id='blob:save-'+created.length;created.push({id,blob});return id;},
    revokeObjectURL(url){revoked.push(url);}};
  const doc={body:{append(){}},createElement(){return {click(){clicked.push(true);},remove(){}};}};
  let time=1000;
  return {urlApi,doc,created,revoked,clicked,timers,
    now:()=>time,advance(ms){time+=ms;},
    schedule:(fn,ms)=>timers.push({fn,ms})};
}
const run=(e,more={})=>requestBrowserSaveDownload(receipt,{...e,...more});
test('P2.65c eight pending mobile downloads are bounded before creating ninth blob',()=>{
  const e=env();
  for(let i=0;i<MAX_PENDING_SAVE_DOWNLOADS;i++)
    assert.deepEqual(run(e,{schedule(){throw Error('timer suspended');}}),
      {ok:true,cleanupDeferred:true});
  assert.deepEqual(run(e),{ok:false,reason:'DOWNLOAD_LIMIT_REACHED'});
  assert.equal(e.created.length,MAX_PENDING_SAVE_DOWNLOADS);
  assert.equal(e.clicked.length,MAX_PENDING_SAVE_DOWNLOADS);
  assert.deepEqual(e.revoked,[]);
});
test('P2.65c expired deferred URLs are reclaimed only after full TTL',()=>{
  const e=env();
  for(let i=0;i<MAX_PENDING_SAVE_DOWNLOADS;i++)run(e,{schedule:null});
  e.advance(DOWNLOAD_URL_LIFETIME_MS-1);
  assert.deepEqual(run(e),{ok:false,reason:'DOWNLOAD_LIMIT_REACHED'});
  assert.deepEqual(e.revoked,[]);
  e.advance(1);
  assert.deepEqual(run(e),{ok:true,cleanupDeferred:false});
  assert.equal(e.revoked.length,MAX_PENDING_SAVE_DOWNLOADS);
  assert.equal(e.clicked.length,MAX_PENDING_SAVE_DOWNLOADS+1);
});
test('P2.65c normal timer removes its entry so capacity recovers immediately',()=>{
  const e=env();
  for(let i=0;i<MAX_PENDING_SAVE_DOWNLOADS;i++)run(e);
  assert.equal(e.timers.length,MAX_PENDING_SAVE_DOWNLOADS);
  assert.equal(e.timers.every(t=>t.ms===DOWNLOAD_URL_LIFETIME_MS),true);
  e.timers[0].fn();
  assert.deepEqual(run(e),{ok:true,cleanupDeferred:false});
  assert.deepEqual(e.revoked,['blob:save-0']);
});
test('P2.65c synchronous broken scheduler never prematurely revokes URL',()=>{
  const e=env();
  assert.deepEqual(run(e,{schedule:fn=>fn()}),{ok:true,cleanupDeferred:true});
  assert.deepEqual(e.revoked,[]);
  e.advance(DOWNLOAD_URL_LIFETIME_MS);
  assert.equal(run(e).ok,true);
  assert.deepEqual(e.revoked,['blob:save-0']);
});
test('P2.65c oversized UTF-8 content is refused even when code units fit',()=>{
  const e=env();
  const content='中'.repeat(700_000);
  assert.ok(content.length<2_000_000);
  assert.deepEqual(run(e),{ok:true,cleanupDeferred:false});
  assert.deepEqual(requestBrowserSaveDownload({...receipt,content},{...e}),
    {ok:false,reason:'DOWNLOAD_TOO_LARGE'});
  assert.equal(e.created.length,1);
  assert.equal(e.clicked.length,1);
});
test('P2.65c oversized raw string is refused before Blob allocation',()=>{
  const e=env();
  assert.deepEqual(requestBrowserSaveDownload({...receipt,content:'x'.repeat(2_000_001)},e),
    {ok:false,reason:'DOWNLOAD_TOO_LARGE'});
  assert.deepEqual(e.created,[]);
});
test('P2.65c clock errors and invalid timestamps fail before clicking',()=>{
  const e=env();
  assert.deepEqual(run(e,{now:()=>{throw Error('no clock');}}),
    {ok:false,reason:'DOWNLOAD_CLOCK_UNAVAILABLE'});
  assert.deepEqual(run(e,{now:()=>NaN}),
    {ok:false,reason:'DOWNLOAD_CLOCK_UNAVAILABLE'});
  assert.equal(e.clicked.length,0);
});
test('P2.65c failed revocation retains entry and safely blocks capacity',()=>{
  const e=env();
  e.urlApi.revokeObjectURL=()=>{throw Error('revoke denied');};
  for(let i=0;i<MAX_PENDING_SAVE_DOWNLOADS;i++)run(e,{schedule:null});
  e.advance(DOWNLOAD_URL_LIFETIME_MS);
  assert.deepEqual(run(e),{ok:false,reason:'DOWNLOAD_LIMIT_REACHED'});
  assert.equal(e.created.length,MAX_PENDING_SAVE_DOWNLOADS);
});
test('P2.65c failed anchor click does not consume a pending download slot',()=>{
  const e=env();
  const broken={...e,doc:{body:{append(){}},createElement(){return {click(){throw Error('blocked');},remove(){}};}}};
  for(let i=0;i<MAX_PENDING_SAVE_DOWNLOADS+2;i++)
    assert.deepEqual(run(e,{...broken}),{ok:false,reason:'DOWNLOAD_REQUEST_FAILED'});
  assert.deepEqual(run(e),{ok:true,cleanupDeferred:false});
  assert.equal(e.clicked.length,1);
});
test('P2.65c independent URL APIs do not share quota or object URL cleanup',()=>{
  const a=env(),b=env();
  for(let i=0;i<MAX_PENDING_SAVE_DOWNLOADS;i++)run(a,{schedule:null});
  assert.deepEqual(run(a),{ok:false,reason:'DOWNLOAD_LIMIT_REACHED'});
  assert.deepEqual(run(b),{ok:true,cleanupDeferred:false});
  assert.equal(b.created.length,1);
  assert.equal(a.created.length,MAX_PENDING_SAVE_DOWNLOADS);
});
