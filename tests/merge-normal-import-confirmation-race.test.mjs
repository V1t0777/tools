import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {RESTORE_BACKUP_KEY} from '../merge/save-restore-backup.mjs';
import {performNormalSaveImport} from '../merge/normal-save-import-flow.mjs';

// A native confirm() may pump page lifecycle/storage events. These tests
// exercise the real import preflight and its post-confirm authorization gate;
// only the final locked restore is a spy, so no test can overwrite a save.
function setup({downgrade=false}={}) {
  const current=JSON.stringify({...createInitialState(1),revision:downgrade?5:0});
  const candidate=JSON.stringify({...createInitialState(1),revision:downgrade?1:2,coins:37});
  const other=JSON.stringify({...createInitialState(1),revision:9,coins:91});
  const map=new Map([[SAVE_KEY,current],[STORY_SAVE_KEY,'story-unchanged'],
    [RESTORE_BACKUP_KEY,'original-backup']]);
  let epoch=0,confirms=0,restores=0;
  const storage={getItem:key=>map.get(key)??null,
    setItem(){throw Error('Import preflight must never write storage');}};
  const runtime={phase:'ready',blocked:false,busy:false,raw:current,
    async restore(){restores++;return {ok:true};}};
  const config={
    file:{size:new TextEncoder().encode(candidate).length,text:async()=>candidate},
    storage,runtime,confirm:()=>{confirms++;return true;},
    getEpoch:()=>epoch,isSuspended:()=>false,
    revalidate:()=>map.get(SAVE_KEY)===runtime.raw
  };
  const assertUntouched=()=>{
    assert.equal(restores,0,'invalidated consent must never reach locked restore');
    assert.equal(map.get(STORY_SAVE_KEY),'story-unchanged');
    assert.equal(map.get(RESTORE_BACKUP_KEY),'original-backup');
  };
  return {config,map,runtime,other,assertUntouched,
    get confirms(){return confirms;},
    bumpEpoch(){epoch++;}
  };
}

test('P2.65bl pagehide during first destructive confirmation revokes import',async()=>{
  const f=setup();
  f.config.confirm=()=>{f.bumpEpoch();return true;};
  const result=await performNormalSaveImport(f.config);
  assert.equal(result.reason,'PAGE_SUSPENDED');
  assert.equal(f.map.get(SAVE_KEY),f.runtime.raw);
  f.assertUntouched();
});

test('P2.65bl cross-tab write during first confirmation revokes old consent',async()=>{
  const f=setup();
  f.config.confirm=()=>{f.map.set(SAVE_KEY,f.other);return true;};
  const result=await performNormalSaveImport(f.config);
  assert.equal(result.reason,'SAVE_CHANGED');
  assert.equal(f.map.get(SAVE_KEY),f.other,'must preserve newer tab bytes');
  f.assertUntouched();
});

test('P2.65bl busy runtime during confirmation cannot authorize restore',async()=>{
  const f=setup();
  f.config.confirm=()=>{f.runtime.busy=true;return true;};
  const result=await performNormalSaveImport(f.config);
  assert.equal(result.reason,'SAVE_NOT_READY');
  assert.equal(f.map.get(SAVE_KEY),f.runtime.raw);
  f.assertUntouched();
});

test('P2.65bl pagehide during second downgrade confirmation revokes both consents',async()=>{
  const f=setup({downgrade:true});
  let confirmations=0;
  f.config.confirm=()=>{if(++confirmations===2)f.bumpEpoch();return true;};
  const result=await performNormalSaveImport(f.config);
  assert.equal(confirmations,2,'downgrade must require a second distinct consent');
  assert.equal(result.reason,'PAGE_SUSPENDED');
  assert.equal(f.map.get(SAVE_KEY),f.runtime.raw);
  f.assertUntouched();
});

test('P2.65bl cross-tab write during second downgrade confirmation cannot roll back',async()=>{
  const f=setup({downgrade:true});
  let confirmations=0;
  f.config.confirm=()=>{if(++confirmations===2)f.map.set(SAVE_KEY,f.other);return true;};
  const result=await performNormalSaveImport(f.config);
  assert.equal(confirmations,2);
  assert.equal(result.reason,'SAVE_CHANGED');
  assert.equal(f.map.get(SAVE_KEY),f.other);
  f.assertUntouched();
});
