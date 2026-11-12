import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openPrivateCloudSession} from '../merge/cloud/client-session.mjs';
import {createAuthenticatedMergeTransport,verifyCloudIdentity} from '../merge/cloud/http-transport.mjs';
import {createDatabaseAuthority} from '../merge/cloud/db-authority.mjs';
import {createMockRepository} from '../merge/cloud/mock-repository.mjs';
import {normalizeCommand,planTrustedTransition} from '../merge/cloud/authority.mjs';
import {auditEconomyTransition} from '../merge/cloud/economy-audit.mjs';
import {createInitialState,validateSave} from '../merge/engine.mjs';

const uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const projectUrl='https://demo-private.supabase.co';
const publishableKey='public-test-key-for-cloud-only';
const userAuth=(id=uid)=>({
  getSession:async()=>({data:{session:{access_token:'test-bearer-token',user:{id}}}}),
  getUser:async()=>({data:{user:{id,email_confirmed_at:'2026-11-01T00:00:00Z'}}})
});
function storage(){
  const entries=new Map();
  return {getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v),
    keys:()=>Array.from(entries.keys())};
}
function locks(){
  const lanes=new Map();
  return {async request(name,options,callback){
    assert.equal(options.mode,'exclusive');
    const previous=lanes.get(name)??Promise.resolve();
    let release;const pending=new Promise(resolve=>{release=resolve});
    lanes.set(name,pending);await previous;
    try{return await callback({name,mode:'exclusive'});}
    finally{release();if(lanes.get(name)===pending)lanes.delete(name);}
  }};
}
function setup(){
  const authority=createDatabaseAuthority(createMockRepository(),{clock:()=>1000000,rng:()=>0.9});
  let commands=0,reads=0,loseAck=false,deny=false;
  const fakeFetch=async(url,request)=>{
    assert.equal(url,projectUrl+'/functions/v1/merge-game');
    assert.equal(request.redirect,'error');
    assert.equal(request.credentials,'omit');
    assert.equal(request.method,'POST');
    assert.equal(request.headers.apikey,publishableKey);
    assert.equal(request.headers.Authorization,'Bearer test-bearer-token');
    const body=JSON.parse(request.body);
    if(deny)return new Response(JSON.stringify({status:'rejected',code:'CLOUD_ACCESS_DENIED'}),
      {status:403,headers:{'content-type':'application/json'}});
    const result=body.mode==='read'?(reads++,await authority.read(uid)):
      body.mode==='command'?(commands++,await authority.execute(uid,body.command)):null;
    if(!result)throw Error('Unrecognized request');
    if(loseAck && body.mode==='command'){
      loseAck=false;throw Error('Server committed but response lost');
    }
    return new Response(JSON.stringify(result),{status:result.status==='conflict'?409:200,
      headers:{'content-type':'application/json'}});
  };
  const shared=storage(),sharedLocks=locks();
  let seq=0;
  const makeId=()=>('00000000-0000-4000-8000-'+String(++seq).padStart(12,'0'));
  const create=opts=>openPrivateCloudSession({projectUrl,publishableKey,
    auth:userAuth(),storage:shared,locks:sharedLocks,fetchImpl:fakeFetch,
    clock:()=>1000000,makeId,...opts});
  return {create,shared,authority,stats:()=>({commands,reads}),
    loseAck:()=>{loseAck=true},deny:()=>{deny=true}};
}
test('two tabs sync distinct commands; third session sees server-confirmed state',async()=>{
  const x=setup(),a=await x.create(),b=await x.create();
  assert.equal(a.preview().verified,false);
  assert.equal((await a.connect()).verified,true);
  const queued=await Promise.all([a.enqueue({type:'produce',slot:42}),
    b.enqueue({type:'produce',slot:44})]);
  assert.equal(queued.filter(r=>r.ok).length,2);
  assert.equal((await a.flush()).ok,true);
  const again=await x.create();
  assert.equal(again.preview().verified,false);
  assert.equal((await again.connect()).verified,true);
  assert.equal(again.preview().pending,0);
  assert.equal(again.preview().revision,2);
  assert.equal((await x.authority.read(uid)).state.energy,118);
  assert.equal(x.stats().commands,2);
  assert.ok(x.shared.keys().every(k=>k.includes('cloud-queue')));
});
test('lost server ACK retries exact operation ID and never reissues rewards',async()=>{
  const x=setup(),client=await x.create();
  assert.equal((await client.enqueue({type:'produce',slot:42})).ok,true);
  x.loseAck();
  assert.equal((await client.flush()).ok,false);
  assert.equal(client.preview().pending,1);
  assert.equal(client.preview().attemptedPending,1);
  assert.equal((await x.authority.read(uid)).revision,1);
  assert.equal((await client.flush({force:true})).ok,true);
  assert.equal(client.preview().pending,0);
  assert.equal((await x.authority.read(uid)).revision,1);
  assert.equal(x.stats().commands,2);
});
test('server denial is explicit and cannot mark a local cache verified',async()=>{
  const x=setup(),client=await x.create();
  x.deny();
  const r=await client.connect();
  assert.equal(r.ok,false);
  assert.equal(r.code,'CLOUD_ACCESS_DENIED');
  assert.equal(client.preview().verified,false);
  assert.deepEqual(x.shared.keys(),[]);
});
test('account change blocks a previously bound journal before any HTTP call',async()=>{
  const x=setup();
  let id=uid,called=0;
  const auth={getSession:async()=>({data:{session:{access_token:'test-bearer-token',user:{id}}}}),
    getUser:async()=>({data:{user:{id,email_confirmed_at:'2026-11-01'}}})};
  const client=await x.create({auth,fetchImpl:async()=>{called++;throw Error('should not send')}});
  id=other;
  const outcome=await client.connect();
  assert.equal(outcome.ok,false);
  assert.equal(called,0);
});
test('unverified account is rejected before journal creation',async()=>{
  const bad={getSession:async()=>({data:{session:{access_token:'test-bearer-token',user:{id:uid}}}}),
    getUser:async()=>({data:{user:{id:uid,email_confirmed_at:null}}})};
  await assert.rejects(verifyCloudIdentity(bad),/CLOUD_AUTH_UNVERIFIED/);
  const x=setup();
  await assert.rejects(x.create({auth:bad}),/CLOUD_AUTH_UNVERIFIED/);
  assert.deepEqual(x.shared.keys(),[]);
});
test('bearer never goes to arbitrary domains or non-JSON redirects',async()=>{
  for(const wrong of ['https://evil.example','http://demo-private.supabase.co',
    'https://demo-private.supabase.co.evil.example',
    'https://demo-private.supabase.co/evil','https://demo-private.supabase.co/?q=1'])
    assert.throws(()=>createAuthenticatedMergeTransport({projectUrl:wrong,publishableKey,
      verifiedUid:uid,auth:userAuth(),fetchImpl:()=>{}}),/INVALID_CLOUD_PROJECT/);
  const t=createAuthenticatedMergeTransport({projectUrl,publishableKey,verifiedUid:uid,
    auth:userAuth(),fetchImpl:async()=>new Response('<html>not a cloud reply</html>',
      {status:200,headers:{'content-type':'text/html'}})});
  await assert.rejects(t.read(),/CLOUD_INVALID_RESPONSE/);
});
test('P3 server command parity: finite supplies and precise deadlock discard',()=>{
  const normalize=action=>normalizeCommand({
    operationId:'00000000-0000-4000-8000-000000000001',expectedRevision:0,action});
  for(const action of [{type:'useSupply',itemId:'soda',producerId:null},
    {type:'purchaseSupply',itemId:'soda'},
    {type:'discard',slot:0,expectedItemId:'m1'}])assert.ok(normalize(action));
  for(const action of [{type:'purchaseSupply',itemId:'__proto__'},
    {type:'useSupply',itemId:'soda',producerId:'../../'},
    {type:'discard',slot:56,expectedItemId:'m1'},
    {type:'discard',slot:0,expectedItemId:'bogus'}])assert.equal(normalize(action),null);
  const original=createInitialState(1000000);
  original.coins=300;assert.equal(validateSave(original),true);
  const bought=planTrustedTransition(original,normalize({type:'purchaseSupply',itemId:'soda'}),
    {now:1000000,rng:()=>0.9});
  assert.equal(bought.ok,true);assert.equal(bought.state.coins,210);
  assert.equal(bought.state.bag.soda,1);
  assert.equal(auditEconomyTransition(original,normalize({type:'purchaseSupply',itemId:'soda'}),bought).coins,-90);
  const state={...bought.state,energy:80};
  const used=planTrustedTransition(state,normalize({type:'useSupply',itemId:'soda',producerId:null}),
    {now:1000000,rng:()=>0.9});
  assert.equal(used.ok,true);assert.equal(used.state.bag.soda,0);
  assert.equal(auditEconomyTransition(state,normalize({type:'useSupply',itemId:'soda',producerId:null}),used).coins,0);
  const discarded=planTrustedTransition(original,normalize({type:'discard',slot:0,expectedItemId:'m1'}),
    {now:1000000,rng:()=>0.9});
  assert.equal(discarded.ok,false);
  assert.equal(auditEconomyTransition(original,normalize({type:'discard',slot:0,expectedItemId:'m1'}),discarded).coins,0);
});
test('PostgreSQL cloud draft matches V3 game schema and UTF-8 save ceiling',()=>{
  const sql=readFileSync(new URL('../supabase/drafts/merge-isle-p3-NOT-APPLIED.sql',import.meta.url),'utf8');
  assert.match(sql,/schemaVersion=3/);
  assert.match(sql,/p_seed->>'schemaVersion' IS DISTINCT FROM '3'/);
  assert.match(sql,/p_next_state->>'schemaVersion'\)::int IS DISTINCT FROM 3/);
  assert.match(sql,/octet_length\(state::text\) <= 640000/);
  assert.ok(sql.includes('DO NOT APPLY'));
});
