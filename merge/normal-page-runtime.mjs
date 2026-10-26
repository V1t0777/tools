/**
 * P2.61w: all ordinary-mode writers coordinated through one page runtime.
 * Draft integration layer, NOT wired into main.mjs before all page paths
 * can migrate together. Never fall back to uncoordinated localStorage writes.
 */
import {createNormalUiFlight} from './normal-ui-flight.mjs';
import {prepareNormalStartupWithLock} from './normal-startup-transaction.mjs';
import {commitNormalActionWithLock,commitNormalClockWithLock} from './normal-action-transaction.mjs';
import {commitNormalResetWithLock} from './normal-reset-transaction.mjs';
import {peekLocalV3,SAVE_KEY} from './storage.mjs';
import {isSafeSameRevisionClockUpdate} from './storage-event-policy.mjs';

const reject=reason=>Object.freeze({ok:false,reason});
const clone=value=>JSON.parse(JSON.stringify(value));
const retryable=new Set(['SAVE_LOCK_BUSY','WEB_LOCKS_UNAVAILABLE',
  'INVALID_ACTION','INVALID_CLOCK','RESET_NOT_CONFIRMED','INVALID_BACKUP_POLICY']);

export function createNormalPageRuntime({locks,storage,onVerified}={}) {
  if(onVerified!==undefined&&typeof onVerified!=='function')
    throw new TypeError('onVerified must be a function');
  let flight=createNormalUiFlight();
  let phase='cold',state=null,raw=null,reason=null,resetBusy=false,epoch=0;

  const block=why=>{
    phase='blocked';
    reason=why;
    epoch++;
    flight.block();
  };
  const publish=(kind,next,bytes,receipt)=>{
    state=next;
    raw=bytes;
    const response=onVerified?.(clone(next),bytes,kind,receipt);
    if(response&&typeof response.then==='function'){
      void Promise.resolve(response).catch(()=>{});
      throw new Error('ASYNC_UI_PUBLICATION');
    }
  };
  const run=async(kind,transaction)=>{
    if(phase!=='ready'||flight.blocked||resetBusy)
      return reject(flight.busy||resetBusy?'UI_TRANSACTION_BUSY':
        phase==='blocked'?'UI_SAVE_BLOCKED':'STARTUP_REQUIRED');
    const result=await flight.run(transaction,
      (next,bytes,receipt)=>publish(kind,next,bytes,receipt));
    if(!result.ok&&flight.blocked)block(result.reason||'SAVE_UNCERTAIN');
    return result;
  };

  return Object.freeze({
    get phase(){return phase;},
    get busy(){return flight.busy||resetBusy;},
    get blocked(){return phase==='blocked'||flight.blocked;},
    get reason(){return reason;},
    get raw(){return raw;},
    snapshot(){return state===null?null:clone(state);},

    async start({now=Date.now()}={}) {
      if(phase!=='cold')return reject('STARTUP_ALREADY_ATTEMPTED');
      phase='starting';
      const result=await flight.run(
        ()=>prepareNormalStartupWithLock(locks,storage,{now}),
        (next,bytes,receipt)=>{
          publish('startup',next,bytes,receipt);
          phase='ready';
          reason=null;
        });
      if(!result.ok){
        if(flight.blocked)block(result.reason||'STARTUP_UNCERTAIN');
        else phase='cold';
      }
      return result;
    },

    action(operation) {
      if(typeof operation!=='function')return Promise.resolve(reject('INVALID_ACTION'));
      const expectedRaw=raw;
      return run('action',()=>commitNormalActionWithLock(locks,storage,
        {expectedRaw,action:operation}));
    },

    clock({now=Date.now()}={}) {
      const expectedRaw=raw;
      return run('clock',()=>commitNormalClockWithLock(locks,storage,
        {expectedRaw,now}));
    },

    async reset({confirmed=false,expectedRaw,requireOriginalBackup=false,
      now=Date.now()}={}) {
      if(confirmed!==true)return reject('RESET_NOT_CONFIRMED');
      if(phase==='starting'||phase==='cold'||flight.busy||resetBusy)
        return reject('UI_TRANSACTION_BUSY');
      const hadConflict=phase==='blocked';
      if(hadConflict&&typeof expectedRaw!=='string')
        return reject('NO_TRUSTED_BASELINE');
      if(!hadConflict&&phase!=='ready')return reject('STARTUP_REQUIRED');
      if(!hadConflict&&expectedRaw!==undefined&&expectedRaw!==raw)
        return reject('STALE_BASELINE');
      const baseline=hadConflict?expectedRaw:raw;
      const begin=epoch,oldPhase=phase;
      phase='resetting';
      resetBusy=true;
      let receipt;
      try {
        receipt=await commitNormalResetWithLock(locks,storage,{
          expectedRaw:baseline,confirmedReset:true,
          requireOriginalBackup:hadConflict||requireOriginalBackup,now});
      } catch {receipt=reject('RESET_OUTCOME_UNCERTAIN');}
      finally {resetBusy=false;}
      if(epoch!==begin||phase==='blocked') {
        block('RESET_INVALIDATED');
        return reject('RESET_INVALIDATED');
      }
      if(!receipt?.ok){
        const why=receipt?.reason||'RESET_OUTCOME_UNCERTAIN';
        if(!retryable.has(why))block(why);
        else phase=oldPhase;
        return reject(why);
      }
      if(receipt.verifiedReadback!==true||typeof receipt.raw!=='string'||
          !receipt.state){
        block('RESET_RECEIPT_NOT_VERIFIED');
        return reject('RESET_RECEIPT_NOT_VERIFIED');
      }
      // Only a verified, user-confirmed reset may clear a blocked baseline.
      const publicationEpoch=epoch;
      flight=createNormalUiFlight();
      try {publish('reset',receipt.state,receipt.raw,receipt);}
      catch {
        block('UI_PUBLISH_FAILED');
        return reject('UI_PUBLISH_FAILED');
      }
      // The synchronous UI hook may invalidate this reset (focus/storage
      // event, re-entrant block, etc.). Never turn a blocked session ready.
      if(epoch!==publicationEpoch||phase==='blocked'||flight.blocked) {
        block('RESET_INVALIDATED');
        return reject('RESET_INVALIDATED');
      }
      phase='ready';reason=null;
      return Object.freeze({ok:true,status:'RESET_PUBLISHED',
        backupVerified:receipt.backupVerified===true});
    },

    // Storage, focus and BFCache hooks are read-only. No event writes back.
    reconcile() {
      if(phase!=='ready')return reject('STARTUP_REQUIRED');
      const fresh=peekLocalV3(storage);
      if(!fresh.ok){block(fresh.reason);return reject(fresh.reason);}
      if(fresh.raw===raw)return Object.freeze({ok:true,changed:false});
      if(flight.busy||resetBusy){
        block('CURRENT_SAVE_CHANGED');return reject('CURRENT_SAVE_CHANGED');
      }
      if(fresh.state.revision<state.revision||
        (fresh.state.revision===state.revision&&
         !isSafeSameRevisionClockUpdate(state,fresh.state))){
        block('CURRENT_SAVE_CHANGED');return reject('CURRENT_SAVE_CHANGED');
      }
      const publicationEpoch=epoch;
      try {
        // This is read-only reconciliation, NOT a lock-protected write.
        // Check again both before and after user-provided UI callbacks.
        if(storage.getItem(SAVE_KEY)!==fresh.raw) {
          block('CURRENT_SAVE_CHANGED');return reject('CURRENT_SAVE_CHANGED');
        }
        publish('external',fresh.state,fresh.raw,Object.freeze({
          ok:true,raw:fresh.raw,state:fresh.state,verifiedBaseline:true}));
        if(storage.getItem(SAVE_KEY)!==fresh.raw) {
          block('CURRENT_SAVE_CHANGED');return reject('CURRENT_SAVE_CHANGED');
        }
      } catch {block('UI_PUBLISH_FAILED');return reject('UI_PUBLISH_FAILED');}
      if(epoch!==publicationEpoch||phase!=='ready'||flight.blocked||flight.busy) {
        block('RECONCILE_INVALIDATED');
        return reject('RECONCILE_INVALIDATED');
      }
      return Object.freeze({ok:true,changed:true});
    },

    invalidate() {
      if(flight.busy||resetBusy)block('UI_TRANSACTION_INVALIDATED');
      else epoch++;
    },
    block(why='CURRENT_SAVE_CHANGED'){block(why);}
  });
}
