import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {authorizeFourAccountCloudSave} from '../merge/cloud/private-access.mjs';

const uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const verified={id:uid,email_confirmed_at:'2026-11-01T02:00:00Z'};

test('exact verified Auth UID requires a positive server-side allowlist lookup',async()=>{
  let lookedUp='';
  const result=await authorizeFourAccountCloudSave(verified,async id=>{
    lookedUp=id;return id===uid;
  });
  assert.deepEqual(result,{ok:true,uid});
  assert.equal(lookedUp,uid);
});
test('verified but unlisted account is denied; nickname/user_metadata cannot grant access',async()=>{
  const intruder={...verified,user_metadata:{nickname:'钊',role:'admin'},nickname:'test'};
  assert.equal((await authorizeFourAccountCloudSave(intruder,async()=>false)).code,'CLOUD_ACCESS_DENIED');
  assert.equal((await authorizeFourAccountCloudSave(intruder,async()=>uid)).code,'CLOUD_ACCESS_DENIED');
});
test('unverified email and anonymous Auth users never reach the lookup',async()=>{
  let requests=0;
  const lookup=()=>{requests++;return true;};
  assert.equal((await authorizeFourAccountCloudSave({...verified,email_confirmed_at:null},lookup)).code,'CLOUD_ACCESS_DENIED');
  assert.equal((await authorizeFourAccountCloudSave({...verified,is_anonymous:true},lookup)).code,'CLOUD_ACCESS_DENIED');
  assert.equal(requests,0);
});
test('invalid, missing or user-supplied fake identities cannot authorize',async()=>{
  let requests=0;
  const lookup=()=>{requests++;return true;};
  for(const user of [null,{...verified,id:'test'}, {...verified,id:undefined}])
    assert.equal((await authorizeFourAccountCloudSave(user,lookup)).code,'AUTH_REQUIRED');
  assert.equal(requests,0);
});
test('missing allowlist dependency, database outage and rejected lookup fail closed',async()=>{
  assert.equal((await authorizeFourAccountCloudSave(verified,null)).code,'CLOUD_ACCESS_UNAVAILABLE');
  assert.equal((await authorizeFourAccountCloudSave(verified,()=>{throw Error('db unavailable');})).code,'CLOUD_ACCESS_UNAVAILABLE');
  assert.equal((await authorizeFourAccountCloudSave(verified,async()=>Promise.reject(Error('timeout')))).code,'CLOUD_ACCESS_UNAVAILABLE');
});
test('Edge draft checks allowlist for all read, command and receipt modes before parsing',()=>{
  const src=readFileSync(new URL('../supabase/functions/merge-game/index.ts',import.meta.url),'utf8');
  assert.match(src,/authorizeFourAccountCloudSave\(data\.user,/);
  assert.match(src,/admin\.from\('merge_cloud_allowlist'\)/);
  const start=src.indexOf('authorizeFourAccountCloudSave(data.user,');
  assert.ok(start>src.indexOf('anon.auth.getUser(bearer)'));
  assert.ok(start<src.indexOf('readBoundedJson(request)'));
  assert.ok(start<src.indexOf("body.mode==='read'"));
  assert.ok(start<src.indexOf("body.mode==='command'"));
  assert.ok(start<src.indexOf("body.mode==='receipt'"));
  assert.doesNotMatch(src,/data\.user\.user_metadata\b/);
});
test('SQL review draft freezes exactly four verified members by Auth UID with denied browser grants',()=>{
  const sql=readFileSync(new URL('../supabase/drafts/merge-isle-p3-four-account-allowlist-NOT-APPLIED.sql',import.meta.url),'utf8');
  for(const s of ['NOT APPLIED','merge_cloud_allowlist','auth.users',
    'email_confirmed_at','ENABLE ROW LEVEL SECURITY',
    'REVOKE ALL ON TABLE public.merge_cloud_allowlist FROM PUBLIC, anon, authenticated',
    'GRANT SELECT ON TABLE public.merge_cloud_allowlist TO service_role',
    "v_count<>4","v_distinct<>4","v_linked<>4","v_verified<>4",
    "'迪'","'晨'","'钊'","'test'"])
    assert.ok(sql.includes(s),s);
  assert.doesNotMatch(sql,/GRANT\s+(?:ALL|SELECT|INSERT|UPDATE|DELETE)\s+ON\s+(?:TABLE\s+)?public\.merge_cloud_allowlist\s+TO\s+(?:anon|authenticated)\s*;/i);
  const config=readFileSync(new URL('../supabase/config.toml',import.meta.url),'utf8');
  assert.match(config,/\[functions\.merge-game\]\s*verify_jwt\s*=\s*true/);
});
