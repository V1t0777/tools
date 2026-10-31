import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const main=readFileSync(new URL('../merge/main.mjs',import.meta.url),'utf8');
function section(start,end){
  const a=main.indexOf(start),b=main.indexOf(end,a);
  assert.ok(a>=0&&b>a,'missing real page handler: '+start);
  return main.slice(a,b);
}
test('P2.61c blocked normal save cannot select or produce an old board item',()=>{
  const code=section('function touchCell(slot) {','function formatSeconds');
  for(const issue of ['CURRENT_SAVE_CHANGED','SAVE_REMOVED','CORRUPT_SAVE']){
    const messages=[],board=[{kind:'material'},{kind:'producer'}];
    const ctx={saveIssue:issue,state:{board},selected:-1,
      revalidateResumedSave(){},
      hint(x){messages.push(x);},render(){throw Error('blocked render');},
      maybeProduce(){throw Error('blocked produce');},
      moveOrMerge(){throw Error('blocked move');},commit(){throw Error('blocked commit');}};
    runInNewContext(code,ctx);
    ctx.touchCell(0);ctx.touchCell(1);
    assert.equal(ctx.selected,-1);
    assert.equal(messages.length,2);
    assert.match(messages[0],/暂停/);
  }
  let renders=0;
  const ctx={saveIssue:null,state:{board:[{kind:'material'}]},selected:-1,
    revalidateResumedSave(){},
    hint(){throw Error('healthy select should not warn');},render(){renders++;}};
  runInNewContext(code,ctx);
  ctx.touchCell(0);
  assert.equal(ctx.selected,0);
  assert.equal(renders,1);
});
test('P2.61c blocked save cannot start stale pointer capture or drag',()=>{
  const code=section("board.addEventListener('pointerdown', event => {",
    "board.addEventListener('pointermove', event => {");
  for(const issue of ['CURRENT_SAVE_CHANGED',null]){
    let captured=0;
    const cell={dataset:{slot:'0'},setPointerCapture(){captured++;}};
    const board={listener:null,addEventListener(name,fn){
      assert.equal(name,'pointerdown');this.listener=fn;}};
    const ctx={board,saveIssue:issue,ignoreNextClick:true,drag:null,
      revalidateResumedSave(){},
      state:{board:[{kind:'material'}]}};
    runInNewContext(code,ctx);
    board.listener({button:0,pointerId:4,clientX:12,clientY:15,
      target:{closest(){return cell;}}});
    assert.equal(captured,issue?0:1);
    assert.equal(ctx.drag?.id,issue?undefined:4);
    assert.equal(ctx.ignoreNextClick,!!issue);
  }
});
test('P2.61c blocked save cannot produce stale guidance',()=>{
  const code=section("byId('board-guide').addEventListener('click', () => {",
    "board.addEventListener('click', event => {");
  for(const issue of ['CURRENT_SAVE_CHANGED',null]){
    let click,calculated=0,rendered=0,notified=0;
    const ctx={saveIssue:issue,selected:2,activeGuidance:null,state:{},
      byId(id){assert.equal(id,'board-guide');return {
        addEventListener(type,fn){assert.equal(type,'click');click=fn;}};},
      getBoardGuidance(){calculated++;return {boardSlots:[1]};},
      render(){rendered++;},hint(){notified++;}};
    runInNewContext(code,ctx);click();
    assert.equal(calculated,issue?0:1);
    assert.equal(rendered,issue?0:1);
    assert.equal(notified,issue?1:0);
    assert.equal(ctx.selected,issue?2:-1);
  }
});
