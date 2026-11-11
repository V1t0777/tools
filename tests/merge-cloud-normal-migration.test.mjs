import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState} from '../merge/engine.mjs';
import {createNormalMigrationManifest} from '../merge/cloud/normal-migration-review.mjs';
import {createAuthenticatedMergeTransport} from '../merge/cloud/http-transport.mjs';
import {openPrivateCloudSession} from '../merge/cloud/client-session.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
const uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const projectUrl='https://demo-private.supabase.co',publishableKey='public-test-key-for-cloud-only';
const auth={
  getSession:async()=>({data:{session:{access_token:'test-bearer-token',user:{id:uid}}}}),
  getUser:async()=>({data:{user:{id:uid,email_confirmed_at:'2026-11-11T00:00:00Z'}}})
};
function makeStorage(initial=null){
  const entries=new Map();
  if(initial!==null)entries.set(SAVE_KEY,initial);
  return {getItem:key=>entries.get(key)??null,setItem:(key,val)=>entries.set(key,val),
    get raw(){return entries}};
}
const locks={request:async(name,options,callback)=>callback({name,mode:'exclusive'})};
test('migration manifest binds exact V3 local bytes without writing or network access',async()=>{
  const raw=JSON.stringify(createInitialState(1000000));
  const storage=makeStorage(raw);
  const before=[...storage.raw];
  const manifest=await createNormalMigrationManifest(storage);
  assert.equal(manifest.ok,true);
  assert.equal(manifest.raw,raw);
  assert.equal(manifest.revision,0);
  assert.equal(manifest.coins,0);
  assert.equal(manifest.sha256.length,64);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
  const expected=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  assert.equal(manifest.sha256,expected);
  assert.deepEqual([...storage.raw],before);
});
test('migration rejects corrupt local JSON and a source changed during hashing',async()=>{
  assert.equal((await createNormalMigrationManifest(makeStorage('{broken'))).ok,false);
  const raw=JSON.stringify(createInitialState(1000000));
  const data=makeStorage(raw);
  let reads=0;
  const changing={getItem(key){reads++;if(reads===2)data.setItem(SAVE_KEY,raw+' ');return data.getItem(key)}};
  const changed=await createNormalMigrationManifest(changing);
  assert.equal(changed.ok,false);
  assert.equal(changed.code,'MIGRATION_SOURCE_CHANGED');
});
test('claim request contains only reviewed SHA, not client-controlled wallet',async()=>{
  const raw=JSON.stringify(createInitialState(1000000));
  const hash=(await createNormalMigrationManifest(makeStorage(raw))).sha256;
  let sent=null;
  const transport=createAuthenticatedMergeTransport({projectUrl,publishableKey,auth,
    verifiedUid:uid,fetchImpl:async(url,options)=>{
      assert.equal(url,projectUrl+'/functions/v1/merge-game');
      sent=JSON.parse(options.body);
      return new Response(JSON.stringify({
        ok:false,status:'rejected',code:'NO_APPROVED_MIGRATION'
      }),{status:200,headers:{'Content-Type':'application/json'}});
    }});
  assert.equal((await transport.claimApproved(hash)).code,'NO_APPROVED_MIGRATION');
  assert.deepEqual(sent,{mode:'claim',confirmed:true,sourceSha256:hash});
  await assert.rejects(transport.claimApproved('injected'),/INVALID_MIGRATION_HASH/);
});
test('private session rejects unconfirmed migration, refreshes authorized server state',async()=>{
  const raw=JSON.stringify(createInitialState(1000000));
  const hash=(await createNormalMigrationManifest(makeStorage(raw))).sha256;
  const advanced=createInitialState(1000000);
  advanced.revision=8;advanced.coins=44;
  let serverState=createInitialState(1000000),claims=0;
  const fetchImpl=async(_,opts)=>{
    const body=JSON.parse(opts.body);
    if(body.mode==='claim'){
      claims++;
      if(body.sourceSha256!==hash)
        return new Response(JSON.stringify({ok:false,status:'rejected',code:'MIGRATION_SOURCE_MISMATCH'}),
          {status:200,headers:{'Content-Type':'application/json'}});
      serverState=advanced;
      return new Response(JSON.stringify({ok:true,status:'applied',revision:8,state:advanced}),
        {status:200,headers:{'Content-Type':'application/json'}});
    }
    assert.equal(body.mode,'read');
    return new Response(JSON.stringify({ok:true,status:'ok',revision:serverState.revision,
      state:serverState}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const session=await openPrivateCloudSession({projectUrl,publishableKey,auth,
    storage:makeStorage(),locks,fetchImpl});
  assert.equal((await session.claimApproved({sourceSha256:hash})).code,
    'MIGRATION_CONFIRMATION_REQUIRED');
  assert.equal((await session.claimApproved({sourceSha256:hash,confirmedByUser:true})).code,
    'MIGRATION_CLOUD_REVIEW_REQUIRED');
  assert.equal(claims,0);
  assert.equal((await session.connect()).verified,true);
  assert.equal((await session.claimApproved({sourceSha256:'0'.repeat(64),confirmedByUser:true})).code,
    'MIGRATION_SOURCE_MISMATCH');
  assert.equal(session.preview().revision,0);
  const claimed=await session.claimApproved({sourceSha256:hash,confirmedByUser:true});
  assert.equal(claimed.ok,true);
  assert.equal(claimed.revision,8);
  assert.equal(session.preview().state.coins,44);
  assert.equal(session.preview().verified,true);
  assert.equal(claims,2);
});
test('SQL/Edge draft requires admin, four-account access, single use and row lock',()=>{
  const sql=readFileSync(new URL('../supabase/drafts/merge-normal-migration-grant-NOT-APPLIED.sql',import.meta.url),'utf8');
  const edge=readFileSync(new URL('../supabase/functions/merge-game/index.ts',import.meta.url),'utf8');
  for(const x of ['DO NOT APPLY','merge_normal_migration_grants',
    'approved_by uuid NOT NULL','ENABLE ROW LEVEL SECURITY',
    'GRANT SELECT,INSERT,UPDATE ON public.merge_normal_migration_grants TO service_role',
    'p_source_sha256','FOR UPDATE','CLOUD_ALREADY_PLAYED','consumed_at',
    'merge_operations','merge_cloud_allowlist',
    'GRANT EXECUTE ON FUNCTION public.merge_claim_approved_normal_save'])
    assert.ok(sql.includes(x),x);
  assert.match(edge,/body.mode==='claim'/);
  assert.match(edge,/p_source_sha256:body.sourceSha256/);
  assert.match(edge,/p_confirmed:true/);
  assert.doesNotMatch(edge,/p_next_state:body\./);
  assert.doesNotMatch(sql,/GRANT\s+(?:ALL|INSERT|UPDATE|SELECT)\s+ON\s+(?:TABLE\s+)?public\.merge_normal_migration_grants\s+TO\s+(?:anon|authenticated)\b/i);
});
