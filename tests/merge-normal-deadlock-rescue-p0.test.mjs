import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,validateSave,MAX_TIER} from '../merge/engine.mjs';
import {discardDeadlockedMaterial} from '../merge/deadlock-rescue.mjs';
import {diagnoseBoard} from '../merge/board-diagnostics.mjs';
import {createNormalPageRuntime} from '../merge/normal-page-runtime.mjs';
import {SAVE_KEY,ABNORMAL_RESET_BACKUP_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {RESTORE_BACKUP_KEY} from '../merge/save-restore-backup.mjs';
import {NORMAL_SAVE_LOCK_NAME} from '../merge/normal-save-lock.mjs';
const now=1000;
function full(){
  const s=createInitialState(now);
  for(let i=0;i<s.board.length;i++)if(s.board[i]?.kind!=='producer')
    s.board[i]={id:'m'+s.nextId++,kind:'material',chain:'tea',tier:MAX_TIER};
  for(let i=0;i<s.warehouse.capacity;i++)
    s.warehouse.slots[i]={id:'m'+s.nextId++,kind:'material',chain:'tea',tier:MAX_TIER};
  assert.equal(validateSave(s),true);
  assert.equal(diagnoseBoard(s).recovery,'hard-deadlock');
  return s;
}
function db(state){
  const map=new Map([[SAVE_KEY,JSON.stringify(state)],
    [STORY_SAVE_KEY,'story-original'],
    [RESTORE_BACKUP_KEY,'restore-original'],
    [ABNORMAL_RESET_BACKUP_KEY,'abnormal-original']]);
  const writes=[];
  return {writes,getItem:k=>map.has(k)?map.get(k):null,
    setItem(k,v){writes.push(k);map.set(k,v);}};
}
function locks(){
  let held=false;
  return {request(name,options,callback){
    assert.equal(name,NORMAL_SAVE_LOCK_NAME);
    assert.deepEqual(options,{mode:'exclusive',ifAvailable:true});
    if(held)return Promise.resolve(callback(null));
    held=true;
    return Promise.resolve().then(()=>callback({name,mode:'exclusive'}))
      .finally(()=>{held=false;});
  }};
}
test('P0 rescue is one Web-Locked revisioned write without resource or mode leakage',async()=>{
  const initial=full(),storage=db(initial),lock=locks();
  const a=createNormalPageRuntime({storage,locks:lock});
  const b=createNormalPageRuntime({storage,locks:lock});
  assert.equal((await a.start({now})).ok,true);
  assert.equal((await b.start({now})).ok,true);
  const slot=initial.board.findIndex(x=>x?.kind==='material');
  const id=initial.board[slot].id,original=storage.getItem(SAVE_KEY);
  const before=storage.writes.length;
  assert.equal((await a.action(s=>discardDeadlockedMaterial(s,slot,
    {confirmed:true,expectedItemId:id}))).ok,true);
  assert.equal(storage.writes.length,before+1);
  const next=JSON.parse(storage.getItem(SAVE_KEY));
  assert.equal(next.revision,initial.revision+1);
  assert.equal(next.board[slot],null);
  assert.equal(next.coins,initial.coins);
  assert.equal(next.xp,initial.xp);
  assert.deepEqual(next.orders,initial.orders);
  assert.deepEqual(next.warehouse,initial.warehouse);
  assert.equal(validateSave(next),true);
  assert.notEqual(storage.getItem(SAVE_KEY),original);
  assert.equal(storage.getItem(STORY_SAVE_KEY),'story-original');
  assert.equal(storage.getItem(RESTORE_BACKUP_KEY),'restore-original');
  assert.equal(storage.getItem(ABNORMAL_RESET_BACKUP_KEY),'abnormal-original');
  const writes=storage.writes.length;
  assert.equal((await a.action(s=>discardDeadlockedMaterial(s,slot,
    {confirmed:true,expectedItemId:id}))).reason,'ACTION_REJECTED');
  assert.equal(storage.writes.length,writes);
  assert.equal((await b.action(s=>discardDeadlockedMaterial(s,slot,
    {confirmed:true,expectedItemId:id}))).reason,'STALE_BASELINE');
  assert.equal(b.blocked,true);
  assert.equal(storage.writes.length,writes);
});
test('P0 rescue refuses a full board when normal merge remains possible',()=>{
  const s=full(),slot=s.board.findIndex(x=>x?.kind==='material');
  const another=s.board.findIndex((x,i)=>i!==slot&&x?.kind==='material');
  s.board[slot]={...s.board[slot],tier:1};
  s.board[another]={...s.board[another],tier:1};
  assert.equal(diagnoseBoard(s).recovery,'recoverable');
  const raw=JSON.stringify(s);
  const result=discardDeadlockedMaterial(s,slot,
    {confirmed:true,expectedItemId:s.board[slot].id});
  assert.equal(result.ok,false);
  assert.equal(JSON.stringify(s),raw);
});
test('P0 rescue UI defaults disabled, requires confirmation and snapshot binding',async()=>{
  const fs=await import('node:fs/promises');
  const html=await fs.readFile(new URL('../merge/index.html',import.meta.url),'utf8');
  const js=await fs.readFile(new URL('../merge/main-locked.mjs',import.meta.url),'utf8');
  assert.match(html,/id="deadlock-discard"[^>]*disabled/);
  assert.match(js,/diagnoseBoard\(state\)\.recovery!=='hard-deadlock'/);
  assert.match(js,/guardPersistentChooserClick\(byId\('deadlock-discard'\)/);
  assert.match(js,/window\.confirm\('棋盘和仓库已满/);
  assert.match(js,/reviewedRaw=runtime\.raw/);
});
