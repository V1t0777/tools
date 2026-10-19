import test from 'node:test';
import assert from 'node:assert/strict';
import {readBoundedJson} from '../merge/cloud/bounded-json.mjs';
import {readFileSync} from 'node:fs';
const utf8=s=>new TextEncoder().encode(s);
const streamed=(chunks,header=null)=>{
  let emitted=0,cancelled=false;
  const body=new ReadableStream({
    pull(controller) {if(emitted===chunks.length)controller.close();else controller.enqueue(chunks[emitted++]);},
    cancel(){cancelled=true;}
  },{highWaterMark:0});
  const headers=new Headers();
  if (header!==null) headers.set('content-length',header);
  return {request:{headers,body},get emitted(){return emitted},get cancelled(){return cancelled}};
};

test('parses small valid JSON from split stream without a Content-Length header',async()=>{
  const s=streamed([utf8('{"mode":"'),utf8('read"}')]);
  const r=await readBoundedJson(s.request);
  assert.equal(r.ok,true);assert.deepEqual(r.value,{mode:'read'});assert.equal(s.emitted,2);
});
test('exact 4096-byte JSON is valid; any extra byte fails before JSON parsing',async()=>{
  const raw='"'+'x'.repeat(4094)+'"';
  const yes=await readBoundedJson(streamed([utf8(raw)]).request);
  assert.equal(yes.ok,true);assert.equal(yes.value.length,4094);
  const s=streamed([utf8(raw),utf8(' ')]);
  const no=await readBoundedJson(s.request);
  assert.equal(no.code,'REQUEST_TOO_LARGE');assert.equal(no.httpStatus,413);assert.equal(s.cancelled,true);
});
test('huge announced Content-Length rejected BEFORE reading stream',async()=>{
  const s=streamed([utf8('{"mode":"read"}')],'50000000');
  const r=await readBoundedJson(s.request);
  assert.equal(r.code,'REQUEST_TOO_LARGE');assert.equal(s.emitted,0);
});
test('a falsely small Content-Length cannot bypass byte counting',async()=>{
  const s=streamed([utf8('{"x":"'),utf8('z'.repeat(4096)),utf8('"}')],'1');
  const r=await readBoundedJson(s.request);
  assert.equal(r.code,'REQUEST_TOO_LARGE');assert.equal(s.cancelled,true);
});
test('boundary is measured in bytes, not JS characters',async()=>{
  const value='"'+'中'.repeat(1365)+'"';
  const result=await readBoundedJson(streamed([utf8(value)]).request);
  assert.equal(result.code,'REQUEST_TOO_LARGE');
});
test('invalid UTF-8 fails closed (no replacement-character parsing)',async()=>{
  const r=await readBoundedJson(streamed([new Uint8Array([0x22,0xff,0x22])]).request);
  assert.equal(r.code,'BAD_JSON');assert.equal(r.httpStatus,400);
});
test('truncated JSON and empty body fail closed',async()=>{
  for(const chunks of [[utf8('{"mode":')],[]]){
    const r=await readBoundedJson(streamed(chunks).request);
    assert.equal(r.code,'BAD_JSON');
  }
});
test('malformed length strings rejected without stream access',async()=>{
  for(const str of ['-2','1.1','+2','00','1e12','not-number',' ']){
    const s=streamed([utf8('true')],str);
    const r=await readBoundedJson(s.request);
    assert.equal(r.code,'BAD_CONTENT_LENGTH');assert.equal(s.emitted,0);
  }
});
test('missing or unusable body fails closed',async()=>{
  const r=await readBoundedJson({headers:new Headers(),body:null});
  assert.equal(r.code,'BAD_JSON');
});
test('a stream read error reveals no request/exception contents',async()=>{
  const s={headers:new Headers(),body:{getReader:()=>({
    read:async()=>{throw Error('private save contents')},cancel:()=>Promise.resolve()})}};
  const r=await readBoundedJson(s);
  assert.equal(r.code,'BODY_READ_UNAVAILABLE');
  assert.equal(JSON.stringify(r).includes('private save contents'),false);
});
test('stalled stream expires without waiting on cancel() completion',async()=>{
  let cancelCalled=0;
  const s={headers:new Headers(),body:{getReader:()=>({
    read:()=>new Promise(()=>{}),cancel:()=>{cancelCalled++;return new Promise(()=>{});}})}};
  const started=Date.now(),r=await readBoundedJson(s,{deadlineMs:25});
  assert.equal(r.code,'BODY_READ_UNAVAILABLE');assert.equal(r.httpStatus,408);
  assert.ok(Date.now()-started<1000);assert.equal(cancelCalled,1);
});
test('invalid quota settings cannot disable size/deadline safeguards',async()=>{
  for(const maxBytes of [0,65537,NaN,1.2])
    await assert.rejects(readBoundedJson({}, {maxBytes}),/Invalid request body limits/);
  for(const deadlineMs of [0,30001,'none'])
    await assert.rejects(readBoundedJson({}, {deadlineMs}),/Invalid request body limits/);
});
test('Edge draft uses bounded reader, not whole-body Request.text()',()=>{
  const code=readFileSync(new URL('../supabase/functions/merge-game/index.ts',import.meta.url),'utf8');
  assert.ok(code.includes('readBoundedJson(request)'));
  assert.ok(!code.includes('await request.text()'));
  assert.ok(code.includes('parsed.httpStatus'));
  const parser=readFileSync(new URL('../merge/cloud/bounded-json.mjs',import.meta.url),'utf8');
  assert.ok(parser.includes("refusal('REQUEST_TOO_LARGE',413)"));
});
