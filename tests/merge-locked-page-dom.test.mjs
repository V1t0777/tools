import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SAVE_KEY,ABNORMAL_RESET_BACKUP_KEY} from '../merge/storage.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {NORMAL_SAVE_LOCK_NAME} from '../merge/normal-save-lock.mjs';
import {createInitialState,storeItem} from '../merge/engine.mjs';

class Element {
  constructor(tag='div') {
    this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;
    this.dataset={};this.style={};this.listeners=new Map();this.attributes=new Map();
    this.classList={toggle(){},add(){},remove(){}};
    this._text='';this._value='';this.disabled=false;
  }
  get textContent(){return this._text||this.children.map(e=>e.textContent).join('');}
  set textContent(value){this._text=String(value);this.children=[];}
  get value(){
    return this.tagName==='SELECT'&&!this._value
      ?(this.options[0]?.value??''):this._value;
  }
  set value(value){this._value=String(value);}
  get options(){return this.children.filter(e=>e.tagName==='OPTION');}
  append(...nodes) {
    for(const node of nodes){
      if(node.tagName==='#FRAGMENT'){this.append(...node.children);continue;}
      node.parentElement=this;this.children.push(node);
    }
  }
  replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}
  setAttribute(key,value){this.attributes.set(key,String(value));}
  getAttribute(key){return this.attributes.get(key)??null;}
  addEventListener(type,fn){
    const handlers=this.listeners.get(type)??[];
    handlers.push(fn);this.listeners.set(type,handlers);
  }
  removeEventListener(type,fn){
    this.listeners.set(type,(this.listeners.get(type)??[]).filter(x=>x!==fn));
  }
  dispatch(type,extra={}) {
    for(const fn of this.listeners.get(type)??[])
      fn({type,target:this,detail:1,button:0,pointerId:1,
        clientX:0,clientY:0,...extra});
  }
  closest(selector){
    if(selector!=='[data-slot]')throw Error('unexpected selector '+selector);
    for(let node=this;node;node=node.parentElement)
      if(node.dataset.slot!==undefined)return node;
    return null;
  }
  contains(node){
    for(let parent=node;parent;parent=parent.parentElement)
      if(parent===this)return true;
    return false;
  }
  querySelector(selector){
    const match=/^\[data-supply-use="([^"]+)"\]$/.exec(selector);
    if(!match)throw Error('unexpected selector '+selector);
    const find=node=>{
      if(node.dataset.supplyUse===match[1])return node;
      for(const child of node.children){const found=find(child);if(found)return found;}
      return null;
    };
    return find(this);
  }
  remove(){
    if(this.parentElement)
      this.parentElement.children=this.parentElement.children.filter(x=>x!==this);
    this.parentElement=null;
  }
  click(){this.dispatch('click');}
  showModal(){this.open=true;}
  close(){this.open=false;}
}
// Import the actual script referenced by the ordinary-mode HTML entry,
 // rather than hardcoding a candidate module that the browser never loads.
const liveHtml=readFileSync(new URL('../merge/index.html',import.meta.url),'utf8');
const entryScripts=[...liveHtml.matchAll(/<script\b[^>]*type="module"[^>]*src="\.\/([^"]+)"[^>]*><\/script>/g)];
assert.equal(entryScripts.length,1,'exactly one ordinary-mode module entry');
assert.equal(entryScripts[0][1],'main-locked.mjs','live page must use locked entry');
const liveEntryUrl=new URL('../merge/'+entryScripts[0][1],import.meta.url);
let fixtureId=0;
const settle=async()=>{
  for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));
};
async function mount({initialRaw=null,locksAvailable=true}={}) {
  const map=new Map(),writes=[];
  if(initialRaw!==null)map.set(SAVE_KEY,initialRaw);
  map.set(STORY_SAVE_KEY,'story-not-touched');
  const storage={
    getItem:key=>map.has(key)?map.get(key):null,
    setItem(key,value){writes.push(key);map.set(key,String(value));}
  };
  let held=false;
  const locks={request(name,options,callback){
    assert.equal(name,NORMAL_SAVE_LOCK_NAME);
    assert.deepEqual(options,{mode:'exclusive',ifAvailable:true});
    if(held)return Promise.resolve(callback(null));
    held=true;
    return Promise.resolve().then(async()=>{
      if(win.pauseNextLock){
        win.pauseNextLock=false;
        await new Promise(resolve=>{win.releaseLock=resolve;});
      }
      return callback({name,mode:'exclusive'});
    }).finally(()=>{held=false;});
  }};
  const ids=new Map();
  const doc=new Element('document');
  doc.hidden=false;
  doc.body=new Element('body');
  doc.getElementById=id=>{
    if(!ids.has(id))ids.set(id,new Element(id==='supply-producer'?'select':'div'));
    return ids.get(id);
  };
  doc.createElement=tag=>new Element(tag);
  doc.createDocumentFragment=()=>new Element('#fragment');
  doc.elementFromPoint=()=>null;
  const win=new Element('window');
  win.localStorage=storage;
  win.navigator={locks:locksAvailable?locks:null};
  win.setInterval=fn=>{win.timer=fn;return 1;};
  win.setTimeout=()=>1;
  win.clearTimeout=()=>{};
  win.confirm=()=>true;
  globalThis.document=doc;
  globalThis.window=win;
  await import(liveEntryUrl.href+'?dom-fixture='+fixtureId++);
  await settle();
  return {doc,win,storage,map,writes,
    id:key=>doc.getElementById(key),
    saved:()=>JSON.parse(storage.getItem(SAVE_KEY))};
}

test('P2.64c actual candidate DOM: verified startup, board merge and confirmed reset',async()=>{
  const h=await mount();
  assert.match(h.id('save-status').textContent,/已保存于此浏览器/);
  assert.equal(h.saved().revision,0);
  const board=h.id('board');
  board.dispatch('click',{target:board.children[0],detail:1});
  board.dispatch('click',{target:board.children[1],detail:1});
  await settle();
  assert.equal(h.saved().revision,1);
  assert.equal(h.saved().board[0],null);
  assert.equal(h.saved().board[1].tier,2);
  h.id('reset').click();
  await settle();
  assert.equal(h.saved().revision,0);
  assert.equal(h.saved().board[0].tier,1);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
  assert.deepEqual(h.writes,[SAVE_KEY,SAVE_KEY,SAVE_KEY]);
});

test('P2.64c actual candidate DOM: storage fork during drag blocks and consumes late click',async()=>{
  const h=await mount(),board=h.id('board');
  const first=board.children[0],second=board.children[1];
  board.dispatch('pointerdown',{target:first,pointerId:5,clientX:0,clientY:0});
  board.dispatch('pointermove',{target:first,pointerId:5,clientX:15,clientY:0});
  const saved=h.saved();
  h.storage.setItem(SAVE_KEY,JSON.stringify({...saved,coins:saved.coins+99}));
  const count=h.writes.length;
  h.win.dispatch('storage',{storageArea:h.storage,key:SAVE_KEY});
  assert.match(h.id('save-status').textContent,/已暂停/);
  board.dispatch('click',{target:second,detail:1});
  await settle();
  assert.equal(h.writes.length,count);
  assert.equal(h.saved().coins,99);
  assert.equal(h.saved().revision,0);
});

test('P2.64c actual candidate DOM: corrupt original remains until backed-up confirmed reset',async()=>{
  const raw='{bad-original',h=await mount({initialRaw:raw});
  assert.equal(h.storage.getItem(SAVE_KEY),raw);
  assert.match(h.id('save-status').textContent,/异常存档/);
  assert.equal(h.writes.length,0);
  h.id('reset').click();
  await settle();
  assert.equal(h.storage.getItem(ABNORMAL_RESET_BACKUP_KEY),raw);
  assert.equal(h.saved().revision,0);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.64c actual candidate DOM: absent Web Locks never writes or resets',async()=>{
  const h=await mount({locksAvailable:false});
  assert.equal(h.storage.getItem(SAVE_KEY),null);
  assert.equal(h.writes.length,0);
  h.id('board').dispatch('click',{target:h.id('board').children[0],detail:1});
  h.id('reset').click();
  await settle();
  assert.equal(h.writes.length,0);
  assert.match(h.id('save-status').textContent,/已暂停/);
});

test('P2.64c supply tap captures producer selection before delayed Web Lock',async()=>{
  const now=Date.now(),seed=createInitialState(now);
  seed.shop.purchases.speed=1;seed.bag.speed=1;
  seed.board[42].charges=0;seed.board[42].cooldownUntil=now+120_000;
  seed.board[44].charges=0;seed.board[44].cooldownUntil=now+150_000;
  const h=await mount({initialRaw:JSON.stringify(seed)});
  const select=h.id('supply-producer');
  assert.equal(select.options.length,3);
  const first=select.options[0].value,second=select.options[1].value;
  assert.notEqual(first,second);
  select.value=first;
  h.win.pauseNextLock=true;
  const speed=h.id('supply-bag').querySelector('[data-supply-use="speed"]');
  assert.equal(speed.disabled,false);
  speed.click();
  await settle();
  assert.equal(typeof h.win.releaseLock,'function');
  select.value=second;
  h.win.releaseLock();
  await settle();
  const after=h.saved();
  assert.equal(after.revision,1);
  assert.equal(after.bag.speed,0);
  const firstAfter=after.board.find(p=>p?.id===first);
  const secondAfter=after.board.find(p=>p?.id===second);
  assert.ok(firstAfter.cooldownUntil<seed.board[42].cooldownUntil);
  assert.equal(secondAfter.cooldownUntil,seed.board[44].cooldownUntil);
});

test('P2.64d canceled mobile pointer consumes delayed compatibility click but not a fresh tap',async()=>{
  const h=await mount(),board=h.id('board');
  const first=board.children[0],producer=board.children[42];
  board.dispatch('pointerdown',{target:first,pointerId:7,clientX:0,clientY:0});
  board.dispatch('pointermove',{target:first,pointerId:7,clientX:16,clientY:0});
  assert.equal(h.doc.body.children.length,1,'drag ghost must exist');
  board.dispatch('pointercancel',{target:first,pointerId:7,clientX:16,clientY:0});
  assert.equal(h.doc.body.children.length,0,'canceled drag ghost removed');
  board.dispatch('click',{target:producer,detail:1});
  await settle();
  assert.equal(h.saved().revision,0,'late canceled click must not produce');
  board.dispatch('pointerdown',{target:producer,pointerId:8});
  board.dispatch('click',{target:producer,detail:1});
  await settle();
  assert.equal(h.saved().revision,1,'new real pointerdown clears guard');
});

test('P2.64d BFCache resume adopts verified other-tab progress before next action',async()=>{
  const h=await mount(),old=h.saved();
  h.doc.hidden=true;
  h.win.dispatch('pagehide');
  const newer={...old,coins:old.coins+123,revision:old.revision+1};
  h.storage.setItem(SAVE_KEY,JSON.stringify(newer));
  h.win.dispatch('pageshow',{persisted:true});
  assert.equal(h.id('coins').textContent,old.coins.toLocaleString('zh-CN'));
  h.doc.hidden=false;
  h.win.dispatch('pageshow',{persisted:true});
  assert.equal(h.id('coins').textContent,newer.coins.toLocaleString('zh-CN'));
  assert.match(h.id('save-status').textContent,/已同步其他标签页进度/);
  const board=h.id('board');
  board.dispatch('click',{target:board.children[0],detail:1});
  board.dispatch('click',{target:board.children[1],detail:1});
  await settle();
  assert.equal(h.saved().revision,newer.revision+1);
  assert.equal(h.saved().coins,newer.coins);
});

test('P2.64d hiding while an action waits on Web Locks blocks stale UI publication',async()=>{
  const h=await mount(),board=h.id('board');
  h.win.pauseNextLock=true;
  board.dispatch('click',{target:board.children[0],detail:1});
  board.dispatch('click',{target:board.children[1],detail:1});
  await settle();
  assert.equal(typeof h.win.releaseLock,'function');
  const writesBefore=h.writes.length;
  h.doc.hidden=true;
  h.doc.dispatch('visibilitychange');
  h.win.dispatch('pagehide');
  h.win.releaseLock();
  await settle();
  assert.match(h.id('save-status').textContent,/已暂停/);
  assert.ok(h.writes.length>=writesBefore,
    'a pending write may have committed; do not claim rollback');
  const count=h.writes.length;
  h.doc.hidden=false;
  h.win.dispatch('pageshow',{persisted:true});
  board.dispatch('click',{target:board.children[42],detail:1});
  await settle();
  assert.equal(h.writes.length,count,'blocked session must never replay input');
});

test('P2.64d active lock cancels old drag ghost before a second pointer move',async()=>{
  const h=await mount(),board=h.id('board');
  board.dispatch('pointerdown',{target:board.children[0],pointerId:5});
  board.dispatch('pointermove',{target:board.children[0],pointerId:5,clientX:15});
  assert.equal(h.doc.body.children.length,1);
  h.win.pauseNextLock=true;
  board.dispatch('click',{target:board.children[42],detail:1});
  await settle();
  assert.equal(typeof h.win.releaseLock,'function');
  board.dispatch('pointermove',{target:board.children[0],pointerId:5,clientX:30});
  assert.equal(h.doc.body.children.length,0);
  h.win.releaseLock();
  await settle();
  assert.equal(h.saved().revision,1);
  assert.deepEqual(h.writes,[SAVE_KEY,SAVE_KEY]);
});

test('P2.64d corrupt original export is read-only while gameplay remains blocked',async()=>{
  const raw='{original-unparseable',h=await mount({initialRaw:raw});
  assert.match(h.id('save-status').textContent,/异常存档/);
  h.id('export-local-save').click();
  assert.match(h.id('notice').textContent,/已请求下载/);
  assert.equal(h.storage.getItem(SAVE_KEY),raw);
  assert.deepEqual(h.writes,[]);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.64e delayed storage event: first producer tap adopts external save but never replays stale tap',async()=>{
  const h=await mount(),before=h.saved();
  const oldButton=h.id('board').children[42];
  const otherTab={...before,revision:before.revision+1,coins:before.coins+77};
  h.storage.setItem(SAVE_KEY,JSON.stringify(otherTab));
  const writes=h.writes.length;
  // Deliberately do not dispatch storage: mobile tabs can deliver it late.
  h.id('board').dispatch('click',{target:oldButton,detail:1});
  await settle();
  assert.equal(h.writes.length,writes,'first stale tap must not write');
  assert.equal(h.saved().revision,otherTab.revision);
  assert.equal(h.saved().energy,otherTab.energy);
  assert.equal(h.id('coins').textContent,otherTab.coins.toLocaleString('zh-CN'));
  assert.match(h.id('notice').textContent,/重新操作/);
  // A genuinely new tap on the newly rendered board is permitted.
  h.id('board').dispatch('click',{target:h.id('board').children[42],detail:1});
  await settle();
  assert.equal(h.saved().revision,otherTab.revision+1);
});

test('P2.64e selected inventory action is not redirected to a newly adopted board',async()=>{
  const h=await mount(),board=h.id('board');
  board.dispatch('click',{target:board.children[0],detail:1});
  const before=h.saved();
  const otherTab={...before,revision:before.revision+1,coins:before.coins+13};
  h.storage.setItem(SAVE_KEY,JSON.stringify(otherTab));
  const writes=h.writes.length;
  h.id('store-selected').click();
  await settle();
  assert.equal(h.writes.length,writes,'stale selected item cannot enter warehouse');
  assert.equal(h.saved().revision,otherTab.revision);
  assert.deepEqual(h.saved().warehouse,otherTab.warehouse);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.64e pointer drop must not merge a newly adopted board when storage event is late',async()=>{
  const h=await mount(),board=h.id('board');
  const origin=board.children[0];
  board.dispatch('pointerdown',{target:origin,pointerId:31,clientX:0,clientY:0});
  board.dispatch('pointermove',{target:origin,pointerId:31,clientX:20,clientY:0});
  assert.equal(h.doc.body.children.length,1);
  const before=h.saved();
  const otherTab={...before,revision:before.revision+1,coins:before.coins+29};
  h.storage.setItem(SAVE_KEY,JSON.stringify(otherTab));
  const writes=h.writes.length;
  h.doc.elementFromPoint=()=>board.children[1];
  board.dispatch('pointerup',{target:origin,pointerId:31,clientX:20,clientY:0});
  await settle();
  assert.equal(h.doc.body.children.length,0,'stale drag ghost is removed');
  assert.equal(h.writes.length,writes,'stale pointerup cannot merge remote board');
  assert.equal(h.saved().revision,otherTab.revision);
  assert.equal(h.saved().board[0].tier,1);
  assert.equal(h.saved().board[1].tier,1);
});

test('P2.64e keyboard activation also requires a fresh event after external adoption',async()=>{
  const h=await mount(),board=h.id('board');
  const before=h.saved();
  const otherTab={...before,revision:before.revision+1,coins:before.coins+17};
  h.storage.setItem(SAVE_KEY,JSON.stringify(otherTab));
  const writes=h.writes.length;
  board.dispatch('click',{target:board.children[42],detail:0});
  await settle();
  assert.equal(h.writes.length,writes,'old keyboard activation is not replayed');
  board.dispatch('click',{target:h.id('board').children[42],detail:0});
  await settle();
  assert.equal(h.saved().revision,otherTab.revision+1);
});

test('P2.64f live entry guidance never reuses a stale board before delayed storage event',async()=>{
  const h=await mount(),before=h.saved();
  const remote={...before,revision:before.revision+1,coins:before.coins+41};
  h.storage.setItem(SAVE_KEY,JSON.stringify(remote));
  const writes=h.writes.length;
  h.id('board-guide').click();
  await settle();
  assert.equal(h.writes.length,writes,'read-only guidance must never write');
  assert.equal(h.saved().revision,remote.revision);
  assert.equal(h.id('coins').textContent,remote.coins.toLocaleString('zh-CN'));
  assert.equal(h.id('board-guide').getAttribute('aria-pressed'),'false');
  assert.match(h.id('notice').textContent,/重新请求整理提示/);
  h.id('board-guide').click();
  await settle();
  assert.equal(h.id('board-guide').getAttribute('aria-pressed'),'true');
  assert.equal(h.writes.length,writes);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

function adoptExternalSnapshot(h,bonus=19){
  const previous=h.saved();
  const next={...previous,revision:previous.revision+1,
    coins:previous.coins+bonus};
  h.storage.setItem(SAVE_KEY,JSON.stringify(next));
  h.win.dispatch('storage',{storageArea:h.storage,key:SAVE_KEY});
  return next;
}

test('P2.65a stale detached order button cannot fulfill a newly adopted order',async()=>{
  const h=await mount(),oldOrder=h.id('orders').children[0].children[3];
  assert.equal(oldOrder.disabled,false,'initial tea tier-2 order is fulfillable');
  const remote=adoptExternalSnapshot(h);
  const writes=h.writes.length;
  oldOrder.click();
  await settle();
  assert.equal(h.writes.length,writes,'detached order cannot spend remote material');
  assert.equal(h.saved().revision,remote.revision);
  assert.match(h.id('notice').textContent,/最新界面重新操作/);
  const newOrder=h.id('orders').children[0].children[3];
  assert.notEqual(newOrder,oldOrder);
  newOrder.click();
  await settle();
  assert.equal(h.saved().revision,remote.revision+1);
  assert.equal(h.saved().board[16],null);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65a stale warehouse withdrawal after BFCache resume cannot touch adopted inventory',async()=>{
  const seed=storeItem(createInitialState(Date.now()),0).state;
  const h=await mount({initialRaw:JSON.stringify(seed)});
  const oldSlot=h.id('warehouse').children[0];
  assert.equal(oldSlot.disabled,false);
  h.doc.hidden=true;
  h.win.dispatch('pagehide');
  const before=h.saved();
  const remote={...before,revision:before.revision+1,coins:before.coins+17};
  h.storage.setItem(SAVE_KEY,JSON.stringify(remote));
  h.doc.hidden=false;
  h.win.dispatch('pageshow',{persisted:true});
  const writes=h.writes.length;
  oldSlot.click();
  await settle();
  assert.equal(h.writes.length,writes,'detached warehouse button cannot withdraw');
  assert.deepEqual(h.saved().warehouse,remote.warehouse);
  const newSlot=h.id('warehouse').children[0];
  assert.notEqual(newSlot,oldSlot);
  newSlot.click();
  await settle();
  assert.equal(h.saved().revision,remote.revision+1);
  assert.equal(h.saved().warehouse.slots[0],null);
});

test('P2.65a detached supply use cannot consume item after remote rerender',async()=>{
  const now=Date.now(),seed=createInitialState(now);
  seed.shop.purchases.speed=1;seed.bag.speed=1;
  seed.board[42].charges=0;seed.board[42].cooldownUntil=now+120_000;
  const h=await mount({initialRaw:JSON.stringify(seed)});
  const selector='[data-supply-use="speed"]';
  const oldUse=h.id('supply-bag').querySelector(selector);
  assert.equal(oldUse.disabled,false);
  const remote=adoptExternalSnapshot(h);
  const writes=h.writes.length;
  oldUse.click();
  await settle();
  assert.equal(h.writes.length,writes,'detached supply button cannot consume bag');
  assert.equal(h.saved().bag.speed,1);
  const newUse=h.id('supply-bag').querySelector(selector);
  assert.notEqual(newUse,oldUse);
  newUse.click();
  await settle();
  assert.equal(h.saved().revision,remote.revision+1);
  assert.equal(h.saved().bag.speed,0);
});

test('P2.65a stale producer upgrade after external adoption cannot spend new coins',async()=>{
  const seed=createInitialState(Date.now());seed.coins=1000;seed.xp=1500;
  const h=await mount({initialRaw:JSON.stringify(seed)});
  const oldUpgrade=h.id('producers').children[0].children[1];
  assert.equal(oldUpgrade.disabled,false);
  const remote=adoptExternalSnapshot(h);
  const writes=h.writes.length;
  oldUpgrade.click();
  await settle();
  assert.equal(h.writes.length,writes,'detached upgrade cannot spend coins');
  assert.equal(h.saved().board[42].level,1);
  const newUpgrade=h.id('producers').children[0].children[1];
  newUpgrade.click();
  await settle();
  assert.equal(h.saved().revision,remote.revision+1);
  assert.equal(h.saved().board[42].level,2);
});

test('P2.65a local selection rerender invalidates old shop buttons without any storage event',async()=>{
  const seed=createInitialState(Date.now());seed.coins=1000;
  const h=await mount({initialRaw:JSON.stringify(seed)});
  const oldBuy=h.id('supply-shop').children[0].children[1];
  assert.equal(oldBuy.disabled,false);
  const board=h.id('board');
  board.dispatch('click',{target:board.children[0],detail:0});
  const writes=h.writes.length;
  oldBuy.click();
  await settle();
  assert.equal(h.writes.length,writes,'obsolete shop button cannot purchase');
  assert.equal(h.saved().revision,0);
  const newBuy=h.id('supply-shop').children[0].children[1];
  assert.notEqual(newBuy,oldBuy);
  newBuy.click();
  await settle();
  assert.equal(h.saved().revision,1);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65b active page requests exact original save download without changing storage',async()=>{
  const h=await mount(),original=h.storage.getItem(SAVE_KEY);
  const writes=h.writes.length,created=[];
  const beforeCreate=URL.createObjectURL,beforeRevoke=URL.revokeObjectURL;
  try {
    URL.createObjectURL=blob=>{created.push(blob);return 'blob:p265b-normal';};
    URL.revokeObjectURL=()=>{throw Error('premature revoke');};
    h.id('export-local-save').click();
    assert.match(h.id('notice').textContent,/已请求下载/);
    assert.equal(created.length,1);
    assert.equal(await created[0].text(),original);
    assert.equal(h.writes.length,writes);
    assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
  } finally {
    URL.createObjectURL=beforeCreate;
    URL.revokeObjectURL=beforeRevoke;
  }
});

test('P2.65b abnormal backup download uses preserved original, never reset result',async()=>{
  const original='{original-broken',h=await mount({initialRaw:original});
  h.id('reset').click();
  await settle();
  assert.equal(h.storage.getItem(ABNORMAL_RESET_BACKUP_KEY),original);
  const active=h.storage.getItem(SAVE_KEY),writes=h.writes.length,created=[];
  const beforeCreate=URL.createObjectURL;
  try {
    URL.createObjectURL=blob=>{created.push(blob);return 'blob:p265b-backup';};
    h.id('export-abnormal-reset-backup').click();
    assert.match(h.id('notice').textContent,/已请求下载异常重置前/);
    assert.equal(created.length,1);
    assert.equal(await created[0].text(),original);
    assert.equal(h.storage.getItem(SAVE_KEY),active);
    assert.equal(h.writes.length,writes);
    assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
  } finally {URL.createObjectURL=beforeCreate;}
});

test('P2.65b blocked object URL download reports failure and never overwrites save',async()=>{
  const h=await mount(),original=h.storage.getItem(SAVE_KEY);
  const writes=h.writes.length,beforeCreate=URL.createObjectURL;
  try {
    URL.createObjectURL=()=>{throw Error('WebView download blocked');};
    h.id('export-local-save').click();
    assert.match(h.id('notice').textContent,/未能启动下载/);
    assert.equal(h.writes.length,writes);
    assert.equal(h.storage.getItem(SAVE_KEY),original);
  } finally {URL.createObjectURL=beforeCreate;}
});

test('P2.65b failed mobile timer does not immediately revoke pending blob URL',async()=>{
  const h=await mount(),revoked=[];
  const beforeCreate=URL.createObjectURL,beforeRevoke=URL.revokeObjectURL;
  const beforeTimer=h.win.setTimeout;
  try {
    URL.createObjectURL=()=> 'blob:p265b-deferred';
    URL.revokeObjectURL=url=>revoked.push(url);
    h.win.setTimeout=(fn,ms)=>{
      if(ms===120000)throw Error('WebView timer unavailable');
      return beforeTimer(fn,ms);
    };
    h.id('export-local-save').click();
    assert.match(h.id('notice').textContent,/已请求下载/);
    assert.match(h.id('notice').textContent,/未能安排临时链接清理/);
    assert.deepEqual(revoked,[],'no premature revoke after click');
  } finally {
    URL.createObjectURL=beforeCreate;
    URL.revokeObjectURL=beforeRevoke;
    h.win.setTimeout=beforeTimer;
  }
});
