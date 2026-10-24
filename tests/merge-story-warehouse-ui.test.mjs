import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialState,storeItem,withdrawItem,fulfillOrder,validateSave} from '../merge/engine.mjs';
import {SAVE_KEY} from '../merge/storage.mjs';
import {STORY_WORKSHOP_KEY,readStoryWorkshop,writeStoryWorkshop} from '../merge/story/workshop-storage.mjs';

const storage=()=>{const data=new Map();return {
  getItem:key=>data.has(key)?data.get(key):null,
  setItem:(key,value)=>data.set(key,value)
};};

test('story warehouse stores real order material and requires withdrawal before fulfillment',()=>{
  const state=createInitialState(1000000),order=state.orders[0];
  const index=state.board.findIndex(item=>item?.kind==='material'&&item.chain===order.chain&&item.tier===order.tier);
  assert.ok(index>=0);
  const item=state.board[index];
  const stored=storeItem(state,index);
  assert.equal(stored.ok,true);
  assert.equal(stored.state.board[index],null);
  assert.equal(stored.state.warehouse.slots[0].id,item.id);
  assert.equal(fulfillOrder(stored.state,order.id).ok,false,'warehouse contents are not silently spendable');
  const withdrawn=withdrawItem(stored.state,0);
  assert.equal(withdrawn.ok,true);
  assert.equal(withdrawn.state.warehouse.slots[0],null);
  assert.equal(withdrawn.state.board.some(x=>x?.id===item.id),true);
  assert.equal(fulfillOrder(withdrawn.state,order.id).ok,true);
  assert.equal(validateSave(withdrawn.state),true);
});

test('story warehouse roundtrip persists only to story key and preserves normal-mode save',()=>{
  const db=storage(),state=createInitialState(1000000);
  db.setItem(SAVE_KEY,JSON.stringify(state));
  const normalBefore=db.getItem(SAVE_KEY);
  const stored=storeItem(state,16);
  assert.equal(stored.ok,true);
  assert.equal(writeStoryWorkshop(db,stored.state,{expectedRaw:null}),true);
  const raw=db.getItem(STORY_WORKSHOP_KEY);
  assert.ok(raw);
  const read=readStoryWorkshop(db);
  assert.equal(read.blocked,false);
  assert.equal(read.state.warehouse.slots[0].id,state.board[16].id);
  const withdrawn=withdrawItem(read.state,0);
  assert.equal(withdrawn.ok,true);
  assert.equal(writeStoryWorkshop(db,withdrawn.state,{expectedRaw:raw}),true);
  assert.equal(db.getItem(SAVE_KEY),normalBefore);
  assert.equal(readStoryWorkshop(db).state.warehouse.slots[0],null);
});

test('story warehouse mobile UI exposes real store/withdraw and actionable full-board guidance',()=>{
  const html=readFileSync(new URL('../merge/story-workshop.html',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../merge/story/workshop.mjs',import.meta.url),'utf8');
  const css=readFileSync(new URL('../merge/story/workshop.css',import.meta.url),'utf8');
  for(const id of ['warehouse-occupancy','board-occupancy','warehouse-hint','store-selected','workshop-warehouse'])
    assert.ok(html.includes('id="'+id+'"'),id);
  assert.ok(ui.includes('commit(storeItem(state,selected))'));
  assert.ok(ui.includes('commit(withdrawItem(state,i))'));
  assert.ok(ui.includes('state.warehouse.capacity'));
  assert.ok(ui.includes('boardHasSpace'));
  assert.ok(ui.includes('棋盘和仓库都满'));
  assert.ok(ui.includes('button.disabled=blocked||!item||!boardHasSpace'));
  assert.ok(css.includes('min-height:48px'));
  assert.ok(css.includes('grid-template-columns:repeat(2,minmax(0,1fr))'));
  assert.ok(css.includes('prefers-color-scheme:dark'));
  assert.ok(css.includes('prefers-reduced-motion:reduce'));
  for(const dangerous of ['innerHTML','insertAdjacentHTML','fetch(','sendBeacon(','SAVE_KEY'])
    assert.equal(ui.includes(dangerous),false,dangerous);
});
