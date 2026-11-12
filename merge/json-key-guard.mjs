/** Bounded, read-only JSON key uniqueness scan; preserve raw original bytes. */
export function inspectNormalJsonKeys(raw,{maxLength=160_000,maxDepth=128,maxKeys=8192}={}){
  if(typeof raw!=='string'||!raw.length||raw.length>maxLength)
    return Object.freeze({ok:false,reason:'JSON_KEY_SCAN_LIMIT'});
  let i=0,keys=0,duplicate=false;
  const error=()=>{throw Error('INVALID_OR_UNBOUNDED_JSON');};
  const ws=()=>{while(i<raw.length&&/[\t\r\n ]/.test(raw[i]))i++;};
  function str(){
    if(raw[i]!=='"')error();
    const start=i++;
    while(i<raw.length){
      const c=raw[i++];
      if(c==='"')return JSON.parse(raw.slice(start,i));
      if(c==='\\'){if(i>=raw.length)error();i++;}
      else if(c.charCodeAt(0)<0x20)error();
    }
    error();
  }
  function value(depth){
    if(depth>maxDepth)error();
    ws();
    if(raw[i]==='{')return object(depth);
    if(raw[i]==='[')return array(depth);
    if(raw[i]==='"'){str();return;}
    const start=i;
    while(i<raw.length&&!/[\t\r\n ,}\]]/.test(raw[i]))i++;
    if(!/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(raw.slice(start,i)))error();
  }
  function object(depth){
    i++;const seen=new Set();ws();
    if(raw[i]==='}'){i++;return;}
    for(;;){
      ws();const key=str();
      if(++keys>maxKeys)error();
      if(seen.has(key))duplicate=true;else seen.add(key);
      ws();if(raw[i++]!==':')error();
      value(depth+1);ws();
      if(raw[i]==='}'){i++;return;}
      if(raw[i++]!==',')error();
    }
  }
  function array(depth){
    i++;ws();if(raw[i]===']'){i++;return;}
    for(;;){
      value(depth+1);ws();
      if(raw[i]===']'){i++;return;}
      if(raw[i++]!==',')error();
    }
  }
  try{value(0);ws();if(i!==raw.length)error();
    return Object.freeze({ok:true,hasDuplicateKeys:duplicate});
  }catch{return Object.freeze({ok:false,reason:'INVALID_OR_UNBOUNDED_JSON'});}
}
