/**
 * P3.18 server-side request-body quota for a future, UNDEPLOYED Edge endpoint.
 * Enforce byte limits DURING streaming, not after unbounded Request.text().
 * No logging, network, storage or gameplay side effects.
 */
const refusal = (code, httpStatus) => Object.freeze({ok:false,code,httpStatus});
const invalid = () => refusal('BAD_JSON',400);

export async function readBoundedJson(request,{maxBytes=4096,deadlineMs=5000}={}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes<1 || maxBytes>65536 ||
      !Number.isSafeInteger(deadlineMs) || deadlineMs<1 || deadlineMs>30000)
    throw Error('Invalid request body limits');
  if (!request || typeof request.headers?.get !== 'function') return invalid();

  let length;
  try {length=request.headers.get('content-length');}
  catch {return invalid();}
  if (length!==null) {
    if (!/^(0|[1-9][0-9]*)$/.test(length)) return refusal('BAD_CONTENT_LENGTH',400);
    // This is only an early rejection. The actual stream is still counted.
    if (length.length>15 || Number(length)>maxBytes)
      return refusal('REQUEST_TOO_LARGE',413);
  }

  let reader;
  try {reader=request.body?.getReader();}
  catch {return invalid();}
  if (!reader) return invalid();

  let timer,finished=false,total=0;
  const parts=[];
  const expired=new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(Error('Request body deadline exceeded')),deadlineMs);
  });
  try {
    for (;;) {
      const part=await Promise.race([reader.read(),expired]);
      if (!part || typeof part.done!=='boolean') return invalid();
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) return invalid();
      if (part.value.byteLength > maxBytes-total) return refusal('REQUEST_TOO_LARGE',413);
      total+=part.value.byteLength;
      parts.push(part.value);
    }
    finished=true;
    const bytes=new Uint8Array(total);
    let at=0;
    for (const part of parts) {bytes.set(part,at);at+=part.byteLength;}
    let value;
    try { value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
    catch {return invalid();}
    return Object.freeze({ok:true,value});
  } catch {
    // Deadline and transport/read exceptions all fail closed, without echoing
    // request bytes or exceptions. No downstream DB method can be called.
    return refusal('BODY_READ_UNAVAILABLE',408);
  } finally {
    clearTimeout(timer);
    if (!finished) {
      // May hang if a hostile stream never resolves cancel(): never await it.
      try {Promise.resolve(reader.cancel()).catch(()=>{});}catch{}
    }
  }
}
