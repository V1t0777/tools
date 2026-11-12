/**
 * P3.24 — bounded child-process stdout and wall-clock time for a disposable
 * LOCAL PostgreSQL probe. Never shell out, never echo database credentials,
 * SQL, subprocess stderr, or raw child exceptions to callers.
 */
import {spawn} from 'node:child_process';

export function runBoundedChild(command,args,{env,timeoutMs=15_000,maxOutputBytes=4_096}={}) {
  if (typeof command!=='string' || !command ||
      !Array.isArray(args) || args.some(arg=>typeof arg!=='string') ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs<1 || timeoutMs>60_000 ||
      !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes<1 || maxOutputBytes>65_536)
    throw Error('Invalid local subprocess limits');
  return new Promise((resolve,reject)=>{
    let child;
    try {
      child=spawn(command,args,{env,stdio:['ignore','pipe','ignore'],shell:false});
    } catch {
      reject(Error('Local database subprocess failed'));
      return;
    }
    let settled=false,failed=false,output='',outputBytes=0;
    const failure=()=>{failed=true;try{child.kill('SIGKILL');}catch{}};
    const timer=setTimeout(failure,timeoutMs);
    const finish=(code)=>{
      if(settled)return;
      settled=true;clearTimeout(timer);
      if(failed || code!==0)reject(Error('Local database subprocess failed'));
      else resolve(output.trim());
    };
    child.on('error',()=>{
      failed=true;
      // Spawn failures may not emit a close event in all adapters.
      finish(null);
    });
    child.stdout.on('data',chunk=>{
      if(failed)return;
      outputBytes+=chunk.byteLength;
      if(outputBytes>maxOutputBytes){failure();return;}
      output+=chunk.toString('utf8');
    });
    child.on('close',finish);
  });
}
