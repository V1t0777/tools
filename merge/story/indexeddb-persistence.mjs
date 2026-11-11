/**
 * Offline story-only IndexedDB backend. It is selected when native Web Locks
 * are absent or this origin has already migrated. Both story keys live in ONE
 * readwrite object-store transaction; localStorage is retained as legacy
 * backup, never a second writable source of truth.
 */
import {STORY_SAVE_KEY} from '../mode-boundaries.mjs';
import {STORY_WORKSHOP_KEY} from './workshop-storage.mjs';

export const STORY_IDB_MARKER='toolbox.merge-isle.story.persistence.v2';
export const STORY_IDB_MODE='indexeddb-v1';
const DB_NAME='yunyu-story-offline-v1';
const TABLE='story-records';
const META='__legacy_snapshot_v1__';
const KEYS=[STORY_SAVE_KEY,STORY_WORKSHOP_KEY];
const LOCK_NAME='toolbox.merge-isle.story.write.'+STORY_SAVE_KEY;

function readLegacy(storage){
  if(typeof storage?.getItem!=='function'||typeof storage?.setItem!=='function')
    throw Error('Legacy storage unavailable');
  return KEYS.map(key=>storage.getItem(key));
}
function same(a,b){return a.length===b.length&&a.every((value,i)=>value===b[i]);}
function openDatabase(indexedDB){
  return new Promise((resolve,reject)=>{
    let request,finished=false;
    const timeout=setTimeout(()=>finish(new Error('IndexedDB open timeout')),8000);
    function finish(err,db){
      if(finished){try{db?.close();}catch{}return;}
      finished=true;clearTimeout(timeout);
      if(err)reject(err);else resolve(db);
    }
    try{request=indexedDB.open(DB_NAME,1);}
    catch(error){finish(error);return;}
    request.onupgradeneeded=()=>{
      if(!request.result.objectStoreNames.contains(TABLE))
        request.result.createObjectStore(TABLE);
    };
    request.onblocked=()=>finish(new Error('IndexedDB upgrade blocked'));
    request.onerror=()=>finish(request.error??Error('IndexedDB open failed'));
    request.onsuccess=()=>finish(null,request.result);
  });
}
function loadTwo(db){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(TABLE,'readonly'),store=tx.objectStore(TABLE);
    const values=[],reqs=KEYS.map(key=>store.get(key));
    reqs.forEach((request,i)=>{request.onsuccess=()=>{values[i]=request.result??null;};});
    tx.oncomplete=()=>resolve(values);
    tx.onerror=()=>reject(tx.error??Error('Read transaction failed'));
    tx.onabort=()=>reject(tx.error??Error('Read transaction aborted'));
  });
}
function initialize(db,legacy,storage){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(TABLE,'readwrite'),store=tx.objectStore(TABLE);
    let baseline=null;
    const fail=()=>{try{tx.abort();}catch{}};
    store.get(META).onsuccess=event=>{
      const stored=event.target.result;
      if(stored!==undefined){
        if(stored?.version!==1||!Array.isArray(stored?.legacy)||
           stored.legacy.length!==KEYS.length||!same(stored.legacy,legacy)){
          fail();return;
        }
        baseline=stored.legacy;
        return;
      }
      // A database with records but missing migration metadata must never
      // be silently reinitialized from an older localStorage backup.
      const prior=KEYS.map(key=>store.get(key));
      let pending=prior.length,occupied=false;
      prior.forEach(request=>{request.onsuccess=()=>{
        if(request.result!==undefined)occupied=true;
        if(--pending!==0)return;
        if(occupied){fail();return;}
        try{
          if(!same(readLegacy(storage),legacy)){fail();return;}
          for(let i=0;i<KEYS.length;i++)
            if(legacy[i]!==null)store.put(legacy[i],KEYS[i]);
          store.put({legacy,version:1},META);
          baseline=legacy;
        }catch{fail();}
      };});
    };
    tx.oncomplete=()=>resolve(baseline);
    tx.onerror=()=>reject(tx.error??Error('Migration failed'));
    tx.onabort=()=>reject(tx.error??Error('Migration conflict'));
  });
}
export function legacyStoryMode(storage){
  try{return storage?.getItem?.(STORY_IDB_MARKER)??null;}
  catch{return 'unavailable';}
}
/**
 * For a native-Web-Locks browser without the migration marker, preserve the
 * existing and tested localStorage protocol. After migration, use IndexedDB
 * even if Web Locks later becomes available, avoiding two active backends.
 */
export async function openStoryPersistence({
  legacyStorage,nativeLocks,indexedDB,Channel
}={}){
  const mode=legacyStoryMode(legacyStorage);
  const standard={storage:legacyStorage,locks:nativeLocks??null,backend:'legacy'};
  if(mode===null&&typeof nativeLocks?.request==='function')return standard;
  const readonly={storage:legacyStorage,locks:null,backend:'read-only'};
  if(mode!=='unavailable'&&mode!==null&&mode!==STORY_IDB_MODE)return readonly;
  if(mode==='unavailable'||!indexedDB||typeof indexedDB.open!=='function')return readonly;
  let legacy;
  try{
    legacy=readLegacy(legacyStorage);
    if(mode===null){
      // Pin mode BEFORE migration so other updated tabs refuse legacy writes.
      legacyStorage.setItem(STORY_IDB_MARKER,STORY_IDB_MODE);
      if(legacyStoryMode(legacyStorage)!==STORY_IDB_MODE)throw Error('marker unreadable');
    }
  }catch{return readonly;}
  let db;
  try{
    db=await openDatabase(indexedDB);
    const baseline=await initialize(db,legacy,legacyStorage);
    if(!baseline)throw Error('Incomplete migration');
    let cache=await loadTwo(db),active=null,invalid=false;
    const listeners=new Set();
    const safe=()=>{
      try{return !invalid&&legacyStoryMode(legacyStorage)===STORY_IDB_MODE&&
        same(readLegacy(legacyStorage),baseline);}
      catch{return false;}
    };
    const notify=event=>{for(const listener of listeners){try{listener(event);}catch{}}};
    const storage={
      getItem(key){
        const index=KEYS.indexOf(key);
        if(index<0)throw Error('Story backend refuses an unrelated save key');
        return active?active.values[index]:cache[index];
      },
      setItem(key,value){
        const index=KEYS.indexOf(key);
        if(!active||index<0||typeof value!=='string')
          throw Error('Write requires a story IndexedDB transaction');
        active.values[index]=value;
        active.changed.add(key);
        active.store.put(value,key);
      }
    };
    let channel=null;
    try{
      if(typeof Channel==='function'){
        channel=new Channel('yunyu-story-saves-v1');
        channel.onmessage=event=>{
          if(event?.data?.kind==='story-updated'&&KEYS.includes(event.data.key))
            void refresh().catch(()=>{invalid=true;notify({key:null});});
        };
      }
    }catch{channel=null;}
    db.onversionchange=()=>{invalid=true;db.close();notify({key:null});};
    async function refresh(){
      if(!safe()){invalid=true;notify({key:null});return false;}
      const next=await loadTwo(db),previous=cache;
      cache=next;
      for(let i=0;i<KEYS.length;i++)if(next[i]!==previous[i])
        notify({key:KEYS[i],oldValue:previous[i],newValue:next[i]});
      return true;
    }
    const locks={isIndexedDBStoryLock:true,request(name,options,write){
      if(name!==LOCK_NAME||options?.mode!=='exclusive'||typeof write!=='function')
        return Promise.reject(Error('Invalid IndexedDB story lock'));
      if(!safe())return Promise.reject(Error('Legacy story source changed'));
      return new Promise((resolve,reject)=>{
        let tx,store,views=[],result=false,changed=new Set();
        try{
          tx=db.transaction(TABLE,'readwrite');
          store=tx.objectStore(TABLE);
          const requests=[...KEYS.map(key=>store.get(key)),store.get(META)];
          let pending=requests.length,metadata;
          requests.forEach((request,i)=>{request.onsuccess=()=>{
            if(i<KEYS.length)views[i]=request.result??null;
            else metadata=request.result;
            if(--pending!==0)return;
            // The metadata is part of the same serializable transaction.
            // Missing/replaced migration records must never authorize writes.
            if(metadata?.version!==1||!Array.isArray(metadata.legacy)||
              !same(metadata.legacy,baseline)){try{tx.abort();}catch{}return;}
            // Re-read under the serialized transaction. A stale tab never
            // commits a write derived from a different stored snapshot.
            if(!safe()){try{tx.abort();}catch{}return;}
            if(!same(views,cache)){cache=views.slice();try{tx.abort();}catch{}return;}
            active={values:views.slice(),changed,store};
            try{
              result=write();
              if(result&&typeof result.then==='function')
                throw Error('Async callbacks are forbidden inside IDB transactions');
              if(result!==true&&changed.size>0)
                throw Error('Partial write rejected');
              views=active.values.slice();
            }catch(error){try{tx.abort();}catch{}}
            finally{active=null;}
          };});
          tx.oncomplete=()=>{
            cache=views.slice();
            if(result===true)for(const key of changed)
              try{channel?.postMessage({kind:'story-updated',key});}catch{}
            resolve(result);
          };
          tx.onabort=()=>reject(tx.error??Error('IndexedDB transaction rejected'));
          tx.onerror=()=>reject(tx.error??Error('IndexedDB transaction failed'));
        }catch(error){try{tx?.abort();}catch{}reject(error);}
      });
    }};
    return {storage,locks,backend:'indexeddb',refresh,
      subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);}};
  }catch{
    try{db?.close();}catch{}
    return readonly;
  }
}
