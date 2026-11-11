/** P3: IndexedDB-coordinated ordinary cloud journal when Web Locks is absent.
 * Durable mutations are short readwrite transactions. Network awaits happen
 * OUTSIDE transactions; an operation is marked attempted BEFORE transmission.
 * No localStorage spin lock, no automatic replay with a new operation ID.
 */
import {createOfflineCommandQueue,queueStorageKey,MAX_STORED_BYTES}
  from './offline-queue.mjs';
import {normalizeCommand} from './authority.mjs';
import {validateSave} from '../engine.mjs';

const DB='yunyu-normal-cloud-queue-v1';
const STORE='queue-records';
const MODE='indexeddb-v1';
const MAX_PENDING=32;
const reject=code=>Object.freeze({ok:false,code});
const copy=v=>structuredClone(v);
const statusSnapshot=reply=>!!reply&&typeof reply==='object'&&
  validateSave(reply.state)&&Number.isSafeInteger(reply.revision)&&
  reply.revision===reply.state.revision&&reply.revision>=0;
export const cloudQueueIdbMarkerKey=uid=>queueStorageKey(uid)+'.persistence-v2';
const empty=uid=>({version:1,uid:uid.toLowerCase(),confirmed:null,pending:[],blocked:null});
function validRaw(raw,uid){
  if(typeof raw!=='string'||raw.length<1||raw.length>MAX_STORED_BYTES)return false;
  try{
    const fake={getItem:key=>key===queueStorageKey(uid)?raw:null,
      setItem:()=>{throw Error('Read-only validator')}};
    const queue=createOfflineCommandQueue({uid,storage:fake,
      transport:{read:async()=>{},execute:async()=>{}}});
    return queue.preview().phase!=='storage-error';
  }catch{return false}
}
function parse(raw,uid){
  if(!validRaw(raw,uid))throw Error('CLOUD_JOURNAL_CORRUPT');
  return JSON.parse(raw);
}
function encode(value,uid){
  const raw=JSON.stringify(value);
  if(!validRaw(raw,uid))throw Error('CLOUD_JOURNAL_INVALID');
  return raw;
}
function openDB(factory){
  return new Promise((resolve,reject)=>{
    let req,finished=false;
    const timer=setTimeout(()=>finish(Error('CLOUD_IDB_TIMEOUT')),8000);
    function finish(error,db){
      if(finished){try{db?.close()}catch{}return}
      finished=true;clearTimeout(timer);
      if(error)reject(error);else resolve(db);
    }
    try{req=factory.open(DB,1)}catch(error){finish(error);return}
    req.onupgradeneeded=()=>{
      if(!req.result.objectStoreNames.contains(STORE))
        req.result.createObjectStore(STORE);
    };
    req.onerror=()=>finish(req.error??Error('CLOUD_IDB_OPEN_FAILED'));
    req.onblocked=()=>finish(Error('CLOUD_IDB_UPGRADE_BLOCKED'));
    req.onsuccess=()=>finish(null,req.result);
  });
}
function initialize(db,uid,raw,legacyStorage,markerKey){
  const journalKey=queueStorageKey(uid),metaKey=journalKey+'.migration';
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);
    let ready=false;
    const abort=()=>{try{tx.abort()}catch{}};
    store.get(metaKey).onsuccess=event=>{
      const meta=event.target.result;
      if(meta!==undefined){
        if(meta?.version!==1||meta.legacyRaw!==raw){abort();return}
        ready=true;return;
      }
      store.get(journalKey).onsuccess=event=>{
        if(event.target.result!==undefined){abort();return}
        try{
          if(legacyStorage.getItem(markerKey)!==MODE||
            legacyStorage.getItem(journalKey)!==raw){abort();return}
          if(raw!==null&&!validRaw(raw,uid)){abort();return}
          store.put(raw??encode(empty(uid),uid),journalKey);
          store.put({version:1,legacyRaw:raw},metaKey);
          ready=true;
        }catch{abort()}
      };
    };
    tx.oncomplete=()=>resolve(ready);
    tx.onabort=()=>reject(tx.error??Error('CLOUD_IDB_MIGRATION_ABORTED'));
    tx.onerror=()=>reject(tx.error??Error('CLOUD_IDB_MIGRATION_FAILED'));
  });
}
export async function openIndexedDBCloudQueue({
  uid,legacyStorage,indexedDB,transport,clock=()=>Date.now(),
  makeId=()=>globalThis.crypto.randomUUID(),Channel
}={}){
  const journalKey=queueStorageKey(uid),markerKey=cloudQueueIdbMarkerKey(uid);
  if(typeof indexedDB?.open!=='function'||typeof legacyStorage?.getItem!=='function'||
     typeof legacyStorage?.setItem!=='function'||typeof transport?.read!=='function'||
     typeof transport?.execute!=='function')
    throw Error('CLOUD_IDB_UNAVAILABLE');
  let legacyRaw;
  try{
    const mode=legacyStorage.getItem(markerKey);
    if(mode!==null&&mode!==MODE)throw Error('CLOUD_IDB_UNKNOWN_MODE');
    legacyRaw=legacyStorage.getItem(journalKey);
    if(legacyRaw!==null&&!validRaw(legacyRaw,uid))
      throw Error('CLOUD_LEGACY_JOURNAL_CORRUPT');
    if(mode===null){
      legacyStorage.setItem(markerKey,MODE);
      if(legacyStorage.getItem(markerKey)!==MODE)
        throw Error('CLOUD_IDB_MARKER_UNVERIFIED');
    }
  }catch{throw Error('CLOUD_IDB_LEGACY_FENCE_UNAVAILABLE')}
  const db=await openDB(indexedDB);
  try{
    if(!(await initialize(db,uid,legacyRaw,legacyStorage,markerKey)))
      throw Error('CLOUD_IDB_MIGRATION_UNVERIFIED');
  }catch(error){db.close();throw error}
  let cacheRaw,invalid=false,verifiedToken=null,phase='unverified';
  const metaKey=journalKey+'.migration';
  const safe=()=>{
    try{return !invalid&&legacyStorage.getItem(markerKey)===MODE&&
      legacyStorage.getItem(journalKey)===legacyRaw}
    catch{return false}
  };
  function transact(mode,fn){
    if(!safe())return Promise.reject(Error('CLOUD_IDB_LEGACY_CHANGED'));
    return new Promise((resolve,reject)=>{
      let tx,store,reply,newRaw;
      try{
        tx=db.transaction(STORE,mode);store=tx.objectStore(STORE);
        const r=store.get(journalKey),m=store.get(metaKey);
        let remaining=2,raw,meta;
        const finish=()=>{
          if(--remaining!==0)return;
          try{
            if(meta?.version!==1||meta.legacyRaw!==legacyRaw||!safe())
              throw Error('CLOUD_IDB_MIGRATION_CHANGED');
            const old=parse(raw,uid);
            const result=fn(copy(old));
            if(result&&typeof result.then==='function')
              throw Error('CLOUD_IDB_ASYNC_CALLBACK_FORBIDDEN');
            reply=result?.reply??result;
            if(mode==='readwrite'&&result?.next!==undefined){
              newRaw=encode(result.next,uid);
              store.put(newRaw,journalKey);
            }else newRaw=raw;
          }catch{try{tx.abort()}catch{}}
        };
        r.onsuccess=event=>{raw=event.target.result;finish()};
        m.onsuccess=event=>{meta=event.target.result;finish()};
        tx.oncomplete=()=>{
          cacheRaw=newRaw;
          if(!safe()){invalid=true;reject(Error('CLOUD_IDB_POST_COMMIT_LEGACY_CHANGED'));return}
          resolve(reply);
        };
        tx.onabort=()=>reject(tx.error??Error('CLOUD_IDB_TRANSACTION_ABORTED'));
        tx.onerror=()=>reject(tx.error??Error('CLOUD_IDB_TRANSACTION_FAILED'));
      }catch(error){try{tx?.abort()}catch{}reject(error)}
    });
  }
  try{await transact('readonly',j=>({reply:j}))}
  catch(error){db.close();throw error}
  const pending=()=>parse(cacheRaw,uid);
  const serverToken=j=>j.confirmed?JSON.stringify(j.confirmed):null;
  const preview=()=>{
    let j;
    try{j=pending()}catch{
      return {phase:'storage-error',verified:false,lockAvailable:true,
        backend:'indexeddb',pending:0,code:'CLOUD_IDB_INVALID'};
    }
    const verified=safe()&&verifiedToken!==null&&serverToken(j)===verifiedToken;
    return {phase:!safe()?'blocked':j.blocked?'blocked':j.pending.length?'pending':
        verified?'synced':phase,
      backend:'indexeddb',lockAvailable:true,verified,pending:j.pending.length,
      attemptedPending:j.pending.filter(p=>p.attempts>0).length,
      blocked:j.blocked,revision:j.confirmed?.revision??null,
      state:j.confirmed?copy(j.confirmed.state):null,
      firstOperationId:j.pending[0]?.operationId??null,
      nextRetryAt:j.pending[0]?.nextRetryAt??0};
  };
  function mutate(fn){
    verifiedToken=null;
    return transact('readwrite',old=>{
      const result=fn(old);
      return result?.next===undefined?{reply:result?.reply??result}:result;
    });
  }
  async function connect(){
    verifiedToken=null;
    let reply;
    try{reply=await transport.read()}
    catch(error){phase='offline';return reject(error?.code==='CLOUD_ACCESS_DENIED'||
      error?.code==='CLOUD_AUTH_UNVERIFIED'?error.code:'NETWORK_UNAVAILABLE')}
    if(reply?.ok!==true||reply.status!=='ok'||!statusSnapshot(reply)){
      phase='protocol-error';return reject('INVALID_SNAPSHOT')}
    try{
      const result=await mutate(j=>{
        if(j.confirmed&&reply.revision<j.confirmed.revision)
          return {reply:reject('STALE_SNAPSHOT')};
        j.confirmed={revision:reply.revision,state:copy(reply.state)};
        return {next:j,reply:{ok:true}};
      });
      if(!result.ok){phase='blocked';return result}
      verifiedToken=serverToken(pending());
      phase='synced';
      return {ok:true,...preview()};
    }catch{phase='storage-error';return reject('STORAGE_ERROR')}
  }
  async function enqueue(action){
    let id;
    try{id=makeId()?.toLowerCase()}catch{return reject('ID_UNAVAILABLE')}
    const command=normalizeCommand({operationId:id,expectedRevision:0,action});
    if(!command)return reject('BAD_COMMAND');
    try{
      return await mutate(j=>{
        if(j.pending.length>=MAX_PENDING)return {reply:reject('QUEUE_FULL')};
        if(j.pending.some(p=>p.operationId.toLowerCase()===id))
          return {reply:reject('INVALID_ID')};
        j.pending.push({operationId:id,action:copy(action),expectedRevision:null,
          attempts:0,nextRetryAt:0});
        return {next:j,reply:{ok:true,operationId:id,pending:j.pending.length}};
      });
    }catch{phase='storage-error';return reject('STORAGE_ERROR')}
  }
  async function flush({force=false}={}){
    const connected=await connect();
    if(!connected.ok)return connected;
    for(let i=0;i<MAX_PENDING;i++){
      let step;
      try{
        step=await mutate(j=>{
          if(j.blocked)return {reply:reject('ACTION_NEEDS_REVIEW')};
          if(!j.pending.length)return {reply:{ok:true,done:true}};
          const head=j.pending[0];
          if(!force&&head.nextRetryAt>clock())
            return {reply:reject('RETRY_LATER')};
          if(head.expectedRevision===null){
            if(!j.confirmed)return {reply:reject('REMOTE_VERIFICATION_REQUIRED')};
            head.expectedRevision=j.confirmed.revision;
          }
          head.attempts++;
          head.nextRetryAt=0;
          return {next:j,reply:{ok:true,command:{
            operationId:head.operationId,expectedRevision:head.expectedRevision,
            action:copy(head.action)},attempts:head.attempts}};
        });
      }catch{phase='storage-error';return reject('STORAGE_ERROR')}
      if(!step.ok)return step;
      if(step.done){phase='synced';return {ok:true,...preview()}}
      let response;
      try{response=await transport.execute(step.command)}
      catch{
        try{
          await mutate(j=>{
            const head=j.pending[0];
            if(!head||head.operationId!==step.command.operationId)
              return {reply:{ok:false,code:'JOURNAL_CHANGED'}};
            head.nextRetryAt=clock()+Math.min(60000,1000*2**Math.min(head.attempts-1,6));
            return {next:j,reply:{ok:true}};
          });
        }catch{phase='storage-error';return reject('STORAGE_ERROR')}
        phase='offline';
        return reject('NETWORK_UNAVAILABLE');
      }
      try{
        const outcome=await mutate(j=>{
          const head=j.pending[0];
          if(!head||head.operationId!==step.command.operationId)
            return {reply:reject('JOURNAL_CHANGED')};
          if(!statusSnapshot(response)||
            j.confirmed&&response.revision<j.confirmed.revision){
            j.blocked='protocol-error';return {next:j,reply:reject('INVALID_RESPONSE')};
          }
          j.confirmed={revision:response.revision,state:copy(response.state)};
          if(['applied','replayed'].includes(response.status)&&response.ok===true&&
            response.revision>=step.command.expectedRevision+1){
            j.pending.shift();
            return {next:j,reply:{ok:true,applied:true}};
          }
          if(response.status==='conflict'||response.status==='rejected'||
             response.status==='replayed'&&response.ok===false){
            j.blocked=response.status==='conflict'?'conflict':'rejected';
            return {next:j,reply:reject(response.code??'ACTION_NEEDS_REVIEW')};
          }
          j.blocked='protocol-error';
          return {next:j,reply:reject('INVALID_RESPONSE')};
        });
        if(!outcome.ok){phase='blocked';return outcome}
      }catch{phase='storage-error';return reject('STORAGE_ERROR')}
    }
    return reject('QUEUE_FULL');
  }
  async function discardUnsent(){
    try{
      return await mutate(j=>{
        if(j.pending.some(x=>x.attempts>0))return {reply:reject('OUTCOME_MAY_BE_UNKNOWN')};
        j.pending=[];j.blocked=null;
        return {next:j,reply:{ok:true}};
      });
    }catch{return reject('STORAGE_ERROR')}
  }
  async function discardConflicted({confirmedByUser=false}={}){
    if(!confirmedByUser)return reject('CONFIRMATION_REQUIRED');
    try{
      return await mutate(j=>{
        if(!['conflict','rejected'].includes(j.blocked)||
           j.pending.slice(1).some(x=>x.attempts>0))
          return {reply:reject('CONFIRMATION_REQUIRED')};
        j.pending=[];j.blocked=null;
        return {next:j,reply:{ok:true}};
      });
    }catch{return reject('STORAGE_ERROR')}
  }
  async function inspectConflict(){
    const refreshed=await connect();
    if(!refreshed.ok)return refreshed;
    const j=pending(),head=j.pending[0];
    if(j.blocked!=='conflict'||!head)return reject('NO_CONFLICT');
    return {ok:true,originalOperationId:head.operationId,
      action:copy(head.action),revision:j.confirmed.revision,
      state:copy(j.confirmed.state),pending:j.pending.length,
      followingUnsent:j.pending.slice(1).every(x=>x.attempts===0)};
  }
  async function replaceConflicted({confirmedByUser=false,originalOperationId,
    expectedRevision,reviewedState,newAction,discardFollowing=false}={}){
    if(!confirmedByUser||!statusSnapshot({revision:expectedRevision,state:reviewedState}))
      return reject('REVIEW_CONFIRMATION_REQUIRED');
    const refreshed=await connect();
    if(!refreshed.ok)return refreshed;
    let newId;
    try{newId=makeId()?.toLowerCase()}catch{return reject('INVALID_ID')}
    if(!normalizeCommand({operationId:newId,expectedRevision:0,action:newAction}))
      return reject('BAD_COMMAND');
    try{
      return await mutate(j=>{
        const head=j.pending[0];
        if(j.blocked!=='conflict'||!head||head.operationId!==originalOperationId)
          return {reply:reject('NO_CONFLICT')};
        if(j.confirmed.revision!==expectedRevision||
           JSON.stringify(j.confirmed.state)!==JSON.stringify(reviewedState))
          return {reply:reject('REVIEW_STALE')};
        if(j.pending.slice(1).some(x=>x.attempts>0))
          return {reply:reject('FOLLOWING_OUTCOME_UNKNOWN')};
        if(j.pending.length>1&&!discardFollowing)
          return {reply:reject('FOLLOWING_ACTIONS_NEED_REVIEW')};
        j.pending=[{operationId:newId,expectedRevision:null,
          action:copy(newAction),attempts:0,nextRetryAt:0}];
        j.blocked=null;
        return {next:j,reply:{ok:true,operationId:newId}};
      });
    }catch{return reject('STORAGE_ERROR')}
  }
  // Send only invalidation signals, never raw snapshots or credentials.
  let channel=null;
  try{
    if(typeof Channel==='function'){
      channel=new Channel('yunyu-normal-cloud-journal-v1');
      channel.onmessage=()=>void transact('readonly',j=>({reply:j})).catch(()=>{
        invalid=true;verifiedToken=null});
    }
  }catch{}
  db.onversionchange=()=>{invalid=true;verifiedToken=null;db.close()};
  // Notifications are best-effort; every actual operation rereads the
  // authoritative IDB record under its own readwrite transaction.
  const wrappedMutate=mutate;
  void wrappedMutate;
  return Object.freeze({backend:'indexeddb',key:journalKey,
    preview,connect,enqueue,flush,inspectConflict,replaceConflicted,
    discardUnsent,discardConflicted});
}
