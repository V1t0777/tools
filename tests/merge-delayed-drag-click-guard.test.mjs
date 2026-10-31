import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Exercise the actual page handlers, not a duplicate implementation.
const source=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
function extract(start,end) {
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a,`missing page handler: ${start}`);
  return source.slice(a,b);
}
const handlers=[
  extract("board.addEventListener('click', event => {",
    "board.addEventListener('pointerdown', event => {"),
  extract("board.addEventListener('pointerdown', event => {",
    "board.addEventListener('pointermove', event => {"),
  extract("function completeDrag(event, cancelled = false) {",
    "board.addEventListener('pointerup', event => completeDrag(event));")
].join('\n');

function harness() {
  const listeners={},touched=[],cell={dataset:{slot:'1'},
    setPointerCapture(){}};
  const board={addEventListener(name,callback){listeners[name]=callback;},
    contains(node){return node===cell;}};
  const events={moves:0,commits:0,ghostRemovals:0,timers:0};
  const context={
    board,document:{elementFromPoint(){return {closest(){return cell;}};}},
    state:{board:[{kind:'material'},{kind:'material'}]},
    drag:{id:7,origin:0,moved:true,ghost:{remove(){events.ghostRemovals++;}}},
    ignoreNextClick:false,saveIssue:null,
    revalidateResumedSave(){},
    touchCell(slot){touched.push(slot);},
    moveOrMerge(){events.moves++;return {ok:true};},
    commit(action){events.commits++;if(typeof action==='function')action(context.state);},
    render(){throw Error('unexpected render');},
    hint(){throw Error('unexpected hint');},
    setTimeout(){events.timers++;throw Error('early click guard timer');}
  };
  runInNewContext(handlers,context);
  return {context,listeners,touched,events,cell,
    complete(){context.completeDrag({pointerId:7,clientX:10,clientY:20});},
    click(detail){listeners.click({detail,target:{closest(){return cell;}}});},
    pointerdown(){listeners.pointerdown({button:0,pointerId:8,
      clientX:10,clientY:20,target:{closest(){return cell;}}});}
  };
}

test('P2.61a completed drag consumes a delayed synthetic pointer click',()=>{
  const h=harness();
  h.complete();
  assert.equal(h.events.commits,1);
  assert.equal(h.events.moves,1);
  assert.equal(h.events.ghostRemovals,1);
  assert.equal(h.events.timers,0);
  assert.equal(h.context.ignoreNextClick,true);
  // The click may be dispatched in a later task, after pointerup.
  h.click(1);
  assert.deepEqual(h.touched,[]);
  assert.equal(h.context.ignoreNextClick,false);
  h.click(1);
  assert.deepEqual(h.touched,[1]);
});

test('P2.61a new genuine pointerdown clears an unconsumed stale-click guard',()=>{
  const h=harness();
  h.complete();
  assert.equal(h.context.ignoreNextClick,true);
  h.pointerdown();
  assert.equal(h.context.ignoreNextClick,false);
  assert.equal(h.context.drag.id,8);
  h.click(1);
  assert.deepEqual(h.touched,[1]);
});

test('P2.61a keyboard click bypasses guard without exposing delayed pointer click',()=>{
  const h=harness();
  h.complete();
  h.click(0);
  assert.deepEqual(h.touched,[1]);
  assert.equal(h.context.ignoreNextClick,true);
  h.click(1);
  assert.deepEqual(h.touched,[1]);
  assert.equal(h.context.ignoreNextClick,false);
});
