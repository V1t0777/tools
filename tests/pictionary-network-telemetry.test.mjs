import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const source=readFileSync(new URL('../pictionary/perf.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../pictionary/app.js',import.meta.url),'utf8');
const edge=readFileSync(new URL('../supabase/functions/pictionary-game/index.ts',import.meta.url),'utf8');
const html=readFileSync(new URL('../pictionary/index.html',import.meta.url),'utf8');
const builder=readFileSync(new URL('../cloudflare-secure/build.sh',import.meta.url),'utf8');
function runTelemetry(){
  let time=0;
  const calls=[];
  const perf={now:()=>time,mark:n=>calls.push('mark:'+n),
    measure:n=>calls.push('measure:'+n),clearMarks:()=>{},clearMeasures:()=>{}};
  const context={performance:perf,navigator:{connection:{effectiveType:'4g'}},Date,Math};
  vm.createContext(context);vm.runInContext(source,context);
  return {telemetry:context.PictionaryPerf,advance:n=>{time+=n;},calls,context};
}
test('performance.mark and measure track bounded anonymous stages',()=>{
  const {telemetry,advance,calls}=runTelemetry();
  const done=telemetry.begin('api.fetch');
  advance(12);done();done();
  assert.ok(calls.some(v=>v.startsWith('mark:pictionary.api.fetch.')));
  assert.ok(calls.some(v=>v.startsWith('measure:pictionary.api.fetch')));
  assert.equal(telemetry.snapshot().latency['api.fetch'].p50,12);
  assert.equal(telemetry.snapshot().latency['api.fetch'].count,1);
  assert.ok(!('guesses' in telemetry.snapshot()));
});
test('realtime send pending and SDK completion are counted without examining payloads',()=>{
  const {telemetry,advance}=runTelemetry();
  const a=telemetry.sendStart('stroke'),b=telemetry.sendStart('clear');
  assert.equal(telemetry.snapshot().send.pending,2);
  advance(150);a('ok');
  b('error');
  const stats=telemetry.snapshot();
  assert.equal(stats.send.pending,0);
  assert.equal(stats.send.maxPending,2);
  assert.equal(stats.send.errors,1);
  assert.equal(stats.latency['realtime.send_wait'].p95,150);
});
test('network profile adjusts stroke interval and recovery, including RTT fall back',()=>{
  const {telemetry,context}=runTelemetry();
  assert.equal(telemetry.profile().strokeMs,14);
  telemetry.setPeerRtt(850);
  assert.equal(telemetry.profile().strokeMs,46);
  context.navigator.connection.effectiveType='3g';
  for(let i=0;i<9;i++)telemetry.setPeerRtt(35);
  assert.equal(telemetry.profile().strokeMs,28);
  context.navigator.connection.effectiveType='4g';
  for(let i=0;i<9;i++)telemetry.setPeerRtt(35);
  assert.equal(telemetry.profile().strokeMs,14);
});
test('edge server timing is extracted without request text and unknown region is explicit',()=>{
  const {telemetry}=runTelemetry();
  telemetry.readServerTiming('state',{get:k=>k==='server-timing'?'parse;dur=3, auth;dur=22.5, business;dur=18, total;dur=48':null});
  const value=telemetry.snapshot();
  assert.equal(value.latency['edge.total'].p95,48);
  assert.equal(value.latency['edge.auth'].p50,22.5);
  assert.equal(value.observedRegion,'未观测');
});
test('diagnostics are present on secure build only and Edge logs are sanitized',()=>{
  assert.match(html,/id="networkDiagnostics"/);
  assert.match(html,/perf\.js\?v=/);
  assert.match(builder,/pictionary\/perf\.js/);
  assert.match(app,/telemetry\.readServerTiming/);
  assert.match(app,/telemetry\.sendStart/);
  assert.match(app,/updatePerfDiagnostics/);
  assert.match(edge,/Server-Timing/);
  assert.match(edge,/pictionary_perf/);
  assert.match(edge,/status,total_ms:total/);
});
