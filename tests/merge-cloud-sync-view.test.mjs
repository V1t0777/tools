import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCloudSyncStatus, paintCloudSyncStatus } from '../merge/cloud/sync-view.mjs';

test('unsupported cross-tab safety is explicit rather than pretending synchronization succeeded',()=>{
  const message=formatCloudSyncStatus({lockAvailable:false,phase:'unverified',pending:3});
  assert.equal(message.tone,'danger');
  assert.match(message.title,/不支持安全云同步/);
});
test('cache without fresh remote verification is not presented as synchronized',()=>{
  const message=formatCloudSyncStatus({phase:'synced',verified:false,pending:0,revision:18});
  assert.equal(message.tone,'muted');
});
test('server-verified revision is labeled as confirmed and pending commands remain visible',()=>{
  assert.equal(formatCloudSyncStatus({phase:'synced',verified:true,pending:0,revision:18}).tone,'success');
  assert.match(formatCloudSyncStatus({phase:'pending',verified:true,pending:2,revision:18}).detail,/2 个操作/);
});
test('conflict, network failure, and write-blocked states do not promise eventual success',()=>{
  for (const status of [{blocked:'conflict',pending:1},{phase:'offline',pending:1},
    {code:'LOCK_REQUEST_FAILED'},{phase:'storage-error'}])
    assert.notEqual(formatCloudSyncStatus(status).tone,'success');
});
test('view-only DOM hook uses textContent, accessibility labels, and no HTML parser',()=>{
  const attributes={};
  const el={textContent:'',setAttribute:(k,v)=>attributes[k]=v};
  const result=paintCloudSyncStatus(el,{phase:'offline',pending:4});
  assert.match(el.textContent,/4 个操作/);
  assert.equal(result.tone,'warning');
  assert.equal(attributes['aria-live'],'polite');
  assert.equal(attributes['role'],'status');
  assert.equal(attributes['data-sync-tone'],'warning');
});