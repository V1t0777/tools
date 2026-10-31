import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineCommandQueue,queueStorageKey} from '../merge/cloud/offline-queue.mjs';
import {createCoordinatedCloudQueue} from '../merge/cloud/tab-coordinator.mjs';
import {createInMemoryAuthority} from '../merge/cloud/authority.mjs';
import {formatCloudSyncStatus,paintCloudSyncStatus} from '../merge/cloud/sync-view.mjs';

const uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const fixedNow=1_000_000;
const produce={type:'produce',slot:42};
const move={type:'move',from:0,to:2};
function storage() {
  const memory=new Map();
  return {getItem:key=>memory.get(key)??null,setItem:(key,raw)=>memory.set(key,raw),
    raw:memory};
}
function authority(){return createInMemoryAuthority({clock:()=>fixedNow,rng:()=>0.9});}
function client(store,transport,{seed=1,clock=()=>fixedNow}={}) {
  let id=seed;
  return createOfflineCommandQueue({uid,storage:store,transport,clock,
    makeId:()=>`00000000-0000-4000-8000-${(id++).toString(16).padStart(12,'0')}`});
}

test('new unsent journal operation stays distinct from an ambiguous attempted operation',()=>{
  const store=storage(),remote=authority();
  const queue=client(store,{read:()=>remote.read(uid),execute:c=>remote.execute(uid,c)});
  queue.enqueue(produce);
  const snapshot=queue.preview();
  assert.equal(snapshot.pending,1);
  assert.equal(snapshot.attemptedPending,0);
  assert.equal(snapshot.verified,false);
  const presentation=formatCloudSyncStatus(snapshot,fixedNow);
  assert.equal(presentation.tone,'info');
  assert.match(presentation.detail,/尚未尝试发送/);
  assert.doesNotMatch(presentation.title,/已确认|结果未确认/);
});

test('lost ACK persists an attempted operation and unknown-result warning after restart',async()=>{
  const store=storage(),remote=authority();
  const transport={read:()=>remote.read(uid),execute:async command=>{
    await remote.execute(uid,command);throw Error('ACK lost after server commit');
  }};
  const tab=client(store,transport);
  const original=tab.enqueue(produce);
  assert.equal((await tab.flush()).code,'NETWORK_UNAVAILABLE');
  assert.equal((await remote.read(uid)).revision,1);
  const restarted=client(store,transport,{seed:100});
  const snapshot=restarted.preview();
  assert.equal(snapshot.firstOperationId,original.operationId);
  assert.equal(snapshot.verified,false);
  assert.equal(snapshot.attemptedPending,1);
  assert.equal(snapshot.pending,1);
  const message=formatCloudSyncStatus(snapshot,fixedNow);
  assert.equal(message.tone,'warning');
  assert.match(message.title,/结果未确认/);
  assert.match(message.detail,/可能已在服务器生效/);
  assert.match(message.detail,/原操作编号/);
  assert.doesNotMatch(message.title,/已确认完成/);
});

test('persisted retry deadline is shown as not-yet-safe, then becomes unknown without claiming success',async()=>{
  const store=storage(),remote=authority();
  let now=fixedNow;
  const transport={read:()=>remote.read(uid),execute:async cmd=>{
    await remote.execute(uid,cmd);throw Error('ACK lost');
  }};
  const original=client(store,transport,{clock:()=>now});
  original.enqueue(produce);
  assert.equal((await original.flush()).code,'NETWORK_UNAVAILABLE');
  const reboot=client(store,transport,{seed:100,clock:()=>now});
  const snapshot=reboot.preview();
  assert.equal(snapshot.nextRetryAt,fixedNow+1000);
  assert.match(formatCloudSyncStatus(snapshot,fixedNow).title,/尚未到重试时间/);
  now=fixedNow+1001;
  const after=formatCloudSyncStatus(reboot.preview(),now);
  assert.match(after.title,/结果未确认/);
  assert.doesNotMatch(after.title,/尚未到重试时间|已确认/);
});

test('reading an authoritative snapshot alone does not resolve an attempted operation',async()=>{
  const store=storage(),remote=authority();
  let drop=true;
  const transport={read:()=>remote.read(uid),execute:async cmd=>{
    const reply=await remote.execute(uid,cmd);
    if(drop){drop=false;throw Error('ACK lost');}
    return reply;
  }};
  const original=client(store,transport);
  original.enqueue(produce);
  assert.equal((await original.flush()).code,'NETWORK_UNAVAILABLE');
  const reboot=client(store,transport,{seed:100});
  assert.equal((await reboot.connect()).ok,true);
  assert.equal(reboot.preview().verified,true);
  assert.equal(reboot.preview().attemptedPending,1);
  assert.equal(formatCloudSyncStatus(reboot.preview(),fixedNow).tone,'warning');
  assert.match(formatCloudSyncStatus(reboot.preview(),fixedNow).title,/结果未确认/);
  assert.equal((await reboot.flush({force:true})).ok,true);
  const confirmed=formatCloudSyncStatus(reboot.preview(),fixedNow);
  assert.equal(confirmed.tone,'success');
  assert.equal(reboot.preview().pending,0);
  assert.equal((await remote.read(uid)).state.energy,119);
  assert.equal((await remote.read(uid)).revision,1);
});

test('a persisted conflict must request fresh server verification before manual resolution',async()=>{
  const store=storage(),remote=authority();
  let drop=true;
  const transport={read:()=>remote.read(uid),execute:async cmd=>{
    if(drop){drop=false;throw Error('disconnected before send');}
    return remote.execute(uid,cmd);
  }};
  const tab=client(store,transport);
  tab.enqueue(move);
  assert.equal((await tab.flush()).code,'NETWORK_UNAVAILABLE');
  const other=await remote.execute(uid,{operationId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    expectedRevision:0,action:{type:'move',from:0,to:7}});
  assert.equal(other.status,'applied');
  assert.equal((await tab.flush({force:true})).code,'REVISION_CONFLICT');
  const reboot=client(store,transport,{seed:100});
  assert.equal(reboot.preview().blocked,'conflict');
  assert.equal(reboot.preview().verified,false);
  const warning=formatCloudSyncStatus(reboot.preview());
  assert.match(warning.title,/本地冲突记录待核对/);
  assert.match(warning.detail,/尚未验证最新云端存档/);
  assert.equal((await reboot.connect()).ok,true);
  assert.equal(formatCloudSyncStatus(reboot.preview()).tone,'warning');
  assert.match(formatCloudSyncStatus(reboot.preview()).title,/其他设备已更新进度/);
  assert.equal(reboot.preview().pending,1);
});

test('persistent rejected operations remain for manual handling after restart',async()=>{
  const store=storage(),remote=authority();
  const transport={read:()=>remote.read(uid),execute:cmd=>remote.execute(uid,cmd)};
  const tab=client(store,transport);
  tab.enqueue({type:'upgradeBuilding',buildingId:'harbor'});
  const result=await tab.flush();
  assert.equal(result.blocked,'rejected');
  const reboot=client(store,transport,{seed:100});
  assert.equal(reboot.preview().blocked,'rejected');
  const message=formatCloudSyncStatus(reboot.preview());
  assert.equal(message.tone,'warning');
  assert.match(message.title,/人工处理/);
  assert.equal(reboot.preview().attemptedPending,1);
});

test('offline before any send does not claim an unknown remote execution',async()=>{
  const store=storage();
  const transport={read:async()=>{throw Error('offline before read')},
    execute:async()=>{throw Error('must not send')}};
  const q=client(store,transport);
  q.enqueue(produce);
  assert.equal((await q.flush()).code,'NETWORK_UNAVAILABLE');
  const reload=client(store,transport,{seed:100});
  assert.equal(reload.preview().attemptedPending,0);
  const message=formatCloudSyncStatus(reload.preview());
  assert.match(message.detail,/尚未尝试发送/);
  assert.doesNotMatch(message.title,/结果未确认/);
});

test('a corrupt journal outranks an ambiguous retry and never looks synchronized',async()=>{
  const store=storage(),remote=authority();
  const transport={read:()=>remote.read(uid),
    execute:async cmd=>{await remote.execute(uid,cmd);throw Error('lost ACK')}};
  const q=client(store,transport);
  q.enqueue(produce);
  await q.flush();
  store.setItem(queueStorageKey(uid),'{partial');
  const reload=client(store,transport,{seed:100});
  const message=formatCloudSyncStatus(reload.preview());
  assert.equal(message.tone,'danger');
  assert.match(message.title,/本地队列无法安全保存/);
  assert.equal((await reload.flush()).code,'STORAGE_ERROR');
  assert.equal(store.getItem(queueStorageKey(uid)),'{partial');
});

test('no Web Locks support is not hidden by an attempted pending cloud command',async()=>{
  const store=storage(),remote=authority();
  const transport={read:()=>remote.read(uid),execute:async cmd=>{
    await remote.execute(uid,cmd);throw Error('lost ACK');
  }};
  const q=client(store,transport);
  q.enqueue(produce);
  await q.flush();
  const coordinated=createCoordinatedCloudQueue({uid,storage:store,transport,locks:null});
  assert.equal(coordinated.preview().attemptedPending,1);
  const message=formatCloudSyncStatus(coordinated.preview());
  assert.equal(message.tone,'danger');
  assert.match(message.title,/不支持安全云同步/);
});

test('status rendering shows attempted outcomes using plain text and accessibility attributes',async()=>{
  const store=storage(),remote=authority();
  const q=client(store,{read:()=>remote.read(uid),execute:async cmd=>{
    await remote.execute(uid,cmd);throw Error('lost ACK');
  }});
  q.enqueue(produce);
  await q.flush();
  const attrs={};const el={textContent:'',setAttribute:(key,value)=>{attrs[key]=value}};
  const message=paintCloudSyncStatus(el,q.preview());
  assert.equal(message.tone,'warning');
  assert.match(el.textContent,/操作结果未确认/);
  assert.match(el.textContent,/原操作编号/);
  assert.equal(attrs.role,'status');
  assert.equal(attrs['aria-live'],'polite');
  assert.equal(attrs['data-sync-tone'],'warning');
});

test('syncing with an attempted command never presents a stale success badge',async()=>{
  const store=storage(),remote=authority();
  let first=true;
  const transport={read:()=>remote.read(uid),execute:async cmd=>{
    const reply=await remote.execute(uid,cmd);
    if(first){first=false;throw Error('ACK lost');}
    return reply;
  }};
  const origin=client(store,transport);
  origin.enqueue(produce);
  await origin.flush();
  let release,started;
  const wait=new Promise(resolve=>{release=resolve});
  const entered=new Promise(resolve=>{started=resolve});
  const delayed={read:async()=>{started();await wait;return remote.read(uid)},
    execute:transport.execute};
  const reboot=client(store,delayed,{seed:100});
  const pending=reboot.connect();
  await entered;
  const message=formatCloudSyncStatus(reboot.preview());
  assert.equal(message.tone,'info');
  assert.match(message.title,/正在核对云端存档/);
  assert.match(message.detail,/仍待确认/);
  release();
  assert.equal((await pending).ok,true);
  assert.equal(formatCloudSyncStatus(reboot.preview(),fixedNow).tone,'warning');
});
