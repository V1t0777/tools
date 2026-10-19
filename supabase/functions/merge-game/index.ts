/**
 * 云屿百物铺 P3 Edge Function DRAFT — NOT DEPLOYED.
 * Must be reviewed, locally typechecked + integrated against disposable Supabase DB before release.
 * The verified Supabase JWT sets actorUid. Never trust a userId, balance or snapshot in the body.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { createDatabaseAuthority } from '../../../merge/cloud/db-authority.mjs';
import { createReceiptLookupService } from '../../../merge/cloud/receipt-lookup.mjs';

const URL = Deno.env.get('SUPABASE_URL');
const PUBLIC_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SERVER_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ORIGIN = Deno.env.get('MERGE_ALLOWED_ORIGIN') ?? 'https://zhao-toolbox-secure.pages.dev';
if (!URL || !PUBLIC_KEY || !SERVER_KEY || !/^https:\/\/[^/]+$/.test(ORIGIN)) throw Error('Missing trusted server configuration');

const anon = createClient(URL, PUBLIC_KEY, {auth:{persistSession:false,autoRefreshToken:false}});
const admin = createClient(URL, SERVER_KEY, {auth:{persistSession:false,autoRefreshToken:false}});
const repository = {
  async open(uid: string, seed: unknown) {
    const {data,error}=await admin.rpc('merge_open_save',{p_user_id:uid,p_seed:seed});
    if(error)throw Error('Could not open authoritative save');
    return data;
  },
  async findOperation(uid: string, operationId: string) {
    const {data,error}=await admin.from('merge_operations')
      .select('request_hash,status,code,response').eq('user_id',uid).eq('operation_id',operationId).maybeSingle();
    if(error)throw Error('Could not check operation journal');
    return data;
  },
  async commit({uid,command,hash,result}: {uid:string,command:any,hash:string,result:any}) {
    const {data,error}=await admin.rpc('merge_commit_operation',{
      p_user_id:uid,p_operation_id:command.operationId,p_expected_revision:command.expectedRevision,
      p_request_hash:hash,p_next_state:result.state,p_response:{message:result.message},
      p_status:result.ok?'applied':'rejected',p_code:result.ok?result.kind:'ACTION_NOT_ALLOWED'
    });
    if(error)throw Error('Could not commit authoritative operation');
    return data;
  }
};
// Draft-only endpoint. Until the atomic per-account SQL limiter is authorized
// and applied, receipt requests fail closed with 503 (no memory fallback).
const receiptLookup = createReceiptLookupService({
  repository: {
    async findOperation(uid,operationId) {
      const {data,error}=await admin.from('merge_operations')
        .select('request_hash,status').eq('user_id',uid).eq('operation_id',operationId).maybeSingle();
      if(error)throw Error('Receipt lookup unavailable');
      return data;
    }
  },
  limiter: {
    async consume(uid) {
      const {data,error}=await admin.rpc('merge_consume_receipt_quota',{p_user_id:uid});
      if(error || typeof data !== 'boolean')throw Error('Shared receipt limiter unavailable');
      return data;
    }
  }
});
const game = createDatabaseAuthority(repository);
const cors = {'Access-Control-Allow-Origin':ORIGIN,'Vary':'Origin',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'};
const response = (payload:unknown, status=200) => new Response(JSON.stringify(payload),{
  status,headers:{...cors,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff'}
});
const exactKeys = (value:any, keys:string[]) => !!value && typeof value==='object' &&
  !Array.isArray(value) && Object.keys(value).length===keys.length && keys.every(k=>Object.hasOwn(value,k));

Deno.serve(async request => {
  const origin=request.headers.get('Origin');
  if(origin && origin!==ORIGIN)return response({code:'ORIGIN_NOT_ALLOWED'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(request.method!=='POST')return response({code:'METHOD_NOT_ALLOWED'},405);
  const bearer=request.headers.get('Authorization')?.match(/^Bearer (\S{10,4096})$/i)?.[1];
  if(!bearer)return response({code:'AUTH_REQUIRED'},401);
  try {
    const {data,error}=await anon.auth.getUser(bearer);
    if(error||!data.user?.id)return response({code:'AUTH_REQUIRED'},401);
    const text=await request.text();
    if(new TextEncoder().encode(text).length>4096)return response({code:'REQUEST_TOO_LARGE'},413);
    let body:any;
    try{body=JSON.parse(text);}catch{return response({code:'BAD_JSON'},400);}
    let result;
    if(exactKeys(body,['mode']) && body.mode==='read') {
      result=await game.read(data.user.id);
    } else if(exactKeys(body,['mode','command']) && body.mode==='command') {
      result=await game.execute(data.user.id,body.command);
    } else if(exactKeys(body,['mode','operationId']) && body.mode==='receipt') {
      result=await receiptLookup.read(data.user.id,body.operationId);
    } else return response({code:'BAD_COMMAND'},400);
    const status=result.status==='conflict'?409:
      result.code==='OPERATION_ID_REUSE'?409:
      result.code==='AUTH_REQUIRED'?401:
      result.code==='INVALID_OPERATION_ID'||result.code==='BAD_COMMAND'?400:
      result.code==='RECEIPT_RATE_LIMITED'?429:
      result.code==='RECEIPT_SERVICE_UNAVAILABLE'?503:200;
    return response(result,status);
  }catch {
    // Never echo database, JWT, request content or service-role errors to the client.
    return response({code:'SERVER_UNAVAILABLE'},503);
  }
});