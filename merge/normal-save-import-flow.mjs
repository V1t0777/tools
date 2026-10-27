/**
 * P2.65i: explicit, read-only file preflight before the existing locked restore.
 * No storage write is permitted here. The runtime owns the exclusive lock,
 * original backup, verified write and UI publication.
 */
import {previewNormalSaveImport} from './save-import-preflight.mjs';
import {MAX_LOCAL_SAVE_BYTES} from './storage.mjs';

export const MAX_NORMAL_IMPORT_FILE_BYTES=2_000_000;
export const NORMAL_IMPORT_READ_TIMEOUT_MS=45_000;
const reject=reason=>Object.freeze({ok:false,reason});

// A native file read may never settle after iOS/WebView backgrounding.
// Expiry only ends this UI attempt; a late File.text() result cannot confirm
// or restore anything. This function never reads or writes localStorage.
function readFileWithDeadline(file,schedule,cancelSchedule,signal){
  return new Promise(resolve=>{
    let settled=false,timer,hasTimer=false;
    const finish=result=>{
      if(settled)return;
      settled=true;
      if(signal){try{signal.removeEventListener('abort',onAbort);}catch{/* Best effort. */}}
      if(hasTimer){try{cancelSchedule(timer);}catch{/* Best effort. */}}
      resolve(result);
    };
    const onAbort=()=>finish(reject('FILE_READ_CANCELLED'));
    // Native File.text cannot be forcibly canceled. End only this attempt:
    // its late result cannot preflight, confirm or restore anything.
    if(signal!==undefined){
      if(!signal||typeof signal.addEventListener!=='function'||
          typeof signal.removeEventListener!=='function'){
        finish(reject('FILE_READ_UNAVAILABLE'));return;
      }
      try{
        signal.addEventListener('abort',onAbort,{once:true});
        if(signal.aborted){onAbort();return;}
      }catch{finish(reject('FILE_READ_UNAVAILABLE'));return;}
    }
    if(typeof schedule!=='function'||typeof cancelSchedule!=='function'){
      finish(reject('FILE_READ_UNAVAILABLE'));return;
    }
    try{
      timer=schedule(()=>finish(reject('FILE_READ_TIMEOUT')),
        NORMAL_IMPORT_READ_TIMEOUT_MS);
      hasTimer=true;
    }catch{finish(reject('FILE_READ_UNAVAILABLE'));return;}
    if(settled)return;
    let pending;
    try{pending=file.text();}
    catch{finish(reject('FILE_READ_FAILED'));return;}
    Promise.resolve(pending).then(
      value=>finish({ok:true,value}),
      ()=>finish(reject('FILE_READ_FAILED')));
  });
}

export async function performNormalSaveImport({
  file,storage,runtime,confirm,isSuspended=()=>false,
  revalidate=()=>true,getEpoch=()=>0,signal,
  schedule=globalThis.setTimeout,cancelSchedule=globalThis.clearTimeout
}={}) {
  if(!file||!Number.isSafeInteger(file.size)||file.size<0)
    return reject('NO_VALID_FILE');
  if(file.size>MAX_NORMAL_IMPORT_FILE_BYTES)return reject('FILE_TOO_LARGE');
  if(typeof file.text!=='function')return reject('FILE_READER_UNAVAILABLE');
  if(typeof confirm!=='function'||typeof revalidate!=='function'||
      typeof isSuspended!=='function'||typeof getEpoch!=='function'||
      typeof runtime?.restore!=='function')
    return reject('IMPORT_UI_UNAVAILABLE');
  if(runtime.phase!=='ready'||runtime.blocked||runtime.busy||
      typeof runtime.raw!=='string')return reject('SAVE_NOT_READY');
  let epoch;
  try{epoch=getEpoch();}catch{return reject('PAGE_SUSPENDED');}
  const expectedRaw=runtime.raw;
  const inspect=()=>{
    try{
      if(signal?.aborted||isSuspended()||getEpoch()!==epoch)return 'PAGE_SUSPENDED';
      if(runtime.phase!=='ready'||runtime.blocked||runtime.busy)
        return 'SAVE_NOT_READY';
      if(!revalidate()||runtime.raw!==expectedRaw)return 'SAVE_CHANGED';
      if(signal?.aborted||isSuspended()||getEpoch()!==epoch)return 'PAGE_SUSPENDED';
      return null;
    }catch{return 'SAVE_NOT_READY';}
  };
  const initial=inspect();
  if(initial)return reject(initial);
  const read=await readFileWithDeadline(file,schedule,cancelSchedule,signal);
  const afterRead=inspect();
  if(afterRead)return reject(afterRead);
  if(!read.ok)return read;
  const fileText=read.value;
  if(typeof fileText!=='string'||!fileText.length)
    return reject('EMPTY_OR_NON_TEXT_FILE');
  if(fileText.length>MAX_LOCAL_SAVE_BYTES)return reject('FILE_TOO_LARGE');
  const preview=previewNormalSaveImport(fileText,storage,{expectedRaw});
  if(!preview.ok)return preview;
  // Explicitly describe destructive replacement and preserved backup.
  const message=`即将用所选普通模式存档（修订 ${preview.sourceRevision}）替换当前进度（修订 ${preview.currentRevision}）。\n恢复前原始存档将保留在独立备份槽；若备份槽存在不同内容则拒绝恢复。\n请先确认已导出当前原始存档，是否继续？`;
  try{if(confirm(message)!==true)return reject('USER_CANCELLED');}
  catch{return reject('USER_CANCELLED');}
  const afterConfirm=inspect();
  if(afterConfirm)return reject(afterConfirm);
  if(preview.wouldDecreaseRevision){
    try{
      if(confirm('所选存档修订号更低，恢复将回退普通模式进度。确定允许降级恢复吗？')!==true)
        return reject('DOWNGRADE_CANCELLED');
    }catch{return reject('DOWNGRADE_CANCELLED');}
    const afterDowngrade=inspect();
    if(afterDowngrade)return reject(afterDowngrade);
  }
  try{
    return await runtime.restore(fileText,{expectedRaw,confirmed:true,
      allowDowngrade:preview.wouldDecreaseRevision});
  }catch{return reject('RESTORE_OUTCOME_UNCERTAIN');}
}
