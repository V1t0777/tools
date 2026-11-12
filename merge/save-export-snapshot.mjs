/**
 * P2.65v: read-only last-moment check that an export still represents the
 * source storage bytes. This does not lock or write localStorage; it only
 * avoids knowingly downloading an obsolete cross-tab snapshot.
 */
export function isPreparedExportUnchanged(prepared,readRaw){
  if(prepared?.ok!==true||typeof prepared.content!=='string'||
      typeof readRaw!=='function')return false;
  let expected=prepared.content;
  if(prepared.wrapped===true){
    try{
      const envelope=JSON.parse(prepared.content);
      if(envelope?.format!=='yunyu-normal-raw-utf16-v1'||
          typeof envelope.raw!=='string')return false;
      expected=envelope.raw;
    }catch{return false;}
  }
  try{return readRaw()===expected;}
  catch{return false;}
}
