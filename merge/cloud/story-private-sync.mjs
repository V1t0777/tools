/** Explicit private story cloud backup/restore.
 * Two local keys are always captured under the same story write boundary.
 * Neither operation grants normal-mode resources or auto-overwrites local saves.
 */
import {STORY_SAVE_KEY,createEmptyStoryProgress} from '../mode-boundaries.mjs';
import {STORY_WORKSHOP_KEY} from '../story/workshop-storage.mjs';
import {createInitialState} from '../engine.mjs';
import {validStoryPair,normalizeStoryPairCommit} from './story-pair-authority.mjs';
import {pinnedSupabaseProjectOrigin,verifyCloudIdentity,CloudAuthError} from './http-transport.mjs';
import {openStoryIntentJournal} from './story-intent-journal.mjs';

const LOCK='toolbox.merge-isle.story.write.'+STORY_SAVE_KEY;
const keys=[STORY_SAVE_KEY,STORY_WORKSHOP_KEY];
const same=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===2&&
  b.length===2&&a.every((value,i)=>value===b[i]);
const reject=code=>Object.freeze({ok:false,code});
const clone=v=>structuredClone(v);
export async function captureLocalStoryPair(persistence,{now=Date.now()}={}){
  if(!persistence?.storage||typeof persistence?.locks?.request!=='function')
    return reject('STORY_LOCAL_BACKEND_UNAVAILABLE');
  let raw=null;
  try{
    const received=await persistence.locks.request(LOCK,{mode:'exclusive'},()=>{
      raw=keys.map(key=>persistence.storage.getItem(key));
      return true;
    });
    if(received!==true||!raw||!raw.every(x=>x===null||typeof x==='string'))
      return reject('STORY_LOCAL_UNVERIFIED');
    const pair={
      progress:raw[0]===null?createEmptyStoryProgress():JSON.parse(raw[0]),
      workshop:raw[1]===null?createInitialState(now):JSON.parse(raw[1])
    };
    if(!validStoryPair(pair))return reject('STORY_LOCAL_CORRUPT');
    return {ok:true,raw,pair,wasEmpty:raw.every(x=>x===null)};
  }catch{return reject('STORY_LOCAL_UNVERIFIED')}
}
export async function restoreDownloadedStoryPair({
  persistence,pair,expectedRaw,backupDownloaded=false,confirmedByUser=false
}={}){
  if(!confirmedByUser||!backupDownloaded)
    return reject('STORY_BACKUP_AND_CONFIRMATION_REQUIRED');
  if(persistence?.backend!=='indexeddb'||!validStoryPair(pair)||
     !Array.isArray(expectedRaw)||expectedRaw.length!==2)
    return reject('STORY_ATOMIC_BACKEND_REQUIRED');
  try{
    const ok=await persistence.locks.request(LOCK,{mode:'exclusive'},()=>{
      const current=keys.map(key=>persistence.storage.getItem(key));
      if(!same(current,expectedRaw))return false;
      persistence.storage.setItem(STORY_SAVE_KEY,JSON.stringify(pair.progress));
      persistence.storage.setItem(STORY_WORKSHOP_KEY,JSON.stringify(pair.workshop));
      return true;
    });
    return ok===true?{ok:true}:reject('STORY_LOCAL_CHANGED');
  }catch{return reject('STORY_RESTORE_FAILED')}
}
export async function openPrivateStoryCloudSession({
  projectUrl,publishableKey,auth,localPersistence,indexedDB,
  fetchImpl=globalThis.fetch,makeId=()=>globalThis.crypto.randomUUID()
}={}){
  const {uid}=await verifyCloudIdentity(auth);
  const origin=pinnedSupabaseProjectOrigin(projectUrl);
  if(typeof publishableKey!=='string'||publishableKey.length<12||
     publishableKey.length>4096||typeof fetchImpl!=='function')
    throw Error('INVALID_STORY_CLOUD_TRANSPORT');
  const journal=await openStoryIntentJournal({uid,indexedDB});
  async function remote(body){
    const who=await verifyCloudIdentity(auth);
    if(who.uid!==uid)throw new CloudAuthError('CLOUD_AUTH_UNVERIFIED');
    const encoded=JSON.stringify(body);
    if(new TextEncoder().encode(encoded).length>1250000)
      throw Error('STORY_REQUEST_TOO_LARGE');
    const response=await fetchImpl(origin+'/functions/v1/merge-story',{
      method:'POST',redirect:'error',credentials:'omit',cache:'no-store',
      headers:{'Content-Type':'application/json','Accept':'application/json',
        'apikey':publishableKey,Authorization:'Bearer '+who.token},
      body:encoded
    });
    if(response?.status===401||response?.status===403)
      throw new CloudAuthError('CLOUD_ACCESS_DENIED');
    if(!response||![200,409].includes(response.status))
      throw Error('STORY_REMOTE_UNAVAILABLE');
    if(!/^application\/json(?:;|$)/i.test(response.headers?.get?.('content-type')??''))
      throw Error('STORY_BAD_RESPONSE');
    const raw=await response.text();
    if(raw.length<2||raw.length>350000)throw Error('STORY_BAD_RESPONSE');
    const result=JSON.parse(raw);
    if(!result||typeof result!=='object'||Array.isArray(result)||
      !Number.isSafeInteger(result.revision)||result.revision<0||
      !['empty','ok','applied','replayed','conflict','rejected'].includes(result.status)||
      (result.pair!==null&&!validStoryPair(result.pair)))
      throw Error('STORY_BAD_RESPONSE');
    return result;
  }
  const local=()=>captureLocalStoryPair(localPersistence);
  return Object.freeze({
    uid,
    inspectLocal:local,
    readRemote:()=>remote({mode:'read'}),
    pending:()=>journal.read(),
    discardUnsent:opts=>journal.discardUnsent(opts),
    async prepareUpload({confirmedByUser=false,reviewedLocalRaw,
      expectedRemoteRevision,allowReplace=false}={}){
      if(!confirmedByUser||!Number.isSafeInteger(expectedRemoteRevision)||
         expectedRemoteRevision<0||!Array.isArray(reviewedLocalRaw))
        return reject('STORY_REVIEW_REQUIRED');
      const existing=await journal.read();
      if(existing)return reject('PENDING_STORY_INTENT_EXISTS');
      const before=await local();
      if(!before.ok)return before;
      if(!same(before.raw,reviewedLocalRaw))return reject('STORY_LOCAL_CHANGED');
      const live=await remote({mode:'read'});
      if(!live.ok||live.revision!==expectedRemoteRevision)
        return reject('STORY_REMOTE_CHANGED');
      if(live.pair!==null&&!allowReplace)
        return reject('EXISTING_CLOUD_SAVE_REQUIRES_REVIEW');
      const id=makeId();
      const cmd=normalizeStoryPairCommit({operationId:id,
        expectedRevision:expectedRemoteRevision,pair:before.pair});
      if(!cmd)return reject('STORY_UPLOAD_INVALID');
      return journal.prepare({...cmd,localRaw:before.raw});
    },
    async sendPending(){
      // Mark as attempted durably BEFORE a network call. A lost ACK can only
      // be retried using the original operation ID, even across page restarts.
      const saved=await journal.read();
      if(!saved)return reject('NO_PENDING_STORY_UPLOAD');
      const marked=await journal.beginAttempt(saved.operationId);
      if(!marked.ok)return marked;
      let result;
      try{
        result=await remote({mode:'commit',operationId:saved.operationId,
          expectedRevision:saved.expectedRevision,pair:saved.pair});
      }catch{return reject('STORY_REMOTE_OUTCOME_UNKNOWN')}
      if(result.ok===true&&['applied','replayed'].includes(result.status)){
        const ack=await journal.acknowledge(saved.operationId);
        return ack.ok?{ok:true,status:result.status,revision:result.revision}:
          reject('STORY_ACK_PERSISTENCE_UNKNOWN');
      }
      return {ok:false,code:result.code??'STORY_CONFLICT_REVIEW_REQUIRED',
        status:result.status,remoteRevision:result.revision};
    },
    async restoreReviewedCloud({confirmedByUser=false,backupDownloaded=false,
      reviewedRemoteRevision,reviewedPair,reviewedLocalRaw}={}){
      if(!confirmedByUser||!backupDownloaded||!validStoryPair(reviewedPair)||
         !Number.isSafeInteger(reviewedRemoteRevision))
        return reject('STORY_REVIEW_REQUIRED');
      if(await journal.read())return reject('PENDING_STORY_INTENT_EXISTS');
      const live=await remote({mode:'read'});
      if(!live.ok||live.revision!==reviewedRemoteRevision||
        JSON.stringify(live.pair)!==JSON.stringify(reviewedPair))
        return reject('STORY_REMOTE_CHANGED');
      return restoreDownloadedStoryPair({persistence:localPersistence,
        pair:live.pair,expectedRaw:reviewedLocalRaw,
        confirmedByUser:true,backupDownloaded:true});
    }
  });
}
