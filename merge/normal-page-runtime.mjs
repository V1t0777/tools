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
import {coordinateNormalSaveRestore} from './save-restore-lock.mjs';
import {previewNormalSaveImport} from './save-import-preflight.mjs';
import {validateSave} from './engine.mjs';

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
    // A verified transaction receipt proves the write at its readback time.
    // The Web Lock is released before UI publication, so an old/uncoordinated
    // tab can still replace localStorage in this narrow window. Never render
    // or acknowledge a snapshot without checking its exact original bytes.
    const matches=()=>{
      try {return typeof bytes==='string' &&
        storage?.getItem(SAVE_KEY)===bytes;}
      catch {return false;}
    };
    if(!matches())throw new Error('UI_PUBLISH_BASELINE_CHANGED');
    state=next;
    raw=bytes;
    const response=onVerified?.(clone(next),bytes,kind,receipt);
    if(response&&typeof response.then==='function'){
      void Promise.resolve(response).catch(()=>{});
      throw new Error('ASYNC_UI_PUBLICATION');
    }
    // Synchronous callbacks may dispatch re-entrant storage/focus handlers.
    // Check again before allowing any new action, clock or reset.
    if(!matches())throw new Error('UI_PUBLISH_BASELINE_CHANGED');
  };
  const run=async(kind,transaction)=>{
    if(phase!=='ready'||flight.blocked||resetBusy)
      return reject(flight.busy||resetBusy?'UI_TRANSACTION_BUSY':
        phase==='blocked'?'UI_SAVE_BLOCKED':'STARTUP_REQUIRED');
    // Capture only the transaction receipt for the currently active flight.
    // Metadata is returned AFTER a verified synchronous UI publication, never
    // from an uncertain write or an invalidated/busy operation.
    let receipt;
    const result=await flight.run(async()=>{
      receipt=await transaction();
      return receipt;
    },(next,bytes,verified)=>publish(kind,next,bytes,verified));
    if(!result.ok&&flight.blocked)block(result.reason||'SAVE_UNCERTAIN');
    if(!result.ok) {
      // Engine rejection is a definite no-write outcome. Preserve its
      // bounded, user-facing reason without exposing an unverified snapshot.
      if(kind==='action'&&result.reason==='ACTION_REJECTED'&&
          typeof receipt?.message==='string')
        return Object.freeze({...result,message:receipt.message.slice(0,200)});
      return result;
    }
    if(kind==='action')return Object.freeze({...result,
      message:typeof receipt?.message==='string'?receipt.message.slice(0,200):''});
    if(kind==='clock')return Object.freeze({...result,
      changed:receipt?.changed===true});
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
      let receipt;
      const result=await flight.run(
        async()=>{
          receipt=await prepareNormalStartupWithLock(locks,storage,{now});
          return receipt;
        },
        (next,bytes,verified)=>{
          publish('startup',next,bytes,verified);
          phase='ready';
          reason=null;
        });
      if(!result.ok){
        if(flight.blocked)block(result.reason||'STARTUP_UNCERTAIN');
        else phase='cold';
        return result;
      }
      // These booleans are trustworthy only after the readback and
      // synchronous publication have both passed.
      return Object.freeze({...result,
        recovered:receipt?.recovered===true,
        migrated:receipt?.migrated===true});
    },

    action(operation) {
      if(typeof operation!=='function')return Promise.resolve(reject('INVALID_ACTION'));
      const expectedRaw=raw,startedAt=epoch;
      return run('action',()=>commitNormalActionWithLock(locks,storage,
        {expectedRaw,action:operation,
          canCommit:()=>phase==='ready'&&!flight.blocked&&
            !resetBusy&&epoch===startedAt}));
    },

    clock({now=Date.now()}={}) {
      const expectedRaw=raw,startedAt=epoch;
      return run('clock',()=>commitNormalClockWithLock(locks,storage,
        {expectedRaw,now,
          canCommit:()=>phase==='ready'&&!flight.blocked&&
            !resetBusy&&epoch===startedAt}));
    },

    async reset({confirmed=false,expectedRaw,requireOriginalBackup=false,
      now=Date.now()}={}) {
      if(confirmed!==true)return reject('RESET_NOT_CONFIRMED');
      if(phase==='starting'||phase==='cold'||flight.busy||resetBusy)
        return reject('UI_TRANSACTION_BUSY');
      const hadConflict=phase==='blocked';
      // A conflict or uncertain write must NEVER be reset from a caller-
      // supplied new baseline. Only known malformed original bytes can be
      // preserved and explicitly reset without reloading the page.
      if(hadConflict&&reason!=='CORRUPT_SAVE'&&
          reason!=='UNSUPPORTED_OR_CORRUPT_SAVE')
        return reject('BLOCKED_RESET_REQUIRES_RELOAD');
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
          requireOriginalBackup:hadConflict||requireOriginalBackup,now,
          canCommit:()=>phase==='resetting'&&resetBusy&&epoch===begin});
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

    // Restore a previously previewed file using the same exclusive Web Lock
    // as all other writers. Never replace the reviewed raw baseline silently.
    async restore(fileText,{expectedRaw,confirmed=false,allowDowngrade=false,signal}={}) {
      if(confirmed!==true)return reject('CONFIRMATION_REQUIRED');
      if(phase!=='ready'||flight.blocked)
        return reject(phase==='blocked'?'UI_SAVE_BLOCKED':'STARTUP_REQUIRED');
      if(flight.busy||resetBusy)return reject('UI_TRANSACTION_BUSY');
      if(typeof expectedRaw!=='string'||expectedRaw!==raw)
        return reject('STALE_BASELINE');
      const preview=previewNormalSaveImport(fileText,storage,{expectedRaw});
      if(!preview.ok){
        if(preview.reason==='CURRENT_SAVE_CHANGED')block(preview.reason);
        return reject(preview.reason);
      }
      if(preview.wouldDecreaseRevision&&allowDowngrade!==true)
        return reject('DOWNGRADE_CONFIRMATION_REQUIRED');
      if(signal?.aborted)return reject('RESTORE_CANCELLED_BEFORE_WRITE');
      const restoreEpoch=epoch;
      // Re-check after lock acquisition: invalidated UI confirmation must
      // never reserve a backup or write even if the Web Lock arrived late.
      const canCommit=()=>phase==='ready'&&!flight.blocked&&!resetBusy&&
        epoch===restoreEpoch&&signal?.aborted!==true;
      return run('restore',async()=>{
        const receipt=await coordinateNormalSaveRestore(fileText,storage,locks,
          {expectedRaw,confirmed:true,allowDowngrade,canCommit});
        if(!receipt.ok)return receipt;
        // A noncooperating tab can write after lock release; verify again
        // before publishing any restored snapshot.
        try{
          if(storage.getItem(SAVE_KEY)!==fileText)
            return reject('RESTORE_OUTCOME_UNCERTAIN');
          const restored=JSON.parse(fileText);
          if(!validateSave(restored))
            return reject('RESTORE_OUTCOME_UNCERTAIN');
          return Object.freeze({...receipt,raw:fileText,state:restored,
            verifiedReadback:true});
        }catch{return reject('RESTORE_OUTCOME_UNCERTAIN');}
      });
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
      } catch {
        // A publication callback can race a second tab's write. Keep the
        // precise cross-tab conflict reason from the existing contract,
        // rather than masking a changed raw baseline as a rendering error.
        let changed=false;
        try {changed=storage.getItem(SAVE_KEY)!==fresh.raw;}
        catch {changed=true;}
        const why=changed?'CURRENT_SAVE_CHANGED':'UI_PUBLISH_FAILED';
        block(why);
        return reject(why);
      }
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
