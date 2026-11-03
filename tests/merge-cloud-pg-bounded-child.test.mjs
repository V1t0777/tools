import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runBoundedChild} from '../scripts/merge-pg-bounded-child.mjs';

const run=(code,options={})=>runBoundedChild(process.execPath,['-e',code],{
  env:process.env,timeoutMs:5000,maxOutputBytes:4096,...options
});

test('P3.24 captures a small successful subprocess result',async()=>{
  assert.equal(await run("process.stdout.write('t\\n')"),'t');
});
test('P3.24 fails closed on nonzero exit without leaking stdout or stderr',async()=>{
  await assert.rejects(run("process.stdout.write('private-row');process.stderr.write('private-key');process.exit(3)"),
    err=>err.message==='Local database subprocess failed');
});
test('P3.24 terminates oversized output instead of retaining unbounded stdout',async()=>{
  await assert.rejects(run("process.stdout.write('x'.repeat(100000))",{maxOutputBytes:64}),
    err=>err.message==='Local database subprocess failed');
});
test('P3.24 kills a stalled subprocess within a bounded wall-clock budget',async()=>{
  const started=Date.now();
  await assert.rejects(run('setInterval(()=>{},1000)',{timeoutMs:150}),
    err=>err.message==='Local database subprocess failed');
  assert.ok(Date.now()-started<3000,'timeout must not wait for the child indefinitely');
});
test('P3.24 missing executable fails with a sanitized error',async()=>{
  await assert.rejects(runBoundedChild('/nonexistent-p3-24-command',[],{
    env:process.env,timeoutMs:1000,maxOutputBytes:100
  }),err=>err.message==='Local database subprocess failed');
});
test('P3.24 invalid subprocess limits cannot disable timeout or output cap',()=>{
  for(const timeoutMs of [0,-1,60001,NaN,'none'])
    assert.throws(()=>runBoundedChild('psql',[],{timeoutMs}),/Invalid local subprocess limits/);
  for(const maxOutputBytes of [0,-1,65537,NaN])
    assert.throws(()=>runBoundedChild('psql',[],{maxOutputBytes}),/Invalid local subprocess limits/);
});
test('P3.24 disposable PostgreSQL concurrent calls use bounded subprocess helper',()=>{
  const source=readFileSync(new URL('../scripts/merge-receipt-pg-preflight.mjs',import.meta.url),'utf8');
  assert.ok(source.includes("runBoundedChild('psql'"));
  assert.ok(source.includes('timeoutMs:15_000,maxOutputBytes:4_096'));
  assert.ok(source.includes('Array.from({length:40}'));
  assert.ok(!source.includes("spawn('psql'"));
});
