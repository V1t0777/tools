/** Durable, single-pending-operation journal for private story pair backup.
 * Uses IndexedDB readwrite transactions rather than Web Locks held across HTTP.
 * An uncertain response can only be retried with the SAME operation UUID.
 */
import {validStoryPair,normalizeStoryPairCommit} from './story-pair-authority.mjs';

const DB='yunyu-story-cloud-intents-v1';
const TABLE='per-account-intents';
const UID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reject=code=>Object.freeze({ok:false,code});
const copy=x=>structuredClone(x);
const valid=x=>!!x&&x.version===1&&UID.test(x.uid)&&
  Number.isInteger(x.attempts)&&x.attempts>=0&&x.attempts<100001&&
  Array.isArray(x.localRaw)&&x.localRaw.length===2&&
  x.localRaw.every(raw=>raw===null||typeof raw==='string'&&raw.length<=160000)&&
  normalizeStoryPairCommit({
    operationId:x.operationId,expectedRevision:x.expectedRevision,pair:x.pair
  })!==null;
function openDB(factory){
  return new Promise((resolve,reject)=>{
    let req,finished=false;
    const timeout=setTimeout(()=>finish(Error('STORY_JOURNAL_OPEN_TIMEOUT')),8000);
    function finish(err,db){
      if(finished){try{db?.close()}catch{}return}
      finished=true;clearTimeout(timeout);
      if(err)reject(err);else resolve(db);
    }
    try{req=factory.open(DB,1)}catch(error){finish(error);return}
    req.onupgradeneeded=()=>{
      if(!req.result.objectStoreNames.contains(TABLE))req.result.createObjectStore(TABLE);
    };
    req.onerror=()=>finish(req.error??Error('STORY_JOURNAL_OPEN_FAILED'));
    req.onblocked=()=>finish(Error('STORY_JOURNAL_UPGRADE_BLOCKED'));
    req.onsuccess=()=>finish(null,req.result);
  });
}
export async function openStoryIntentJournal({uid,indexedDB}={}){
  if(typeof uid!=='string'||!UID.test(uid)||typeof indexedDB?.open!=='function')
    throw Error('STORY_JOURNAL_UNAVAILABLE');
  const key=uid.toLowerCase();
  const db=await openDB(indexedDB);
  let closed=false;
  db.onversionchange=()=>{closed=true;db.close()};
  function transaction(mode,transform){
    if(closed)return Promise.reject(Error('STORY_JOURNAL_CLOSED'));
    return new Promise((resolve,reject)=>{
      let tx,store,result;
      try{
        tx=db.transaction(TABLE,mode);
        store=tx.objectStore(TABLE);
        store.get(key).onsuccess=event=>{
          let saved=event.target.result??null;
          if(saved!==null&&(!valid(saved)||saved.uid!==key)){
            try{tx.abort()}catch{};return;
          }
          try{
            result=transform(saved,store);
            if(result&&typeof result.then==='function')
              throw Error('STORY_JOURNAL_CALLBACK_MUST_BE_SYNC');
          }catch{try{tx.abort()}catch{}}
        };
        tx.oncomplete=()=>resolve(result);
        tx.onabort=()=>reject(Error('STORY_JOURNAL_INVALID_OR_ABORTED'));
        tx.onerror=()=>reject(tx.error??Error('STORY_JOURNAL_TRANSACTION_FAILED'));
      }catch(error){try{tx?.abort()}catch{}reject(error)}
    });
  }
  return Object.freeze({
    async read(){return transaction('readonly',saved=>saved?copy(saved):null)},
    async prepare({operationId,expectedRevision,pair,localRaw}={}){
      const cmd=normalizeStoryPairCommit({operationId,expectedRevision,pair});
      if(!cmd||!Array.isArray(localRaw)||localRaw.length!==2||
         !localRaw.every(x=>x===null||typeof x==='string'&&x.length<=160000))
        return reject('INVALID_STORY_INTENT');
      return transaction('readwrite',(existing,store)=>{
        if(existing)return reject('PENDING_STORY_INTENT_EXISTS');
        const next={version:1,uid:key,operationId:cmd.operationId,
          expectedRevision:cmd.expectedRevision,pair:cmd.pair,
          localRaw:copy(localRaw),attempts:0};
        if(!valid(next))return reject('INVALID_STORY_INTENT');
        store.put(next,key);return {ok:true,intent:copy(next)};
      });
    },
    async beginAttempt(operationId){
      return transaction('readwrite',(saved,store)=>{
        if(!saved||saved.operationId!==operationId||saved.attempts>=100000)
          return reject('STORY_INTENT_MISMATCH');
        const next={...saved,attempts:saved.attempts+1};
        store.put(next,key);
        return {ok:true,intent:copy(next)};
      });
    },
    async acknowledge(operationId){
      return transaction('readwrite',(saved,store)=>{
        if(!saved||saved.operationId!==operationId)return reject('STORY_INTENT_MISMATCH');
        if(saved.attempts<1)return reject('STORY_INTENT_NOT_SENT');
        store.delete(key);return {ok:true};
      });
    },
    async discardUnsent({confirmedByUser=false}={}){
      if(!confirmedByUser)return reject('STORY_CONFIRMATION_REQUIRED');
      return transaction('readwrite',(saved,store)=>{
        if(!saved)return {ok:true,changed:false};
        if(saved.attempts>0)return reject('STORY_REMOTE_OUTCOME_UNKNOWN');
        store.delete(key);return {ok:true,changed:true};
      });
    }
  });
}
