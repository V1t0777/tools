/**
 * Normal V3 write-through IndexedDB backend for browsers without Web Locks.
 * Every operation, old-file import, reset, startup migration and backup slot
 * uses a single readwrite IDB transaction. There is NO unlocked fallback.
 *
 * Existing localStorage data is frozen as exact-byte migration evidence, not
 * a second active save. A concurrent legacy writer invalidates the database
 * and forces read-only recovery; never replace the newer IDB snapshot.
 */
import {SAVE_KEY,LEGACY_BACKUP_KEY,V2_BACKUP_KEY,ABNORMAL_RESET_BACKUP_KEY}
  from './storage.mjs';
import {RESTORE_BACKUP_KEY} from './save-restore-backup.mjs';
import {NORMAL_SAVE_LOCK_NAME} from './normal-save-lock.mjs';

export const NORMAL_IDB_MARKER='toolbox.merge-isle.normal.persistence.v1';
export const NORMAL_IDB_MODE='indexeddb-v1';
const DB_NAME='yunyu-normal-offline-v1';
const STORE='normal-records';
const META='__normal_migration_v1__';
const KEYS=Object.freeze([SAVE_KEY,LEGACY_BACKUP_KEY,V2_BACKUP_KEY,
  ABNORMAL_RESET_BACKUP_KEY,RESTORE_BACKUP_KEY]);
const same=(a,b)=>a.length===b.length&&a.every((value,i)=>value===b[i]);
const deny=(reason)=>Object.freeze({ok:false,reason});

function readLegacy(storage){
  if(typeof storage?.getItem!=='function'||typeof storage?.setItem!=='function')
    throw Error('Legacy storage unavailable');
  return KEYS.map(key=>storage.getItem(key));
}
function legacyMode(storage){
  try{return storage?.getItem?.(NORMAL_IDB_MARKER)??null}
  catch{return 'unavailable'}
}
export function normalPersistenceMarker(storage){return legacyMode(storage)}
function openDatabase(factory){
  return new Promise((resolve,reject)=>{
    let finished=false,request;
    const timer=setTimeout(()=>done(Error('NORMAL_IDB_OPEN_TIMEOUT')),8000);
    function done(error,db){
      if(finished){try{db?.close()}catch{}return}
      finished=true;clearTimeout(timer);
      if(error)reject(error);else resolve(db);
    }
    try{request=factory.open(DB_NAME,1)}
    catch(error){done(error);return}
    request.onupgradeneeded=()=>{
      if(!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE);
    };
    request.onerror=()=>done(request.error??Error('NORMAL_IDB_OPEN_FAILED'));
    request.onblocked=()=>done(Error('NORMAL_IDB_UPGRADE_BLOCKED'));
    request.onsuccess=()=>done(null,request.result);
  });
}
function loadKeys(db){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readonly'),store=tx.objectStore(STORE);
    const values=[];
    KEYS.forEach((key,i)=>{
      store.get(key).onsuccess=event=>{values[i]=event.target.result??null};
    });
    tx.oncomplete=()=>resolve(values);
    tx.onerror=()=>reject(tx.error??Error('NORMAL_IDB_READ_FAILED'));
    tx.onabort=()=>reject(tx.error??Error('NORMAL_IDB_READ_ABORTED'));
  });
}
function initialize(db,original,legacyStorage){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);
    let originalApproved=null;
    const abort=()=>{try{tx.abort()}catch{}};
    store.get(META).onsuccess=event=>{
      const value=event.target.result;
      if(value!==undefined){
        if(value?.version!==1||!Array.isArray(value.legacy)||
          !same(value.legacy,original)){abort();return}
        originalApproved=value.legacy;
        return;
      }
      // Never reseed an existing database whose migration record is missing.
      let count=KEYS.length,occupied=false;
      for(const key of KEYS){
        store.get(key).onsuccess=event=>{
          if(event.target.result!==undefined)occupied=true;
          if(--count!==0)return;
          if(occupied){abort();return}
          try{
            if(!same(readLegacy(legacyStorage),original)){abort();return}
            for(let i=0;i<KEYS.length;i++)
              if(original[i]!==null)store.put(original[i],KEYS[i]);
            store.put({version:1,legacy:original},META);
            originalApproved=original;
          }catch{abort()}
        };
      }
    };
    tx.oncomplete=()=>resolve(originalApproved);
    tx.onerror=()=>reject(tx.error??Error('NORMAL_IDB_MIGRATION_FAILED'));
    tx.onabort=()=>reject(tx.error??Error('NORMAL_IDB_MIGRATION_ABORTED'));
  });
}
/**
 * Native Web Locks stays on its existing, tested legacy backend until a
 * migration marker exists. If the browser lacks Web Locks, migrate to IDB.
 * A failed migration is READ-ONLY; never revert to uncoordinated localStorage.
 */
export async function openNormalPersistence({legacyStorage,nativeLocks,indexedDB,Channel}={}){
  const mode=legacyMode(legacyStorage);
  const legacy={backend:'legacy',storage:legacyStorage,locks:nativeLocks??null};
  if(mode===null&&typeof nativeLocks?.request==='function')return legacy;
  const readonly={backend:'read-only',storage:legacyStorage,locks:null};
  if(mode!=='unavailable'&&mode!==null&&mode!==NORMAL_IDB_MODE)return readonly;
  if(mode==='unavailable'||typeof indexedDB?.open!=='function')return readonly;
  let original;
  try{
    original=readLegacy(legacyStorage);
    if(mode===null){
      // Fence before opening database, preserving old bytes on every failure.
      legacyStorage.setItem(NORMAL_IDB_MARKER,NORMAL_IDB_MODE);
      if(legacyMode(legacyStorage)!==NORMAL_IDB_MODE)throw Error('Marker mismatch');
    }
  }catch{return readonly}
  let db;
  try{
    db=await openDatabase(indexedDB);
    const baseline=await initialize(db,original,legacyStorage);
    if(!baseline)throw Error('Unverified migration');
    let cache=await loadKeys(db),active=null,invalid=false;
    const listeners=new Set();
    const safe=()=>{
      try{return !invalid&&legacyMode(legacyStorage)===NORMAL_IDB_MODE&&
        same(readLegacy(legacyStorage),baseline)}
      catch{return false}
    };
    const notify=change=>{for(const cb of listeners){try{cb(change)}catch{}}};
    const storage={
      getItem(key){
        const i=KEYS.indexOf(key);
        if(i<0)throw Error('NORMAL_IDB_KEY_NOT_ALLOWED');
        return active?active.values[i]:cache[i];
      },
      setItem(key,value){
        const i=KEYS.indexOf(key);
        if(!active||i<0||typeof value!=='string')
          throw Error('NORMAL_IDB_WRITE_REQUIRES_TRANSACTION');
        active.values[i]=value;
        active.changed.add(key);
        active.store.put(value,key);
      }
    };
    let channel=null;
    try{
      if(typeof Channel==='function'){
        channel=new Channel('yunyu-normal-saves-v1');
        channel.onmessage=event=>{
          if(event?.data?.kind==='normal-updated'&&KEYS.includes(event.data.key))
            void refresh().catch(()=>{invalid=true;notify({key:null})});
        };
      }
    }catch{channel=null}
    db.onversionchange=()=>{invalid=true;db.close();notify({key:null})};
    async function refresh(){
      if(!safe()){invalid=true;notify({key:null});return false}
      const next=await loadKeys(db),prior=cache;
      cache=next;
      for(let i=0;i<KEYS.length;i++)if(next[i]!==prior[i])
        notify({key:KEYS[i],oldValue:prior[i],newValue:next[i]});
      return true;
    }
    function lockedWrite(callback){
      if(typeof callback!=='function')return Promise.resolve(deny('INVALID_TRANSACTION'));
      if(!safe())return Promise.resolve(deny('LEGACY_SOURCE_CHANGED'));
      return new Promise((resolve)=>{
        let tx,store,values=[],result=null,writeStarted=false,reason=null;
        const changed=new Set();
        const abort=why=>{reason=why;try{tx.abort()}catch{}};
        try{
          tx=db.transaction(STORE,'readwrite');
          store=tx.objectStore(STORE);
          const requests=[...KEYS.map(key=>store.get(key)),store.get(META)];
          let remaining=requests.length,metadata;
          requests.forEach((request,i)=>{
            request.onsuccess=event=>{
              if(i<KEYS.length)values[i]=event.target.result??null;
              else metadata=event.target.result;
              if(--remaining!==0)return;
              if(metadata?.version!==1||!Array.isArray(metadata.legacy)||
                 !same(metadata.legacy,baseline)){abort('MIGRATION_RECORD_CHANGED');return}
              if(!safe()){abort('LEGACY_SOURCE_CHANGED');return}
              // Independent tabs must never run a stale action against a
              // cached snapshot from before another IDB transaction.
              if(!same(values,cache)){
                cache=values.slice();
                abort('STALE_BASELINE');
                return;
              }
              active={values:values.slice(),changed,store};
              try{
                writeStarted=true;
                result=callback();
                if(result&&typeof result.then==='function')
                  throw Error('ASYNC_TRANSACTION_CALLBACK_FORBIDDEN');
                if(!result||typeof result.ok!=='boolean')
                  throw Error('INVALID_TRANSACTION_RECEIPT');
                if(result.ok!==true&&changed.size>0)
                  throw Error('PARTIAL_TRANSACTION_NOT_ALLOWED');
                values=active.values.slice();
              }catch{abort('NORMAL_TRANSACTION_FAILED')}
              finally{active=null}
            };
          });
          tx.oncomplete=()=>{
            cache=values.slice();
            if(!safe()){invalid=true;notify({key:null});resolve(deny('POST_COMMIT_LEGACY_CHANGED'));return}
            for(const key of changed)try{channel?.postMessage({kind:'normal-updated',key})}catch{}
            resolve(result);
          };
          tx.onabort=()=>resolve(deny(reason??'NORMAL_IDB_TRANSACTION_ABORTED'));
          tx.onerror=()=>resolve(deny(reason??'NORMAL_IDB_TRANSACTION_FAILED'));
        }catch{try{tx?.abort()}catch{}resolve(deny('NORMAL_IDB_TRANSACTION_FAILED'))}
      });
    }
    const locks={
      isIndexedDBNormalLock:true,
      runNormalTransaction:lockedWrite,
      request(name,options,callback){
        if(name!==NORMAL_SAVE_LOCK_NAME||options?.mode!=='exclusive'||
          typeof callback!=='function')
          return Promise.resolve(deny('INVALID_NORMAL_IDB_LOCK'));
        return lockedWrite(()=>callback({name,mode:'exclusive'}));
      }
    };
    return {backend:'indexeddb',storage,locks,refresh,
      subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener)}};
  }catch{
    try{db?.close()}catch{}
    return readonly;
  }
}
