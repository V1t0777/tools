import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyCloudIdentity} from '../merge/cloud/http-transport.mjs';
import {adaptToolboxCloudAuth,openToolboxPrivateCloudSession} from '../merge/cloud/toolbox-auth-adapter.mjs';
import {createDatabaseAuthority} from '../merge/cloud/db-authority.mjs';
import {createMockRepository} from '../merge/cloud/mock-repository.mjs';

const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const projectUrl='https://demo-private.supabase.co';
const key='public-test-key-for-cloud-only';
const toolbox=()=>({url:projectUrl,key,createClient:()=>({auth:{
  getSession:async()=>({data:{session:{access_token:'test-bearer-token',user:{id}}}})
}})});
function storage(){const s=new Map();return {getItem:k=>s.get(k)??null,setItem:(k,v)=>s.set(k,v),keys:()=>[...s.keys()]}}
const locks={request:async(name,options,callback)=>callback({name,mode:'exclusive'})};

test('ToolboxAuth /auth/v1/user bridges verified cloud HTTP and command commit',async()=>{
  const authority=createDatabaseAuthority(createMockRepository(),{clock:()=>1000000,rng:()=>0.9});
  let authChecks=0,cloudRequests=0;
  const fetchImpl=async(url,options)=>{
    assert.equal(options.redirect,'error');
    assert.equal(options.credentials,'omit');
    assert.equal(options.headers.Authorization,'Bearer test-bearer-token');
    assert.equal(options.headers.apikey,key);
    if(url===projectUrl+'/auth/v1/user'){
      authChecks++;
      return new Response(JSON.stringify({id,email_confirmed_at:'2026-11-01T00:00:00Z'}),
        {status:200,headers:{'content-type':'application/json'}});
    }
    assert.equal(url,projectUrl+'/functions/v1/merge-game');
    cloudRequests++;
    const body=JSON.parse(options.body);
    const outcome=body.mode==='read'?await authority.read(id):
      await authority.execute(id,body.command);
    return new Response(JSON.stringify(outcome),
      {status:200,headers:{'content-type':'application/json'}});
  };
  const auth=adaptToolboxCloudAuth(toolbox(),{fetchImpl});
  assert.equal((await verifyCloudIdentity(auth)).uid,id);
  const session=await openToolboxPrivateCloudSession({toolboxAuth:toolbox(),
    fetchImpl,storage:storage(),locks,clock:()=>1000000,
    makeId:()=> '00000000-0000-4000-8000-000000000001'
  });
  assert.equal((await session.connect()).verified,true);
  assert.equal((await session.enqueue({type:'produce',slot:42})).ok,true);
  assert.equal((await session.flush()).ok,true);
  assert.equal((await authority.read(id)).revision,1);
  assert.ok(authChecks>=3);assert.ok(cloudRequests>=2);
});
test('unverified GoTrue user cannot open a cloud session',async()=>{
  const fetchImpl=async()=>new Response(JSON.stringify({id,email_confirmed_at:null}),
    {status:200,headers:{'content-type':'application/json'}});
  await assert.rejects(openToolboxPrivateCloudSession({toolboxAuth:toolbox(),
    fetchImpl,storage:storage(),locks}),/CLOUD_AUTH_UNVERIFIED/);
});
test('custom host is rejected before tokens are sent',()=>{
  let sent=0;
  assert.throws(()=>adaptToolboxCloudAuth({...toolbox(),url:'https://evil.example'},
    {fetchImpl:async()=>{sent++}}),/INVALID_CLOUD_PROJECT/);
  assert.equal(sent,0);
});
test('sign-out prevents further verified cloud requests',async()=>{
  const t=toolbox();let loggedIn=true,calls=0;
  t.createClient=()=>({auth:{getSession:async()=>({data:{session:loggedIn?
    {access_token:'test-bearer-token',user:{id}}:null}})}});
  const fetchImpl=async()=>{calls++;return new Response(JSON.stringify({id,
    email_confirmed_at:'2026-11-01'}),{status:200,headers:{'content-type':'application/json'}})};
  const auth=adaptToolboxCloudAuth(t,{fetchImpl});
  assert.equal((await verifyCloudIdentity(auth)).uid,id);
  loggedIn=false;
  await assert.rejects(verifyCloudIdentity(auth),/CLOUD_AUTH_UNVERIFIED/);
  assert.equal(calls,1);
});
