import test from 'node:test';
import assert from 'node:assert/strict';
import {isPreparedExportUnchanged} from '../merge/save-export-snapshot.mjs';
const receipt=content=>({ok:true,content});

test('P2.65v export rechecks exact raw bytes, not only revision or parsed JSON',()=>{
  const raw='{"revision":3,"coins":7}';
  assert.equal(isPreparedExportUnchanged(receipt(raw),()=>raw),true);
  assert.equal(isPreparedExportUnchanged(receipt(raw),()=>'{"coins":7,"revision":3}'),false);
  assert.equal(isPreparedExportUnchanged(receipt(raw),()=>'{"revision":3,"coins":8}'),false);
});
test('P2.65v UTF-16 escaped envelope compares original unpaired surrogate code units',()=>{
  const raw='prefix\ud800suffix';
  const wrapped={ok:true,wrapped:true,content:JSON.stringify({format:'yunyu-normal-raw-utf16-v1',raw})};
  assert.equal(isPreparedExportUnchanged(wrapped,()=>raw),true);
  assert.equal(isPreparedExportUnchanged(wrapped,()=>raw.replace('\ud800','\ufffd')),false);
  assert.equal(isPreparedExportUnchanged({...wrapped,content:'{bad'},()=>raw),false);
  assert.equal(isPreparedExportUnchanged({...wrapped,content:JSON.stringify({format:'other',raw})},()=>raw),false);
});
test('P2.65v unavailable or throwing storage fails closed without writing',()=>{
  assert.equal(isPreparedExportUnchanged(receipt('x'),()=>{throw Error('storage denied');}),false);
  assert.equal(isPreparedExportUnchanged(receipt('x'),null),false);
  assert.equal(isPreparedExportUnchanged({ok:false,content:'x'},()=> 'x'),false);
  assert.equal(isPreparedExportUnchanged({ok:true,content:null},()=>null),false);
  assert.equal(isPreparedExportUnchanged(receipt('x'),()=>null),false);
});
