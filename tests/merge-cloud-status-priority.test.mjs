import test from 'node:test';
import assert from 'node:assert/strict';
import {formatCloudSyncStatus, paintCloudSyncStatus} from '../merge/cloud/sync-view.mjs';
import {createCoordinatedCloudQueue} from '../merge/cloud/tab-coordinator.mjs';
import {queueStorageKey} from '../merge/cloud/offline-queue.mjs';

const uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const key=queueStorageKey(uid);
const transport={
  read:async()=>{throw Error('network should never be reached for a damaged journal')},
  execute:async()=>{throw Error('no command may be sent')}
};
const makeStore=(raw=null)=>{
  const data=new Map();
  if(raw!==null)data.set(key,raw);
  return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
};

test('damaged journal outranks unsupported Web Locks and tells users to preserve bytes',()=>{
  const state={phase:'storage-error',lockAvailable:false,pending:1,attemptedPending:1,
    code:'MULTITAB_LOCK_UNAVAILABLE'};
  const view=formatCloudSyncStatus(state);
  assert.equal(view.tone,'danger');
  assert.match(view.title,/本地队列无法安全保存/);
  assert.match(view.detail,/请勿清理浏览器数据/);
  assert.doesNotMatch(view.title,/不支持安全云同步/);
});

test('failed durable save code outranks lock failure even with a stale phase',()=>{
  const view=formatCloudSyncStatus({
    phase:'blocked',code:'STORAGE_ERROR',lockAvailable:false,pending:1,attemptedPending:1
  });
  assert.equal(view.tone,'danger');
  assert.match(view.title,/本地队列无法安全保存/);
});

test('a prior lock request failure cannot hide newly observed storage corruption',()=>{
  const view=formatCloudSyncStatus({
    phase:'storage-error',code:'LOCK_REQUEST_FAILED',lockAvailable:true,pending:2
  });
  assert.equal(view.tone,'danger');
  assert.match(view.title,/本地队列无法安全保存/);
});

test('storage failure outranks conflicts and ambiguous retry state without claiming success',()=>{
  for(const blocked of ['conflict','rejected','protocol-error',null]){
    const view=formatCloudSyncStatus({
      phase:'storage-error',blocked,attemptedPending:1,verified:true,
      pending:1,revision:3,nextRetryAt:2_000_000
    },1_000_000);
    assert.equal(view.tone,'danger');
    assert.match(view.title,/本地队列无法安全保存/);
    assert.doesNotMatch(view.title,/已确认/);
  }
});

test('real corrupt journal without Web Locks is presented as storage damage first',()=>{
  const storage=makeStore('{\"pending\":');
  const q=createCoordinatedCloudQueue({uid,storage,transport,locks:null});
  const snapshot=q.preview();
  assert.equal(snapshot.phase,'storage-error');
  assert.equal(snapshot.lockAvailable,false);
  assert.equal(snapshot.verified,false);
  const view=formatCloudSyncStatus(snapshot);
  assert.equal(view.tone,'danger');
  assert.match(view.title,/本地队列无法安全保存/);
  assert.match(view.detail,/请勿清理浏览器数据/);
  assert.equal(storage.getItem(key),'{\"pending\":');
});

test('lock failure followed by journal corruption gives the more urgent warning',async()=>{
  const storage=makeStore();
  const locks={request:async()=>{throw Error('lock request denied')}};
  const q=createCoordinatedCloudQueue({uid,storage,transport,locks});
  assert.equal((await q.connect()).code,'LOCK_REQUEST_FAILED');
  assert.match(formatCloudSyncStatus(q.preview()).title,/独占锁/);
  storage.setItem(key,'{unfinished');
  const snapshot=q.preview();
  assert.equal(snapshot.phase,'storage-error');
  assert.equal(snapshot.verified,false);
  const message=formatCloudSyncStatus(snapshot);
  assert.equal(message.tone,'danger');
  assert.match(message.title,/本地队列无法安全保存/);
  assert.equal(storage.getItem(key),'{unfinished');
});

test('healthy journal with Web Locks unavailable still recommends compatible browsers',()=>{
  const storage=makeStore();
  const q=createCoordinatedCloudQueue({uid,storage,transport,locks:null});
  const snapshot=q.preview();
  assert.equal(snapshot.phase,'unverified');
  assert.equal(snapshot.lockAvailable,false);
  const view=formatCloudSyncStatus(snapshot);
  assert.equal(view.tone,'danger');
  assert.match(view.title,/不支持安全云同步/);
});

test('healthy journal with lock request failure still reports the original lock error',async()=>{
  const storage=makeStore();
  const locks={request:async()=>{throw Error('lock request denied')}};
  const q=createCoordinatedCloudQueue({uid,storage,transport,locks});
  assert.equal((await q.connect()).code,'LOCK_REQUEST_FAILED');
  const view=formatCloudSyncStatus(q.preview());
  assert.equal(view.tone,'danger');
  assert.match(view.title,/无法获取云存档独占锁/);
});

test('accessible text-only hook preserves data and shows storage damage before lock warning',()=>{
  const attributes={};
  const el={textContent:'',setAttribute:(name,value)=>{attributes[name]=value}};
  const view=paintCloudSyncStatus(el,{
    phase:'storage-error',lockAvailable:false,pending:1,attemptedPending:1
  });
  assert.equal(view.tone,'danger');
  assert.match(el.textContent,/本地队列无法安全保存/);
  assert.match(el.textContent,/请勿清理浏览器数据/);
  assert.equal(attributes.role,'status');
  assert.equal(attributes['aria-live'],'polite');
  assert.equal(attributes['data-sync-tone'],'danger');
});
