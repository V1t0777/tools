import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Exercise the production board click listener rather than a copy.
// The browser suite separately checks Chromium touch dispatch.
const source=readFileSync(new URL('../merge/main-locked.mjs',import.meta.url),'utf8');
const start=source.indexOf("board.addEventListener('click', event => {");
const end=source.indexOf('const rejectBoardPointer=()=>',start);
assert.ok(start>=0&&end>start,'ordinary board click listener must exist');
const listener=source.slice(start,end);

function click({lease=null,detail=1,pointerEvents=true,ignored=false}={}){
  const actions=[],hints=[];
  let handler=null;
  const board={
    addEventListener(type,fn){assert.equal(type,'click');handler=fn;},
    contains(){return true;}
  };
  const context={
    board,window:pointerEvents?{PointerEvent:class PointerEvent{}}:{},
    boardPointerLease:lease,ignoreNextClick:ignored,
    persistentGestureGeneration:5,renderGeneration:9,
    touchCell(slot){actions.push(slot);},hint(message){hints.push(message);}
  };
  runInNewContext(listener,context);
  assert.equal(typeof handler,'function');
  const cell={dataset:{slot:'42'}};
  handler({detail,target:{closest:()=>cell}});
  return {actions,hints,remainingLease:context.boardPointerLease,
    ignored:context.ignoreNextClick};
}

test('PointerEvent browser rejects board click with no pointerdown lease',()=>{
  const result=click();
  assert.deepEqual(result.actions,[]);
  assert.equal(result.hints.length,1);
  assert.equal(result.remainingLease,null);
});

test('valid current pointerdown lease still accepts a board tap',()=>{
  const result=click({lease:{generation:5,render:9,slot:42}});
  assert.deepEqual(result.actions,[42]);
  assert.equal(result.hints.length,0);
  assert.equal(result.remainingLease,null);
});

test('keyboard activation remains accessible without pointerdown lease',()=>{
  const result=click({detail:0,ignored:true});
  assert.deepEqual(result.actions,[42]);
  assert.equal(result.hints.length,0);
});

test('older WebView without PointerEvent keeps compatibility click fallback',()=>{
  const result=click({pointerEvents:false});
  assert.deepEqual(result.actions,[42]);
  assert.equal(result.hints.length,0);
});

test('outdated render or gesture generation rejects a delayed click',()=>{
  for(const lease of [{generation:4,render:9,slot:42},
    {generation:5,render:8,slot:42},{generation:5,render:9,slot:41}]){
    const result=click({lease});
    assert.deepEqual(result.actions,[]);
    assert.equal(result.hints.length,1);
  }
});

test('blocked pointer lease never turns into a new gameplay action',()=>{
  const result=click({lease:{blocked:true},ignored:true});
  assert.deepEqual(result.actions,[]);
  assert.equal(result.hints.length,1);
  assert.equal(result.ignored,false);
});

const persistentStart=source.indexOf('function guardPersistentChooserClick(');
const persistentEnd=source.indexOf('function renderOrders()',persistentStart);
assert.ok(persistentStart>=0&&persistentEnd>persistentStart,
  'persistent control click guard must exist');
const persistentHandler=source.slice(persistentStart,persistentEnd);

function persistentClick({pointerEvents=true,down=false,detail=1,changed=false}={}){
  const handlers=new Map(),actions=[],hints=[];
  const context={
    window:pointerEvents?{PointerEvent:class PointerEvent{}}:{},
    persistentGestureGeneration:5,renderGeneration:9,
    importPending:()=>false,hint(message){hints.push(message);}
  };
  runInNewContext(persistentHandler,context);
  context.guardPersistentChooserClick({
    addEventListener(type,fn){handlers.set(type,fn);}
  },()=>actions.push('accepted'));
  if(down)handlers.get('pointerdown')();
  if(changed)context.persistentGestureGeneration++;
  handlers.get('click')({detail});
  return {actions,hints};
}

test('persistent controls reject missing pointer lease on PointerEvent browsers',()=>{
  const result=persistentClick();
  assert.deepEqual(result.actions,[]);
  assert.equal(result.hints.length,1);
});

test('persistent controls accept fresh pointerdown lease',()=>{
  const result=persistentClick({down:true});
  assert.deepEqual(result.actions,['accepted']);
  assert.equal(result.hints.length,0);
});

test('persistent controls accept keyboard activation without pointerdown',()=>{
  const result=persistentClick({detail:0});
  assert.deepEqual(result.actions,['accepted']);
  assert.equal(result.hints.length,0);
});

test('persistent controls preserve old WebView click fallback',()=>{
  const result=persistentClick({pointerEvents:false});
  assert.deepEqual(result.actions,['accepted']);
  assert.equal(result.hints.length,0);
});

test('persistent controls reject stale pointer generation after chooser',()=>{
  const result=persistentClick({down:true,changed:true});
  assert.deepEqual(result.actions,[]);
  assert.equal(result.hints.length,1);
});
