import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCloudJournal,exportDamagedCloudJournal} from '../merge/cloud/journal-diagnostics.mjs';
import {queueStorageKey,MAX_STORED_BYTES} from '../merge/cloud/offline-queue.mjs';

const uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const key=queueStorageKey(uid);
const fresh=()=>JSON.stringify({version:1,uid,confirmed:null,pending:[],blocked:null});
function store(raw=null) {
  const values=new Map(),events={reads:0,writes:0};
  if (raw !== null) values.set(key,raw);
  return {
    events,
    getItem(k) {events.reads++;return values.has(k)?values.get(k):null;},
    setItem(k,v) {events.writes++;values.set(k,v);},
    original() {return values.get(key);}
  };
}

test('healthy queue inspection has no writes, raw content or false cloud verification',()=>{
  const storage=store(fresh()),diagnostic=inspectCloudJournal({uid,storage});
  assert.equal(diagnostic.code,'JOURNAL_VALID');
  assert.equal(diagnostic.damaged,false);
  assert.equal(diagnostic.pending,0);
  assert.equal(diagnostic.verified,false);
  assert.equal(diagnostic.canResumeCloudWrites,false);
  assert.equal(storage.events.reads,1);
  assert.equal(storage.events.writes,0);
  assert.equal(storage.original(),fresh());
  assert.equal(JSON.stringify(diagnostic).includes(uid),false);
  assert.equal(exportDamagedCloudJournal({uid,storage,confirmedByUser:true}).code,'NO_DAMAGED_JOURNAL');
});

test('missing storage key is not classified as corruption or remote success',()=>{
  const storage=store();
  const diagnostic=inspectCloudJournal({uid,storage});
  assert.equal(diagnostic.code,'JOURNAL_ABSENT');
  assert.equal(diagnostic.damaged,false);
  assert.equal(diagnostic.verified,false);
  assert.equal(storage.events.writes,0);
  assert.equal(exportDamagedCloudJournal({uid,storage,confirmedByUser:true}).code,'NO_DAMAGED_JOURNAL');
});

for (const [label,raw,expected] of [
  ['empty string','', 'JOURNAL_EMPTY'],
  ['malformed JSON','{"pending":', 'JOURNAL_INVALID_JSON'],
  ['wrong schema','{"version":1,"private":"do-not-log"}', 'JOURNAL_INVALID_SCHEMA'],
  ['JSON null','null', 'JOURNAL_INVALID_SCHEMA'],
  ['oversize','x'.repeat(MAX_STORED_BYTES+1),'JOURNAL_OVERSIZED'],
  ['non-string',undefined,'JOURNAL_NON_STRING']
]) {
  test('damaged journal is classified without mutation or raw disclosure: '+label,()=>{
    const storage=store('seed');
    storage.setItem(key,raw);
    storage.events.writes=0;
    const diagnostic=inspectCloudJournal({uid,storage});
    assert.equal(diagnostic.code,expected);
    assert.equal(diagnostic.damaged,true);
    assert.equal(diagnostic.canAutoRepair,false);
    assert.equal(diagnostic.canResumeCloudWrites,false);
    assert.equal(storage.events.writes,0);
    assert.equal(storage.original(),raw);
    assert.equal(JSON.stringify(diagnostic).includes('do-not-log'),false);
    assert.equal(JSON.stringify(diagnostic).includes(uid),false);
  });
}

test('schema-invalid attempted operation is diagnosed using the real queue validator',()=>{
  const pending=[{operationId:'00000000-0000-4000-8000-000000000001',
    action:{type:'produce',slot:42},expectedRevision:0,attempts:1,nextRetryAt:0}];
  const raw=JSON.stringify({version:1,uid,confirmed:null,pending,blocked:null});
  const storage=store(raw);
  assert.equal(inspectCloudJournal({uid,storage}).code,'JOURNAL_INVALID_SCHEMA');
  assert.equal(storage.original(),raw);
  assert.equal(storage.events.writes,0);
});

test('read exceptions and unavailable storage fail closed and reveal no journal',()=>{
  const exploding={getItem:()=>{throw Error('private storage failure')},
    setItem:()=>{throw Error('may not write')}};
  assert.equal(inspectCloudJournal({uid,storage:exploding}).code,'STORAGE_READ_FAILED');
  assert.equal(inspectCloudJournal({uid,storage:{}}).code,'STORAGE_READ_UNAVAILABLE');
  assert.equal(exportDamagedCloudJournal({uid,storage:exploding,confirmedByUser:true}).code,'NO_READABLE_EVIDENCE');
});

test('evidence export is explicit opt-in, preserves every original character, never writes',()=>{
  const raw='{"pending":\\n"PRIVATE_DATA":"original"}';
  const storage=store(raw);
  assert.equal(exportDamagedCloudJournal({uid,storage}).code,'USER_CONFIRMATION_REQUIRED');
  assert.equal(storage.events.reads,0,'no examination before user consent');
  const exported=exportDamagedCloudJournal({uid,storage,confirmedByUser:true});
  assert.equal(exported.ok,true);
  assert.equal(exported.code,'EVIDENCE_READY');
  assert.equal(exported.content,raw);
  assert.equal(exported.mimeType,'text/plain;charset=utf-8');
  assert.equal(exported.diagnosis,'JOURNAL_INVALID_JSON');
  assert.equal(exported.filename.includes(uid),false);
  assert.equal(storage.original(),raw);
  assert.equal(storage.events.writes,0);
});

test('unreadable, missing and huge evidence never becomes a reset action',()=>{
  const unreadable=store('bad');unreadable.setItem(key,{bad:true});
  assert.equal(exportDamagedCloudJournal({uid,storage:unreadable,confirmedByUser:true}).code,'NO_READABLE_EVIDENCE');
  const giant=store('x'.repeat(1_000_001));
  assert.equal(exportDamagedCloudJournal({uid,storage:giant,confirmedByUser:true}).code,'EVIDENCE_TOO_LARGE');
  assert.equal(giant.events.writes,0);
});

test('invalid account ID is rejected, not used to derive a storage key',()=>{
  assert.throws(()=>inspectCloudJournal({uid:'not-an-id',storage:store()}),/Valid account ID/);
});
