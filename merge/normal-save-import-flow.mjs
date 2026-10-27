/**
 * P2.65i: explicit, read-only file preflight before the existing locked restore.
 * No storage write is permitted here. The runtime owns the exclusive lock,
 * original backup, verified write and UI publication.
 */
import {previewNormalSaveImport} from './save-import-preflight.mjs';
import {MAX_LOCAL_SAVE_BYTES} from './storage.mjs';

export const MAX_NORMAL_IMPORT_FILE_BYTES=2_000_000;
const reject=reason=>Object.freeze({ok:false,reason});

export async function performNormalSaveImport({
  file,storage,runtime,confirm,isSuspended=()=>false,
  revalidate=()=>true,getEpoch=()=>0
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
      if(isSuspended()||getEpoch()!==epoch)return 'PAGE_SUSPENDED';
      if(runtime.phase!=='ready'||runtime.blocked||runtime.busy)
        return 'SAVE_NOT_READY';
      if(!revalidate()||runtime.raw!==expectedRaw)return 'SAVE_CHANGED';
      if(isSuspended()||getEpoch()!==epoch)return 'PAGE_SUSPENDED';
      return null;
    }catch{return 'SAVE_NOT_READY';}
  };
  const initial=inspect();
  if(initial)return reject(initial);
  let fileText;
  try{fileText=await file.text();}
  catch{return reject('FILE_READ_FAILED');}
  const afterRead=inspect();
  if(afterRead)return reject(afterRead);
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
