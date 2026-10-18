import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState, moveOrMerge, validateSave} from '../merge/engine.mjs';
import {loadLocal, saveLocal, SAVE_KEY, LEGACY_BACKUP_KEY, MAX_LOCAL_SAVE_BYTES} from '../merge/storage.mjs';
import {createInitialState as createLegacy} from '../merge/legacy-engine.mjs';

const start=()=>createInitialState(1_000_000);
function storage(initial={}) {
  const map=new Map(Object.entries(initial));
  return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),
    read:key=>map.get(key),map};
}

test('invalid JSON is quarantined: loading and ordinary saving never overwrite the original bytes',()=>{
  const raw='{truncated';const s=storage({[SAVE_KEY]:raw});
  const loaded=loadLocal(s,1_000_000);
  assert.equal(loaded.recovered,false);assert.equal(loaded.blocked,true);
  assert.equal(loaded.reason,'CORRUPT_SAVE');assert.equal(validateSave(loaded.state),true);
  assert.equal(saveLocal(s,loaded.state),false);assert.equal(s.read(SAVE_KEY),raw);
});

test('a user-confirmed reset can intentionally replace invalid bytes',()=>{
  const s=storage({[SAVE_KEY]:'{invalid'});
  assert.equal(saveLocal(s,start()),false);
  assert.equal(saveLocal(s,start(),{allowReset:true}),true);
  assert.equal(loadLocal(s).recovered,true);
});

test('schema-invalid but parseable saves are preserved, including duplicate IDs and forged balances',()=>{
  for(const mutate of [
    x=>{x.board[1].id=x.board[0].id},
    x=>{x.coins=-1},
    x=>{x.schemaVersion=999},
    x=>{x.board.pop()}
  ]) {
    const value=start();mutate(value);const raw=JSON.stringify(value);
    const s=storage({[SAVE_KEY]:raw});
    assert.equal(loadLocal(s).reason,'CORRUPT_SAVE');
    assert.equal(saveLocal(s,start()),false);
    assert.equal(s.read(SAVE_KEY),raw);
  }
});

test('stale browser tab cannot roll back a newer revision',()=>{
  const first=start(),newer=moveOrMerge(first,0,1).state;
  const s=storage({[SAVE_KEY]:JSON.stringify(newer)});
  assert.equal(saveLocal(s,first),false);
  assert.deepEqual(loadLocal(s).state,newer);
  assert.equal(saveLocal(s,newer),true);
});

test('valid local progress can be saved normally and recovered after restart',()=>{
  const s=storage(),state=moveOrMerge(start(),0,1).state;
  assert.equal(saveLocal(s,state),true);
  assert.deepEqual(loadLocal(s).state,state);
});

test('valid legacy save is backed up byte-for-byte before migrating',()=>{
  const legacy=createLegacy(1_000_000),raw=JSON.stringify(legacy),s=storage({[SAVE_KEY]:raw});
  const result=loadLocal(s);
  assert.equal(result.migrated,true);assert.equal(result.volatile,undefined);
  assert.equal(s.read(LEGACY_BACKUP_KEY),raw);
  assert.equal(JSON.parse(s.read(SAVE_KEY)).schemaVersion,2);
});

test('backup write denial keeps the only legacy save and marks the upgraded state volatile',()=>{
  const raw=JSON.stringify(createLegacy(1_000_000)),s=storage({[SAVE_KEY]:raw});
  const unsafe={getItem:s.getItem,setItem:(key,value)=>{
    if(key===LEGACY_BACKUP_KEY)throw Error('quota');s.setItem(key,value);
  }};
  const result=loadLocal(unsafe);
  assert.equal(result.recovered,true);assert.equal(result.migrated,true);
  assert.equal(result.volatile,true);assert.equal(result.reason,'BACKUP_UNAVAILABLE');
  assert.equal(s.read(SAVE_KEY),raw);
});

test('mismatched legacy backup is never silently overwritten or treated as safe',()=>{
  const raw=JSON.stringify(createLegacy(1_000_000));
  const s=storage({[SAVE_KEY]:raw,[LEGACY_BACKUP_KEY]:'different backup'});
  const result=loadLocal(s);
  assert.equal(result.reason,'BACKUP_UNAVAILABLE');
  assert.equal(s.read(SAVE_KEY),raw);
  assert.equal(s.read(LEGACY_BACKUP_KEY),'different backup');
});

test('migration save failure preserves legacy bytes and already-written backup',()=>{
  const raw=JSON.stringify(createLegacy(1_000_000)),s=storage({[SAVE_KEY]:raw});
  const failing={getItem:s.getItem,setItem:(key,value)=>{
    if(key===SAVE_KEY)throw Error('quota');s.setItem(key,value);
  }};
  const result=loadLocal(failing);
  assert.equal(result.reason,'WRITE_FAILED');assert.equal(result.volatile,true);
  assert.equal(s.read(SAVE_KEY),raw);assert.equal(s.read(LEGACY_BACKUP_KEY),raw);
});

test('migration cannot replace changed legacy bytes after backup verification',()=>{
  const raw=JSON.stringify(createLegacy(1_000_000));
  const changed=JSON.stringify(createLegacy(1_000_001));
  const s=storage({[SAVE_KEY]:changed,[LEGACY_BACKUP_KEY]:raw});
  assert.equal(saveLocal(s,start(),{migrationRaw:raw}),false);
  assert.equal(s.read(SAVE_KEY),changed);
});

test('read exceptions, missing storage and malformed values fail closed',()=>{
  const blocked=loadLocal({getItem:()=>{throw Error('denied')},setItem:()=>{}},1_000_000);
  assert.equal(blocked.reason,'STORAGE_UNAVAILABLE');
  assert.equal(loadLocal(null,1_000_000).blocked,true);
  const s=storage({[SAVE_KEY]:'null'});
  assert.equal(loadLocal(s,1_000_000).blocked,true);
  assert.equal(saveLocal(s,start()),false);
});

test('oversized local data is never parsed as a valid save or overwritten without consent',()=>{
  const raw='x'.repeat(MAX_LOCAL_SAVE_BYTES+1),s=storage({[SAVE_KEY]:raw});
  assert.equal(loadLocal(s,1_000_000).reason,'CORRUPT_SAVE');
  assert.equal(saveLocal(s,start()),false);
  assert.equal(s.read(SAVE_KEY),raw);
});

test('storage setItem failure cannot report a successful save',()=>{
  const raw=JSON.stringify(start());const s=storage({[SAVE_KEY]:raw});
  const denied={getItem:s.getItem,setItem:()=>{throw Error('quota')}};
  assert.equal(saveLocal(denied,moveOrMerge(start(),0,1).state),false);
  assert.equal(s.read(SAVE_KEY),raw);
});