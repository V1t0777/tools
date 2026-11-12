/** UNDEPLOYED P3 story cloud endpoint, four-account private only.
 * Story workshop is a self-contained sandbox, NOT the authoritative normal
 * economy. No raw localStorage API, no browser-provided userId or wallet grants.
 */
import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {authorizeFourAccountCloudSave} from '../../../merge/cloud/private-access.mjs';
import {normalizeStoryPairCommit,validStoryPair,hashStoryPairCommit}
  from '../../../merge/cloud/story-pair-authority.mjs';
const URL=Deno.env.get('SUPABASE_URL');
const KEY=Deno.env.get('SUPABASE_ANON_KEY');
const ADMIN=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ORIGIN=Deno.env.get('MERGE_ALLOWED_ORIGIN')??'https://zhao-toolbox-secure.pages.dev';
if(!URL||!KEY||!ADMIN||!/^https:\/\/[^/]+$/.test(ORIGIN))
  throw Error('Missing trusted cloud environment');
const auth=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const admin=createClient(URL,ADMIN,{auth:{persistSession:false,autoRefreshToken:false}});
const cors={'Access-Control-Allow-Origin':ORIGIN,'Vary':'Origin',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{...cors,'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}
});
const exact=(o,keys)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
async function boundedBody(req){
  if(!/^application\/json(?:;|$)/i.test(req.headers.get('Content-Type')??''))
    throw Object.assign(Error('BAD_CONTENT_TYPE'),{status:415});
  if(!req.body)throw Object.assign(Error('BAD_BODY'),{status:400});
  const reader=req.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  let count=0,raw='';
  try{
    for(;;){
      const {value,done}=await reader.read();
      if(done)break;
      count+=value.byteLength;
      if(count>1250000)throw Object.assign(Error('PAYLOAD_TOO_LARGE'),{status:413});
      raw+=decoder.decode(value,{stream:true});
    }
    raw+=decoder.decode();
    if(!raw||raw.length>350000)throw Object.assign(Error('PAYLOAD_TOO_LARGE'),{status:413});
    return JSON.parse(raw);
  }catch(error){throw Object.assign(error,{status:error?.status??400})}
  finally{reader.releaseLock()}
}
Deno.serve(async request=>{
  if(request.headers.get('Origin')&&request.headers.get('Origin')!==ORIGIN)
    return json({code:'ORIGIN_NOT_ALLOWED'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(request.method!=='POST')return json({code:'METHOD_NOT_ALLOWED'},405);
  const bearer=request.headers.get('Authorization')?.match(/^Bearer (\S{10,4096})$/i)?.[1];
  if(!bearer)return json({code:'AUTH_REQUIRED'},401);
  try{
    const {data,error}=await auth.auth.getUser(bearer);
    if(error||!data.user?.id)return json({code:'AUTH_REQUIRED'},401);
    const permit=await authorizeFourAccountCloudSave(data.user,async uid=>{
      const {data:row,error:err}=await admin.from('merge_cloud_allowlist')
        .select('user_id').eq('user_id',uid).maybeSingle();
      if(err)throw Error('Allowlist unavailable');
      return row?.user_id===uid;
    });
    if(!permit.ok)return json({code:permit.code},
      permit.code==='CLOUD_ACCESS_UNAVAILABLE'?503:403);
    let body;
    try{body=await boundedBody(request)}
    catch(error){return json({code:'BAD_STORY_REQUEST'},error?.status??400)}
    let result;
    if(exact(body,['mode'])&&body.mode==='read'){
      const reply=await admin.rpc('merge_story_read',{p_user_id:data.user.id});
      if(reply.error)throw Error('Private story read unavailable');
      result=reply.data;
    }else if(exact(body,['mode','operationId','expectedRevision','pair'])&&
             body.mode==='commit'){
      const {mode, ...candidate}=body;
      const command=normalizeStoryPairCommit(candidate);
      if(!command||!validStoryPair(command.pair))
        return json({code:'BAD_STORY_SNAPSHOT'},400);
      const hash=await hashStoryPairCommit(command);
      const reply=await admin.rpc('merge_story_commit',{
        p_user_id:data.user.id,p_operation_id:command.operationId,
        p_expected_revision:command.expectedRevision,p_pair:command.pair,
        p_payload_hash:hash
      });
      if(reply.error)throw Error('Private story CAS unavailable');
      result=reply.data;
    }else return json({code:'BAD_STORY_COMMAND'},400);
    if(!result||typeof result.status!=='string')throw Error('Invalid story response');
    return json(result,result.status==='conflict'?409:
      result.code==='OPERATION_ID_REUSE'?409:200);
  }catch{return json({code:'SERVER_UNAVAILABLE'},503)}
});
