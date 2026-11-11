/** Private old-normal-save review manifest. Offline only. No network calls,
 * currency grants, or local save writes. Hash the exact original JSON bytes.
 * A trusted administrator MUST inspect and approve a matching server-side
 * grant before any migration is possible.
 */
import {peekLocalV3,MAX_LOCAL_SAVE_BYTES} from '../storage.mjs';

export async function createNormalMigrationManifest(storage){
  const inspected=peekLocalV3(storage);
  if(!inspected.ok)return {ok:false,code:inspected.reason};
  const {raw,state}=inspected;
  if(typeof raw!=='string'||raw.length>MAX_LOCAL_SAVE_BYTES)
    return {ok:false,code:'MIGRATION_SAVE_TOO_LARGE'};
  if(!globalThis.crypto?.subtle)
    return {ok:false,code:'SHA256_UNAVAILABLE'};
  try{
    const bytes=new TextEncoder().encode(raw);
    const hashed=await globalThis.crypto.subtle.digest('SHA-256',bytes);
    const sha256=Array.from(new Uint8Array(hashed),x=>x.toString(16).padStart(2,'0')).join('');
    if(storage.getItem('toolbox.merge-isle.local.v1')!==raw)
      return {ok:false,code:'MIGRATION_SOURCE_CHANGED'};
    return {ok:true,kind:'yunyu-normal-migration-review-v1',
      raw,sha256,bytes:bytes.length,
      revision:state.revision,coins:state.coins,xp:state.xp};
  }catch{return {ok:false,code:'MIGRATION_SOURCE_UNAVAILABLE'}}
}
