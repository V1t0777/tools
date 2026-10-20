import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseDisposableDbUrl,runDisposablePostgresProbe,acceptsDisposableFingerprint} from '../scripts/merge-receipt-pg-preflight.mjs';
import {createReceiptLookupService} from '../merge/cloud/receipt-lookup.mjs';

const uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const op='00000000-0000-4000-8000-000000000001';
const local='postgres://tester@localhost:5432/merge_receipt_test_clean';
const service=(overrides={})=>createReceiptLookupService({
  repository:{findOperation:async()=>null},
  limiter:{consume:async()=>true},...overrides
});

test('requires a real disposable database prefix and loopback-only hostname',()=>{
  for(const url of [
    'postgres://tester@db.example.com/merge_receipt_test_clean',
    'postgres://tester@supabase.co/merge_receipt_test_clean',
    'postgres://tester@127.0.0.2/merge_receipt_test_clean',
    'postgres://tester@localhost/production',
    'postgres://tester@localhost/merge_receipt_test_',
    'postgres://tester@localhost/merge_receipt_test_hello?sslmode=disable',
    'postgres://tester@localhost/merge_receipt_test_hello#anything',
    'http://tester@localhost/merge_receipt_test_clean',
    'postgres://localhost/merge_receipt_test_clean',
    'postgres://tester@localhost/merge_receipt_test_hello%2Fprod',
    'postgres://tester@localhost/merge_receipt_test_UPPER',
    'postgres://tester@localhost/merge_receipt_test_clean_more!',
    'not a url',
    '',
    null
  ])assert.equal(parseDisposableDbUrl(url),null,'must reject unsafe target');
});

test('accepts only explicitly named local PG test databases and pins address',()=>{
  const a=parseDisposableDbUrl(local);
  assert.equal(a.PGHOST,'localhost');
  assert.equal(a.PGHOSTADDR,'');
  assert.equal(a.PGDATABASE,'merge_receipt_test_clean');
  assert.equal(a.PGSSLMODE,'disable');
  assert.ok(Object.isFrozen(a));
  const b=parseDisposableDbUrl('postgresql://tester@127.0.0.1:5439/merge_receipt_test_probe');
  assert.equal(b.PGHOST,'127.0.0.1');
  assert.equal(b.PGPORT,'5439');
});

test('programmatic runner rejects remote or unqualified databases BEFORE executing psql',async()=>{
  await assert.rejects(runDisposablePostgresProbe({
    PGHOST:'database.example.com',PGDATABASE:'merge_receipt_test_clean'
  }),/Refusing/);
  await assert.rejects(runDisposablePostgresProbe({
    PGHOST:'localhost',PGDATABASE:'production'
  }),/Refusing/);
});

test('SQL draft never grants receipt quota rights to browser roles',()=>{
  const sql=readFileSync(new URL('../supabase/drafts/merge-isle-p3.16-NOT-APPLIED.sql',import.meta.url),'utf8');
  assert.match(sql,/NOT APPLIED/);
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/REVOKE ALL ON TABLE public\.merge_receipt_quotas FROM PUBLIC, anon, authenticated/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.merge_consume_receipt_quota\(uuid\) FROM PUBLIC, anon, authenticated/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.merge_consume_receipt_quota\(uuid\) TO service_role/);
  assert.match(sql,/ON CONFLICT \(user_id\) DO UPDATE/);
  assert.match(sql,/RETURN v_count <= 12;/);
  assert.match(sql,/BEGIN;[\s\S]*COMMIT;/);
});

test('preflight probe includes live 40-connection, RLS, role, reset and isolation assertions',()=>{
  const src=readFileSync(new URL('../scripts/merge-receipt-pg-preflight.mjs',import.meta.url),'utf8');
  for(const required of [
    '--confirm-disposable-db','to_regclass','has_function_privilege',
    'has_table_privilege','relrowsecurity','Array.from({length:40}',
    "result.filter(x=>x==='t').length===12",
    "result.filter(x=>x==='f').length===28",
    'window_started_at','uidB'
  ])assert.ok(src.includes(required),'missing integration assertion: '+required);
});

test('invalid receipt timeouts are rejected at construction',()=>{
  for(const deadlineMs of [0,-1,30_001,Infinity,NaN,1.5,'20'])
    assert.throws(()=>service({deadlineMs}),/Invalid receipt deadline/);
  assert.ok(service({deadlineMs:30_000}));
});

test('limiter timeout is a 503 and never starts a repository read',async()=>{
  let queries=0;
  const lookup=service({deadlineMs:15,
    limiter:{consume:()=>new Promise(()=>{})},
    repository:{findOperation:async()=>{queries++;return null;}}
  });
  const result=await lookup.read(uid,op);
  assert.equal(result.code,'RECEIPT_SERVICE_UNAVAILABLE');
  assert.equal(result.httpStatus,503);
  assert.equal(queries,0);
});

test('repository timeout fails closed after quota admission',async()=>{
  let counts=0;
  const lookup=service({deadlineMs:15,
    limiter:{consume:async()=>{counts++;return true;}},
    repository:{findOperation:()=>new Promise(()=>{})}
  });
  const result=await lookup.read(uid,op);
  assert.equal(result.code,'RECEIPT_SERVICE_UNAVAILABLE');
  assert.equal(result.httpStatus,503);
  assert.equal(counts,1);
});

test('delayed success after timeout cannot transform the returned failure',async()=>{
  let finish;
  const pending=new Promise(resolve=>{finish=resolve;});
  const lookup=service({deadlineMs:15,
    repository:{findOperation:()=>pending}
  });
  const response=await lookup.read(uid,op);
  assert.equal(response.code,'RECEIPT_SERVICE_UNAVAILABLE');
  finish({status:'applied',request_hash:'a'.repeat(64)});
  await Promise.resolve();
  assert.equal(response.code,'RECEIPT_SERVICE_UNAVAILABLE');
  assert.equal(response.ok,false);
});

test('deadline failure reports no private operation IDs or server errors',async()=>{
  const lookup=service({deadlineMs:15,
    repository:{findOperation:()=>new Promise(()=>{})}
  });
  const response=await lookup.read(uid,op);
  assert.doesNotMatch(JSON.stringify(response),/aaaaaaaa-aaaa|00000000-0000|secret/);
  assert.equal(response.canResumeCloudWrites,undefined);
});


test('P3.20 fingerprint rejects non-loopback server, mismatched DB/owner, nonempty schema and absent NOLOGIN roles',()=>{
  const env=parseDisposableDbUrl(local);
  const good={serverAddress:'127.0.0.1',database:env.PGDATABASE,
    owner:env.PGUSER,preparedRoles:'3',safeRoles:'3',pristine:'t'};
  assert.equal(acceptsDisposableFingerprint(env,good),true);
  assert.equal(acceptsDisposableFingerprint(env,{...good,serverAddress:'::1'}),true);
  for(const patch of [
    {serverAddress:'203.0.113.7'},
    {serverAddress:'::ffff:127.0.0.1'},
    {database:'production'},
    {owner:'postgres'},
    {preparedRoles:'2'},
    {preparedRoles:'0'},
    {safeRoles:'2'},
    {safeRoles:'0'},
    {pristine:'f'},
    {pristine:''}
  ])assert.equal(acceptsDisposableFingerprint(env,{...good,...patch}),false);
});

test('P3.20 direct runner rejects invalid libpq routing or invalid port before connecting',async()=>{
  const base=parseDisposableDbUrl(local);
  for(const override of [
    {PGHOSTADDR:'203.0.113.7'},
    {PGSERVICE:'production'},
    {PGSSLMODE:'require'},
    {PGPORT:'0'},
    {PGPORT:'65536'},
    {PGPORT:'5432;other'},
    {PGUSER:'test role'}
  ])await assert.rejects(runDisposablePostgresProbe({...base,...override}),/Refusing/);
});

test('P3.20 requires empty DB, ownership and pre-provisioned NOLOGIN roles before any writes',()=>{
  const source=readFileSync(new URL('../scripts/merge-receipt-pg-preflight.mjs',import.meta.url),'utf8');
  for(const check of [
    'pg_catalog.inet_server_addr()','pg_catalog.current_database()',
    'pg_catalog.pg_get_userbyid','pg_catalog.pg_namespace',
    'pg_catalog.pg_class','pg_catalog.pg_proc','pg_catalog.pg_type',
    'pg_catalog.pg_extension','pg_catalog.pg_foreign_server',
    'pg_catalog.pg_publication','pg_catalog.pg_event_trigger',
    'NOT rolcanlogin','acceptsDisposableFingerprint(env,fingerprint)'
  ])assert.ok(source.includes(check),'missing preflight guard: '+check);
  assert.ok(source.indexOf('const fingerprint={')<source.indexOf('const bootstrap=['));
  for(const unsafe of ['CREATE ROLE anon','CREATE ROLE authenticated','CREATE ROLE service_role'])
    assert.equal(source.includes(unsafe),false,'probe must not mutate cluster roles');
});

test('P3.21 schema guard requires literal pg_ prefix rather than SQL LIKE wildcard',()=>{
  const src=readFileSync(new URL('../scripts/merge-receipt-pg-preflight.mjs',import.meta.url),'utf8');
  assert.ok(src.includes("pg_catalog.left(nspname,3) <> 'pg_'"));
  assert.ok(!src.includes("nspname NOT LIKE 'pg_%'"));
  const isSystemPrefix=name=>name.slice(0,3)==='pg_';
  for(const custom of ['pgfoo','pgX','pg1','pg','customer','pguser'])
    assert.equal(isSystemPrefix(custom),false);
  for(const system of ['pg_toast','pg_temp_7','pg_toast_temp_7'])
    assert.equal(isSystemPrefix(system),true);
});
test('P3.21 pristine SQL still gates first database mutation',()=>{
  const src=readFileSync(new URL('../scripts/merge-receipt-pg-preflight.mjs',import.meta.url),'utf8');
  assert.ok(src.includes("nspname NOT IN ('public','pg_catalog','information_schema') AND pg_catalog.left(nspname,3) <> 'pg_'"));
  assert.ok(src.indexOf('pristine:querySync(env,pristineSql)')<src.indexOf('const bootstrap=['));
  assert.ok(src.includes("fingerprint.pristine==='t'"));
});


test('P3.25 disposable test roles must lack cluster privileges and BYPASSRLS',()=>{
  const src=readFileSync(new URL('../scripts/merge-receipt-pg-preflight.mjs',import.meta.url),'utf8');
  for(const flag of ['NOT rolsuper','NOT rolcreatedb','NOT rolcreaterole','NOT rolreplication','NOT rolbypassrls'])
    assert.ok(src.includes(flag),'missing safe role restriction: '+flag);
  assert.ok(src.includes("fingerprint.safeRoles==='3'"));
  assert.ok(src.indexOf('safeRoles:querySync')<src.indexOf('const bootstrap=['));
});
