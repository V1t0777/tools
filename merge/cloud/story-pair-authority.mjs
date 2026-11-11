/** Private four-account STORY backup authority.
 * Story workshop is an independent story-only sandbox, not the authoritative
 * normal economy. Never transfer its coins, energy or items to normal mode.
 */
import {validateStoryProgress} from '../mode-boundaries.mjs';
import {validateSave} from '../engine.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const exact=(o,keys)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const fail=(code,status='rejected')=>({ok:false,status,code});
const copy=v=>structuredClone(v);

export function validStoryPair(pair){
  if(!exact(pair,['progress','workshop'])||
    !validateStoryProgress(pair.progress)||!validateSave(pair.workshop))return false;
  try{
    const raw=JSON.stringify(pair);
    return raw.length<=300000&&new TextEncoder().encode(raw).length<=1200000;
  }catch{return false}
}
export function normalizeStoryPairCommit(command){
  if(!exact(command,['operationId','expectedRevision','pair'])||
     typeof command.operationId!=='string'||!UUID.test(command.operationId)||
     !Number.isSafeInteger(command.expectedRevision)||command.expectedRevision<0||
     !validStoryPair(command.pair))return null;
  return {operationId:command.operationId.toLowerCase(),
    expectedRevision:command.expectedRevision,pair:copy(command.pair)};
}
export async function hashStoryPairCommit(command){
  const bytes=new TextEncoder().encode(JSON.stringify(command));
  const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
/** In-memory CAS repository is ONLY for tests. Real writes use SQL RPC. */
export function createInMemoryStoryPairAuthority({allowed=()=>true}={}){
  const rows=new Map(),lanes=new Map();
  const authorized=uid=>typeof uid==='string'&&UUID.test(uid)&&allowed(uid)===true;
  const serialize=async(uid,fn)=>{
    const prior=lanes.get(uid)??Promise.resolve();
    let release;const curr=new Promise(resolve=>{release=resolve});
    lanes.set(uid,curr);await prior;
    try{return await fn()}finally{release();if(lanes.get(uid)===curr)lanes.delete(uid)}
  };
  const current=uid=>rows.get(uid)??{revision:0,pair:null,operations:new Map()};
  const view=(row,status='ok')=>({ok:true,status,revision:row.revision,pair:copy(row.pair)});
  return Object.freeze({
    async read(uid){
      if(!authorized(uid))return fail('CLOUD_ACCESS_DENIED');
      return serialize(uid,()=>view(current(uid),rows.has(uid)?'ok':'empty'));
    },
    async commit(uid,candidate){
      if(!authorized(uid))return fail('CLOUD_ACCESS_DENIED');
      const command=normalizeStoryPairCommit(candidate);
      if(!command)return fail('BAD_STORY_SNAPSHOT');
      const hash=await hashStoryPairCommit(command);
      return serialize(uid,()=>{
        const row=current(uid),previous=row.operations.get(command.operationId);
        if(previous){
          if(previous!==hash)return fail('OPERATION_ID_REUSE');
          return view(row,'replayed');
        }
        if(row.revision!==command.expectedRevision)
          return {...view(row,'conflict'),ok:false,code:'REVISION_CONFLICT'};
        if(row.pair){
          if(command.pair.progress.revision<row.pair.progress.revision||
             command.pair.workshop.revision<row.pair.workshop.revision)
            return {...view(row,'rejected'),ok:false,code:'STORY_ROLLBACK_FORBIDDEN'};
        }
        row.revision++;
        row.pair=copy(command.pair);
        row.operations.set(command.operationId,hash);
        rows.set(uid,row);
        return view(row,'applied');
      });
    }
  });
}
