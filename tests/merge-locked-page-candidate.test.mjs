import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const read=path=>readFileSync(new URL('../merge/'+path,import.meta.url),'utf8');
const candidate=read('main-locked.mjs');
const live=read('main.mjs');
const html=read('index.html');

test('P2.64b candidate is valid ESM',()=>{
  const result=spawnSync(process.execPath,
    ['--check',new URL('../merge/main-locked.mjs',import.meta.url).pathname],
    {encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});

test('P2.64b startup, action, clock and reset use one exclusive page runtime',()=>{
  assert.match(candidate,/import \{ createNormalPageRuntime \} from '\.\/normal-page-runtime\.mjs'/);
  assert.match(candidate,/const runtime=createNormalPageRuntime\(/);
  for(const writer of ['start','action','clock','reset'])
    assert.match(candidate,new RegExp('runtime\\.'+writer+'\\('),writer);
  assert.match(candidate,/locks:window\.navigator\?\.locks\?\?null/);
  for(const unsafe of ['loadLocal(store)','prepareNormalStartup(loaded,store)',
    'commitNormalSnapshot(store,','persist(result.state)',
    'persist(resetState','advanceTime(state,now)','setItem('])
    assert.equal(candidate.includes(unsafe),false,unsafe);
});

test('P2.64b lifecycle is read-only and drops stale gestures',()=>{
  assert.match(candidate,/attachNormalPageLifecycle\(\{/);
  assert.match(candidate,/runtime\.reconcile\(\)/);
  assert.match(candidate,/cancelStaleGesture\(\)/);
  for(const oldHandler of ["window.addEventListener('storage'",
    "window.addEventListener('pageshow'","window.addEventListener('focus'"])
    assert.equal(candidate.includes(oldHandler),false,oldHandler);
});

test('P2.64b startup and UI interactions fail closed during asynchronous writes',()=>{
  assert.match(candidate,/saveIssue='STARTUP_REQUIRED'/);
  assert.match(candidate,/if\(saveIssue\|\|runtime\.busy\)/);
  assert.match(candidate,/onVerified\(next,raw,kind\)/);
  assert.match(candidate,/handleTransactionResult\(await runtime\.action\(operation\),'action'\)/);
  assert.match(candidate,/timerPending=true/);
  assert.match(candidate,/runtime\.clock\(\{now:Date\.now\(\)\}\)/);
});

test('P2.64b confirmed abnormal reset backs up original bytes',()=>{
  assert.match(candidate,/window\.confirm\(/);
  assert.match(candidate,/requireOriginalBackup:true/);
  assert.match(candidate,/expectedRaw:initialOriginalRaw/);
  assert.match(candidate,/runtime\.reset\(\{confirmed:true/);
  assert.match(candidate,/if\(saveIssue&&!damaged\)/);
});

test('P2.64b candidate preserves UI and cannot silently replace live page',()=>{
  for(const fn of ['renderBoard','renderOrders','renderSystems','renderSupplies',
    'renderNormalMilestones','completeDrag','refreshSupplyControls'])
    assert.match(candidate,new RegExp('function '+fn+'\\('),fn);
  assert.match(html,/src="\.\/main\.mjs"/);
  assert.doesNotMatch(html,/main-locked\.mjs/);
  assert.match(live,/const loaded = loadLocal\(store\)/);
  assert.doesNotMatch(live,/createNormalPageRuntime/);
});
