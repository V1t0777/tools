import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseDisposableDbUrl,runDisposablePostgresProbe} from '../scripts/merge-receipt-pg-preflight.mjs';
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
