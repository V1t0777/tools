import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SAVE_KEY,ABNORMAL_RESET_BACKUP_KEY} from '../merge/storage.mjs';
import {RESTORE_BACKUP_KEY} from '../merge/save-restore-backup.mjs';
import {STORY_SAVE_KEY} from '../merge/mode-boundaries.mjs';
import {NORMAL_SAVE_LOCK_NAME} from '../merge/normal-save-lock.mjs';
import {createInitialState,storeItem,MAX_ENERGY,ENERGY_REGEN_MS} from '../merge/engine.mjs';

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
async function mount({initialRaw=null,locksAvailable=true,initialHidden=false}={}) {
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
  doc.hidden=initialHidden;
  doc.body=new Element('body');
  doc.getElementById=id=>{
    if(!ids.has(id))ids.set(id,new Element(id==='supply-producer'?'select':'div'));
    return ids.get(id);
  };
  // Mirror the real HTML save-actions parent without polluting body drag tests.
  const saveActions=new Element('div');
  saveActions.append(doc.getElementById('export-local-save'));
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
  // A keyboard activation is a valid concurrent action while a pointer is
  // held. A pointer click on a DIFFERENT cell without its own pointerdown
  // is now correctly rejected as a stale/retargeted compatibility click.
  board.dispatch('click',{target:board.children[42],detail:0});
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

test('P2.65c download capacity protects normal save and explains retry without storage writes',async()=>{
  const h=await mount(),raw=h.storage.getItem(SAVE_KEY),writes=h.writes.length;
  const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;
  let created=0;
  try {
    URL.createObjectURL=()=>`blob:p265c-${++created}`;
    URL.revokeObjectURL=()=>{};
    // Mobile timers are suspended in the DOM fixture; repeated downloads
    // must stop before unbounded Blob URLs are allocated.
    for(let i=0;i<12;i++)h.id('export-local-save').click();
    assert.match(h.id('notice').textContent,/下载过于频繁/);
    assert.ok(created<=8,'bounded pending object URLs');
    assert.equal(h.storage.getItem(SAVE_KEY),raw);
    assert.equal(h.writes.length,writes);
    assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
  } finally {
    URL.createObjectURL=oldCreate;
    URL.revokeObjectURL=oldRevoke;
  }
});

test('P2.65c backup download quota never overwrites confirmed reset evidence',async()=>{
  const original='{broken-original',h=await mount({initialRaw:original});
  h.id('reset').click();
  await settle();
  assert.equal(h.storage.getItem(ABNORMAL_RESET_BACKUP_KEY),original);
  const active=h.storage.getItem(SAVE_KEY),writes=h.writes.length;
  const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;
  try {
    URL.createObjectURL=()=> 'blob:p265c-backup';
    URL.revokeObjectURL=()=>{};
    for(let i=0;i<12;i++)h.id('export-abnormal-reset-backup').click();
    assert.match(h.id('notice').textContent,/下载过于频繁/);
    assert.equal(h.storage.getItem(SAVE_KEY),active);
    assert.equal(h.storage.getItem(ABNORMAL_RESET_BACKUP_KEY),original);
    assert.equal(h.writes.length,writes);
    assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
  } finally {
    URL.createObjectURL=oldCreate;
    URL.revokeObjectURL=oldRevoke;
  }
});


test('P2.65d pagehide without hidden blocks click, timer and reset until pageshow',async()=>{
  const h=await mount(),raw=h.storage.getItem(SAVE_KEY),writes=h.writes.length;
  h.win.dispatch('pagehide');
  h.id('board').dispatch('click',{target:h.id('board').children[42],detail:1});
  h.id('reset').click();
  await h.win.timer();
  await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),raw);
  assert.equal(h.writes.length,writes);
  h.win.dispatch('focus');
  h.id('board').dispatch('click',{target:h.id('board').children[42],detail:1});
  await settle();
  assert.equal(h.writes.length,writes,'focus cannot unsuspend BFCache page');
  h.win.dispatch('pageshow',{persisted:true});
  h.id('board').dispatch('click',{target:h.id('board').children[42],detail:1});
  await settle();
  assert.equal(h.saved().revision,1);
});

test('P2.65d reset confirmation interrupted by pagehide never writes',async()=>{
  const h=await mount(),raw=h.storage.getItem(SAVE_KEY),writes=h.writes.length;
  h.win.confirm=()=>{h.win.dispatch('pagehide');return true;};
  h.id('reset').click();
  await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),raw);
  assert.equal(h.writes.length,writes);
  assert.match(h.id('notice').textContent,/重置已取消/);
  h.win.dispatch('pageshow',{persisted:true});
  h.win.confirm=()=>true;
  h.id('reset').click();
  await settle();
  assert.equal(h.writes.length,writes+1);
  assert.equal(h.saved().revision,0);
});

test('P2.65d hidden visibility prevents queued producer click and reset until visible',async()=>{
  const h=await mount(),writes=h.writes.length;
  h.doc.hidden=true;
  h.doc.dispatch('visibilitychange');
  h.id('board').dispatch('click',{target:h.id('board').children[42],detail:1});
  h.id('reset').click();
  await settle();
  assert.equal(h.writes.length,writes);
  h.doc.hidden=false;
  h.doc.dispatch('visibilitychange');
  h.id('board').dispatch('click',{target:h.id('board').children[42],detail:1});
  await settle();
  assert.equal(h.saved().revision,1);
});

test('P2.65e live page resumes after hidden BFCache pageshow and visible event',async()=>{
  const h=await mount(),raw=h.storage.getItem(SAVE_KEY),writes=h.writes.length;
  h.win.dispatch('pagehide');
  h.doc.hidden=true;
  h.doc.dispatch('visibilitychange');
  h.win.dispatch('pageshow',{persisted:true});
  h.id('board').dispatch('click',{target:h.id('board').children[42],detail:1});
  await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),raw,'hidden BFCache must not write');
  h.doc.hidden=false;
  h.doc.dispatch('visibilitychange');
  h.id('board').dispatch('click',{target:h.id('board').children[42],detail:1});
  await settle();
  assert.equal(h.saved().revision,1,'verified visible BFCache must restore input');
  assert.equal(h.writes.length,writes+1);
});

test('P2.65e live page blocks corrupt external save on deferred BFCache resume',async()=>{
  const h=await mount();
  h.win.dispatch('pagehide');
  h.doc.hidden=true;
  h.win.dispatch('pageshow',{persisted:true});
  h.storage.setItem(SAVE_KEY,'{corrupt');
  const writes=h.writes.length;
  h.doc.hidden=false;
  h.doc.dispatch('visibilitychange');
  h.id('board').dispatch('click',{target:h.id('board').children[42],detail:1});
  await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),'{corrupt');
  assert.equal(h.writes.length,writes);
  assert.match(h.id('save-status').textContent,/暂停|异常|无法/);
});

test('P2.65f guidance rerender cancels a live drag and consumes its late click',async()=>{
  const h=await mount(),board=h.id('board'),origin=board.children[0];
  board.dispatch('pointerdown',{target:origin,pointerId:21,clientX:0,clientY:0});
  board.dispatch('pointermove',{target:origin,pointerId:21,clientX:18,clientY:0});
  assert.equal(h.doc.body.children.length,1,'drag ghost exists before rerender');
  h.doc.elementFromPoint=()=>board.children[1];
  const before=h.writes.length;
  h.id('board-guide').click();
  assert.equal(h.doc.body.children.length,0,'rerender must remove old drag ghost');
  board.dispatch('pointerup',{target:origin,pointerId:21,clientX:25,clientY:0});
  board.dispatch('click',{target:board.children[42],detail:1});
  await settle();
  assert.equal(h.writes.length,before,'old drop and synthetic click must not write');
  assert.equal(h.saved().revision,0);
  board.dispatch('pointerdown',{target:board.children[42],pointerId:22});
  board.dispatch('click',{target:board.children[42],detail:1});
  await settle();
  assert.equal(h.saved().revision,1,'fresh pointer gesture remains usable');
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65f a local producer transaction rerender invalidates a prior material drag',async()=>{
  const h=await mount(),board=h.id('board'),origin=board.children[0];
  board.dispatch('pointerdown',{target:origin,pointerId:23,clientX:0,clientY:0});
  board.dispatch('pointermove',{target:origin,pointerId:23,clientX:18,clientY:0});
  assert.equal(h.doc.body.children.length,1);
  h.doc.elementFromPoint=()=>board.children[1];
  board.dispatch('click',{target:board.children[42],detail:0});
  await settle();
  assert.equal(h.saved().revision,1,'producer action committed exactly once');
  assert.equal(h.doc.body.children.length,0,'verified local rerender cancels drag');
  const before=h.writes.length;
  board.dispatch('pointerup',{target:origin,pointerId:23,clientX:25,clientY:0});
  await settle();
  assert.equal(h.writes.length,before,'stale drop cannot become a second write');
  assert.equal(h.saved().revision,1);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65f lost pointer capture cancels mobile drag without pointercancel',async()=>{
  const h=await mount(),board=h.id('board'),origin=board.children[0];
  board.dispatch('pointerdown',{target:origin,pointerId:24,clientX:0,clientY:0});
  board.dispatch('pointermove',{target:origin,pointerId:24,clientX:18,clientY:0});
  assert.equal(h.doc.body.children.length,1);
  h.doc.elementFromPoint=()=>board.children[1];
  const before=h.writes.length;
  board.dispatch('lostpointercapture',{target:origin,pointerId:24});
  assert.equal(h.doc.body.children.length,0,'capture loss removes drag ghost');
  board.dispatch('pointerup',{target:origin,pointerId:24,clientX:25,clientY:0});
  board.dispatch('click',{target:board.children[42],detail:1});
  await settle();
  assert.equal(h.writes.length,before,'late click after capture loss is consumed');
  board.dispatch('pointerdown',{target:board.children[42],pointerId:25});
  board.dispatch('click',{target:board.children[42],detail:1});
  await settle();
  assert.equal(h.saved().revision,1,'subsequent genuine tap works');
});

test('P2.65g second touch cancels a captured material drag without replay',async()=>{
  const h=await mount(),board=h.id('board'),origin=board.children[0];
  board.dispatch('pointerdown',{target:origin,pointerId:71,isPrimary:true,clientX:0,clientY:0});
  board.dispatch('pointermove',{target:origin,pointerId:71,clientX:20,clientY:0});
  assert.equal(h.doc.body.children.length,1,'first finger created a drag ghost');
  h.doc.elementFromPoint=()=>board.children[1];
  const writes=h.writes.length;
  board.dispatch('pointerdown',{target:board.children[1],pointerId:72,isPrimary:false});
  assert.equal(h.doc.body.children.length,0,'second finger cancels the original drag');
  board.dispatch('pointerup',{target:origin,pointerId:71,clientX:25,clientY:0});
  board.dispatch('pointerup',{target:board.children[1],pointerId:72,clientX:25,clientY:0});
  board.dispatch('click',{target:board.children[42],detail:1});
  await settle();
  assert.equal(h.writes.length,writes,'neither old pointer nor compatibility click can write');
  assert.equal(h.saved().revision,0);
  board.dispatch('pointerdown',{target:board.children[42],pointerId:73,isPrimary:true});
  board.dispatch('click',{target:board.children[42],detail:1});
  await settle();
  assert.equal(h.saved().revision,1,'new genuine single-pointer tap still works');
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65g nonprimary pointer cannot initiate a drag or poison the next primary',async()=>{
  const h=await mount(),board=h.id('board'),origin=board.children[0];
  board.dispatch('pointerdown',{target:origin,pointerId:74,isPrimary:false});
  board.dispatch('pointermove',{target:origin,pointerId:74,clientX:25,clientY:0});
  assert.equal(h.doc.body.children.length,0);
  board.dispatch('pointerup',{target:origin,pointerId:74,clientX:25,clientY:0});
  h.doc.elementFromPoint=()=>board.children[1];
  board.dispatch('pointerdown',{target:origin,pointerId:75,isPrimary:true,clientX:0,clientY:0});
  board.dispatch('pointermove',{target:origin,pointerId:75,clientX:20,clientY:0});
  assert.equal(h.doc.body.children.length,1,'primary drag remains usable');
  board.dispatch('pointerup',{target:origin,pointerId:75,clientX:25,clientY:0});
  await settle();
  assert.equal(h.saved().revision,1);
  assert.equal(h.saved().board[1].tier,2);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65g detached old board cell cannot start a drag after rerender',async()=>{
  const h=await mount(),board=h.id('board'),old=board.children[0];
  h.id('board-guide').click();
  // DOM replacement detaches old nodes; emulate that browser behavior.
  old.parentElement=null;
  const writes=h.writes.length;
  board.dispatch('pointerdown',{target:old,pointerId:76,isPrimary:true});
  board.dispatch('pointermove',{target:old,pointerId:76,clientX:20,clientY:0});
  board.dispatch('pointerup',{target:old,pointerId:76,clientX:25,clientY:0});
  assert.equal(h.doc.body.children.length,0,'detached target cannot create a ghost');
  await settle();
  assert.equal(h.writes.length,writes);
  const current=board.children[0];
  board.dispatch('pointerdown',{target:current,pointerId:77,isPrimary:true});
  board.dispatch('pointermove',{target:current,pointerId:77,clientX:20,clientY:0});
  assert.equal(h.doc.body.children.length,1,'current cell still accepts drag');
  board.dispatch('pointercancel',{target:current,pointerId:77});
  assert.equal(h.doc.body.children.length,0);
});

test('P2.65g background pointerdown does not clear canceled drag click guard',async()=>{
  const h=await mount(),board=h.id('board'),origin=board.children[0];
  board.dispatch('pointerdown',{target:origin,pointerId:78,isPrimary:true});
  board.dispatch('pointermove',{target:origin,pointerId:78,clientX:20,clientY:0});
  board.dispatch('pointercancel',{target:origin,pointerId:78});
  const writes=h.writes.length;
  board.dispatch('pointerdown',{target:board,pointerId:79,isPrimary:true});
  board.dispatch('click',{target:board.children[42],detail:1});
  await settle();
  assert.equal(h.writes.length,writes,'stray background contact cannot enable delayed click');
  board.dispatch('pointerdown',{target:board.children[42],pointerId:80,isPrimary:true});
  board.dispatch('click',{target:board.children[42],detail:1});
  await settle();
  assert.equal(h.saved().revision,1,'fresh cell pointerdown restores normal click');
});

test('P2.65i live page import restores verified normal file and keeps story isolated',async()=>{
  const h=await mount();
  const original=h.storage.getItem(SAVE_KEY);
  const imported=JSON.stringify({...h.saved(),coins:88,revision:1});
  const controls=h.id('export-local-save').parentElement.children;
  const input=controls.find(e=>e.id==='import-normal-file');
  assert.ok(input,'import chooser is attached to real save action row');
  controls.find(e=>e.id==='import-normal-save').click();
  input.files=[{size:new TextEncoder().encode(imported).length,text:async()=>imported}];
  input.dispatch('change');
  await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),imported);
  assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),original);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
  assert.match(h.id('save-status').textContent,/已保存于此浏览器/);
});
test('P2.65i live page cancellation does not write or consume backup slot',async()=>{
  const h=await mount(),before=h.writes.length;
  h.win.confirm=()=>false;
  const imported=JSON.stringify({...h.saved(),coins:22,revision:1});
  const controls=h.id('export-local-save').parentElement.children;
  const input=controls.find(e=>e.id==='import-normal-file');
  controls.find(e=>e.id==='import-normal-save').click();
  input.files=[{size:imported.length,text:async()=>imported}];
  input.dispatch('change');await settle();
  assert.equal(h.writes.length,before);
  assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),null);
});

test('P2.65j stale file chooser after BFCache cannot restore a previous gesture',async()=>{
  const h=await mount(),original=h.storage.getItem(SAVE_KEY),before=h.writes.length;
  const controls=h.id('export-local-save').parentElement.children;
  const input=controls.find(e=>e.id==='import-normal-file');
  controls.find(e=>e.id==='import-normal-save').click();
  h.win.dispatch('pagehide');
  h.win.dispatch('pageshow',{persisted:true});
  const imported=JSON.stringify({...h.saved(),coins:79,revision:1});
  input.files=[{size:imported.length,text:async()=>imported}];
  input.dispatch('change');
  await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),original);
  assert.equal(h.writes.length,before);
  assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),null);
  assert.match(h.id('notice').textContent,/重新点击导入/);
});
test('P2.65j chooser cannot silently adopt a new cross-tab save baseline',async()=>{
  const h=await mount();
  const controls=h.id('export-local-save').parentElement.children;
  const input=controls.find(e=>e.id==='import-normal-file');
  controls.find(e=>e.id==='import-normal-save').click();
  const newer=JSON.stringify({...h.saved(),coins:42,revision:1});
  h.storage.setItem(SAVE_KEY,newer);
  h.win.dispatch('storage',{storageArea:h.storage,key:SAVE_KEY});
  const before=h.writes.length;
  const imported=JSON.stringify({...h.saved(),coins:93,revision:2});
  input.files=[{size:imported.length,text:async()=>imported}];
  input.dispatch('change');
  await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),newer);
  assert.equal(h.writes.length,before);
  assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),null);
});
test('P2.65j unrequested file change and canceled chooser never restore',async()=>{
  const h=await mount(),original=h.storage.getItem(SAVE_KEY),before=h.writes.length;
  const controls=h.id('export-local-save').parentElement.children;
  const input=controls.find(e=>e.id==='import-normal-file');
  const imported=JSON.stringify({...h.saved(),coins:91,revision:1});
  input.files=[{size:imported.length,text:async()=>imported}];
  input.dispatch('change');
  await settle();
  controls.find(e=>e.id==='import-normal-save').click();
  input.dispatch('cancel');
  input.files=[{size:imported.length,text:async()=>imported}];
  input.dispatch('change');
  await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),original);
  assert.equal(h.writes.length,before);
  assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),null);
});

test('P2.65l native chooser one visibility roundtrip preserves verified import',async()=>{
  const h=await mount(),original=h.storage.getItem(SAVE_KEY);
  const controls=h.id('export-local-save').parentElement.children;
  const button=controls.find(e=>e.id==='import-normal-save');
  const input=controls.find(e=>e.id==='import-normal-file');
  button.click();
  h.doc.hidden=true;h.doc.dispatch('visibilitychange');
  h.doc.hidden=false;h.doc.dispatch('visibilitychange');
  const imported=JSON.stringify({...h.saved(),coins:46,revision:1});
  input.files=[{size:imported.length,text:async()=>imported}];
  input.dispatch('change');await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),imported);
  assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),original);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65l chooser hide-return refuses a changed cross-tab baseline',async()=>{
  const h=await mount();
  const controls=h.id('export-local-save').parentElement.children;
  const input=controls.find(e=>e.id==='import-normal-file');
  controls.find(e=>e.id==='import-normal-save').click();
  h.doc.hidden=true;h.doc.dispatch('visibilitychange');
  const newer=JSON.stringify({...h.saved(),coins:52,revision:1});
  h.storage.setItem(SAVE_KEY,newer);
  h.doc.hidden=false;h.doc.dispatch('visibilitychange');
  const before=h.writes.length;
  const imported=JSON.stringify({...h.saved(),coins:99,revision:2});
  input.files=[{size:imported.length,text:async()=>imported}];
  input.dispatch('change');await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),newer);
  assert.equal(h.writes.length,before);
  assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),null);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65l chooser pagehide or second hide always revokes selection',async()=>{
  for(const sequence of ['pagehide','second-hide']){
    const h=await mount(),original=h.storage.getItem(SAVE_KEY),before=h.writes.length;
    const controls=h.id('export-local-save').parentElement.children;
    const input=controls.find(e=>e.id==='import-normal-file');
    controls.find(e=>e.id==='import-normal-save').click();
    h.doc.hidden=true;h.doc.dispatch('visibilitychange');
    if(sequence==='pagehide'){
      h.win.dispatch('pagehide');
      h.win.dispatch('pageshow',{persisted:true});
    }else{
      h.doc.hidden=false;h.doc.dispatch('visibilitychange');
      h.doc.hidden=true;h.doc.dispatch('visibilitychange');
    }
    h.doc.hidden=false;h.doc.dispatch('visibilitychange');
    const imported=JSON.stringify({...h.saved(),coins:71,revision:1});
    input.files=[{size:imported.length,text:async()=>imported}];
    input.dispatch('change');await settle();
    assert.equal(h.storage.getItem(SAVE_KEY),original,sequence);
    assert.equal(h.writes.length,before,sequence);
    assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),null,sequence);
    // Reopening a picker after a revoked lifecycle must use a fresh input:
    // an old native event must not inherit the new user's permission.
    const button=h.id('export-local-save').parentElement.children.find(e=>e.id==='import-normal-save');
    button.click();
    const fresh=h.id('export-local-save').parentElement.children.find(e=>e.id==='import-normal-file');
    assert.notEqual(fresh,input,sequence+' must rotate the native input');
    input.dispatch('change');input.dispatch('cancel');await settle();
    assert.equal(h.storage.getItem(SAVE_KEY),original,'old chooser cannot restore after '+sequence);
    fresh.files=[{size:imported.length,text:async()=>imported}];
    fresh.dispatch('change');await settle();
    assert.equal(h.storage.getItem(SAVE_KEY),imported,'new chooser remains usable after '+sequence);
    assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),original,sequence);
  }
});

test('P2.65l duplicate import click cannot replace a pending chooser lease',async()=>{
  const h=await mount();
  const controls=h.id('export-local-save').parentElement.children;
  const button=controls.find(e=>e.id==='import-normal-save');
  const input=controls.find(e=>e.id==='import-normal-file');
  let chooserOpens=0;
  input.click=()=>{chooserOpens++;};
  button.click();button.click();
  assert.equal(chooserOpens,1,'only one native chooser may be outstanding');
  input.dispatch('cancel');
  assert.equal(input.parentElement,null,'native cancellation detaches old input');
  const fresh=h.id('export-local-save').parentElement.children.find(e=>e.id==='import-normal-file');
  assert.notEqual(fresh,input);
  fresh.click=()=>{chooserOpens++;};
  button.click();
  assert.equal(chooserOpens,2,'explicit cancellation permits a fresh chooser');
});

test('P2.65k reset confirmation cannot erase a newer cross-tab save adopted during dialog',async()=>{
  const h=await mount(),before=h.writes.length;
  const newer=JSON.stringify({...h.saved(),coins:117,revision:1});
  let confirmations=0;
  h.win.confirm=()=>{
    confirmations++;
    h.storage.setItem(SAVE_KEY,newer);
    h.win.dispatch('storage',{storageArea:h.storage,key:SAVE_KEY});
    return true;
  };
  h.id('reset').click();await settle();
  assert.equal(confirmations,1);
  assert.equal(h.storage.getItem(SAVE_KEY),newer);
  assert.equal(h.writes.length,before+1,'only the external write may occur');
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
  assert.match(h.id('notice').textContent,/重置已取消/);
  // A second, fresh confirmation against the newly visible state is allowed.
  h.win.confirm=()=>true;
  h.id('reset').click();await settle();
  assert.equal(h.saved().revision,0);
  assert.equal(h.writes.length,before+2);
});

test('P2.65k reset confirmation re-reads an unannounced cross-tab save',async()=>{
  const h=await mount(),before=h.writes.length;
  const newer=JSON.stringify({...h.saved(),coins:82,revision:1});
  h.win.confirm=()=>{h.storage.setItem(SAVE_KEY,newer);return true;};
  h.id('reset').click();await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),newer);
  assert.equal(h.writes.length,before+1,'unannounced external update must not be reset');
  assert.equal(h.storage.getItem(ABNORMAL_RESET_BACKUP_KEY),null);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
  assert.match(h.id('notice').textContent,/重置已取消/);
});

test('P2.65k reset confirmation expires after pagehide and pageshow within dialog',async()=>{
  const h=await mount(),original=h.storage.getItem(SAVE_KEY),before=h.writes.length;
  h.win.confirm=()=>{
    h.win.dispatch('pagehide');
    h.win.dispatch('pageshow',{persisted:true});
    return true;
  };
  h.id('reset').click();await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),original);
  assert.equal(h.writes.length,before);
  assert.match(h.id('notice').textContent,/页面已切换，重置已取消/);
  h.win.confirm=()=>true;
  h.id('reset').click();await settle();
  assert.equal(h.saved().revision,0,'fresh post-BFCache confirmation remains usable');
  assert.equal(h.writes.length,before+1);
});

test('P2.65m hidden native change defers file read and restore until verified visible',async()=>{
  const h=await mount(),original=h.storage.getItem(SAVE_KEY);
  const controls=h.id('export-local-save').parentElement.children;
  const button=controls.find(e=>e.id==='import-normal-save');
  const input=controls.find(e=>e.id==='import-normal-file');
  const imported=JSON.stringify({...h.saved(),coins:64,revision:1});
  let reads=0,confirmations=0;
  h.win.confirm=()=>{confirmations++;return true;};
  button.click();
  h.doc.hidden=true;h.doc.dispatch('visibilitychange');
  input.files=[{size:imported.length,text:async()=>{reads++;return imported;}}];
  input.dispatch('change');await settle();
  assert.equal(reads,0,'hidden file must not be read');
  assert.equal(confirmations,0,'hidden page must not show restore confirmation');
  assert.equal(h.storage.getItem(SAVE_KEY),original);
  h.doc.hidden=false;h.doc.dispatch('visibilitychange');
  await settle();
  assert.equal(reads,1);
  assert.equal(confirmations,1);
  assert.equal(h.storage.getItem(SAVE_KEY),imported);
  assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),original);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65m queued hidden file is revoked by BFCache pagehide',async()=>{
  const h=await mount(),original=h.storage.getItem(SAVE_KEY),before=h.writes.length;
  const controls=h.id('export-local-save').parentElement.children;
  const input=controls.find(e=>e.id==='import-normal-file');
  controls.find(e=>e.id==='import-normal-save').click();
  h.doc.hidden=true;h.doc.dispatch('visibilitychange');
  let reads=0;
  const imported=JSON.stringify({...h.saved(),coins:64,revision:1});
  input.files=[{size:imported.length,text:async()=>{reads++;return imported;}}];
  input.dispatch('change');
  h.win.dispatch('pagehide');
  h.win.dispatch('pageshow',{persisted:true});
  h.doc.hidden=false;h.doc.dispatch('visibilitychange');
  await settle();
  assert.equal(reads,0);
  assert.equal(h.storage.getItem(SAVE_KEY),original);
  assert.equal(h.writes.length,before);
  assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),null);
});

test('P2.65m queued hidden file rejects cross-tab changes before visibility resumes',async()=>{
  const h=await mount();
  const controls=h.id('export-local-save').parentElement.children;
  const input=controls.find(e=>e.id==='import-normal-file');
  controls.find(e=>e.id==='import-normal-save').click();
  h.doc.hidden=true;h.doc.dispatch('visibilitychange');
  let reads=0;
  const imported=JSON.stringify({...h.saved(),coins:64,revision:1});
  input.files=[{size:imported.length,text:async()=>{reads++;return imported;}}];
  input.dispatch('change');
  const newer=JSON.stringify({...h.saved(),coins:37,revision:1});
  h.storage.setItem(SAVE_KEY,newer);
  h.doc.hidden=false;h.doc.dispatch('visibilitychange');
  await settle();
  assert.equal(reads,0,'changed baseline must reject before reading file');
  assert.equal(h.storage.getItem(SAVE_KEY),newer);
  assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),null);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65m duplicate or canceled hidden change cannot restore',async()=>{
  for(const kind of ['duplicate','cancel','second-hide']){
    const h=await mount(),original=h.storage.getItem(SAVE_KEY),before=h.writes.length;
    const controls=h.id('export-local-save').parentElement.children;
    const input=controls.find(e=>e.id==='import-normal-file');
    controls.find(e=>e.id==='import-normal-save').click();
    h.doc.hidden=true;h.doc.dispatch('visibilitychange');
    let reads=0;
    const imported=JSON.stringify({...h.saved(),coins:64,revision:1});
    input.files=[{size:imported.length,text:async()=>{reads++;return imported;}}];
    input.dispatch('change');
    if(kind==='duplicate')input.dispatch('change');
    if(kind==='cancel')input.dispatch('cancel');
    if(kind==='second-hide'){
      h.doc.hidden=false;h.doc.dispatch('visibilitychange');
      h.doc.hidden=true;h.doc.dispatch('visibilitychange');
    }
    h.doc.hidden=false;h.doc.dispatch('visibilitychange');
    await settle();
    assert.equal(reads,0,kind);
    assert.equal(h.storage.getItem(SAVE_KEY),original,kind);
    assert.equal(h.writes.length,before,kind);
    assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),null,kind);
  }
});


test('P2.65n second file import preserves original backup without blocking gameplay',async()=>{
  const h=await mount(),original=h.storage.getItem(SAVE_KEY);
  const controls=h.id('export-local-save').parentElement.children;
  const button=controls.find(e=>e.id==='import-normal-save');
  const input=controls.find(e=>e.id==='import-normal-file');
  const first=JSON.stringify({...h.saved(),revision:1,coins:42});
  button.click();input.files=[{size:first.length,text:async()=>first}];
  input.dispatch('change');await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),first);
  assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),original);
  const writes=h.writes.length;
  const second=JSON.stringify({...h.saved(),revision:2,coins:84});
  button.click();input.files=[{size:second.length,text:async()=>second}];
  input.dispatch('change');await settle();
  assert.match(h.id('notice').textContent,/备份槽/);
  assert.equal(h.writes.length,writes,'second import must not overwrite either slot');
  assert.equal(h.storage.getItem(SAVE_KEY),first);
  assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),original);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
  h.id('board').dispatch('click',{target:h.id('board').children[42],detail:1});
  await settle();
  assert.equal(h.saved().revision,2,'ordinary actions still work after backup conflict');
  assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),original);
});

test('P2.65p pagehide immediately releases hung import and ignores late file result',async()=>{
  const h=await mount(),original=h.storage.getItem(SAVE_KEY);
  const controls=h.id('export-local-save').parentElement.children;
  const button=controls.find(e=>e.id==='import-normal-save');
  const input=controls.find(e=>e.id==='import-normal-file');
  const imported=JSON.stringify({...h.saved(),coins:73,revision:1});
  let late;
  button.click();
  input.files=[{size:imported.length,text:()=>new Promise(resolve=>{late=resolve;})}];
  input.dispatch('change');await settle();
  assert.equal(button.disabled,true);
  h.win.dispatch('pagehide');await settle();
  h.win.dispatch('pageshow',{persisted:true});await settle();
  assert.equal(button.disabled,false,'no need to wait for 45-second timer');
  late(imported);await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),original);
  assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),null);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
  button.click();
  const fresh=h.id('export-local-save').parentElement.children.find(e=>e.id==='import-normal-file');
  assert.notEqual(fresh,input,'BFCache recovery must not reuse a revoked input');
  input.files=[{size:imported.length,text:async()=>imported}];
  input.dispatch('change');await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),original,'late old input cannot use new chooser lease');
  fresh.files=[{size:imported.length,text:async()=>imported}];
  fresh.dispatch('change');await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),imported);
  assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),original);
});

test('P2.65s native cancel after change aborts hung file read and permits a fresh import',async()=>{
  const h=await mount(),original=h.storage.getItem(SAVE_KEY);
  const controls=h.id('export-local-save').parentElement.children;
  const button=controls.find(e=>e.id==='import-normal-save');
  const input=controls.find(e=>e.id==='import-normal-file');
  const imported=JSON.stringify({...h.saved(),coins:67,revision:1});
  let late;
  button.click();
  input.files=[{size:imported.length,text:()=>new Promise(resolve=>{late=resolve;})}];
  input.dispatch('change');await settle();
  assert.equal(button.disabled,true);
  input.dispatch('cancel');await settle();
  assert.equal(button.disabled,false,'cancel must release pending file read immediately');
  late(imported);await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),original);
  assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),null);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
  const fresh=h.id('export-local-save').parentElement.children.find(e=>e.id==='import-normal-file');
  assert.notEqual(fresh,input,'native cancel rotates file input');
  button.click();
  input.files=[{size:imported.length,text:async()=>imported}];
  input.dispatch('change');await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),original,'late old-input event cannot restore');
  fresh.files=[{size:imported.length,text:async()=>imported}];
  fresh.dispatch('change');await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),imported);
  assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),original);
});

test('P2.65s native cancel after confirmation revokes restore waiting for Web Lock',async()=>{
  const h=await mount(),original=h.storage.getItem(SAVE_KEY);
  const controls=h.id('export-local-save').parentElement.children;
  const button=controls.find(e=>e.id==='import-normal-save');
  const input=controls.find(e=>e.id==='import-normal-file');
  const imported=JSON.stringify({...h.saved(),coins:91,revision:1});
  h.win.pauseNextLock=true;
  button.click();
  input.files=[{size:imported.length,text:async()=>imported}];
  input.dispatch('change');await settle();
  assert.equal(typeof h.win.releaseLock,'function','restore must be waiting on lock');
  input.dispatch('cancel');
  h.win.releaseLock();await settle();
  assert.equal(button.disabled,false);
  assert.equal(h.storage.getItem(SAVE_KEY),original,'cancelled lock cannot write save');
  assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),null,'cannot reserve backup');
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
  const fresh=h.id('export-local-save').parentElement.children.find(e=>e.id==='import-normal-file');
  assert.notEqual(fresh,input);
  button.click();
  input.files=[{size:imported.length,text:async()=>imported}];
  input.dispatch('change');await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),original,'old picker cannot authorize new consent');
  fresh.files=[{size:imported.length,text:async()=>imported}];
  fresh.dispatch('change');await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),imported,'safe cancellation remains retryable');
});

test('P2.65s missing AbortController refuses import before opening native chooser',async()=>{
  const h=await mount(),original=h.storage.getItem(SAVE_KEY);
  const controls=h.id('export-local-save').parentElement.children;
  const button=controls.find(e=>e.id==='import-normal-save');
  const input=controls.find(e=>e.id==='import-normal-file');
  let opens=0;
  input.click=()=>{opens++;};
  const originalController=globalThis.AbortController;
  try{
    globalThis.AbortController=undefined;
    button.click();
    assert.equal(opens,0);
    assert.match(h.id('notice').textContent,/缺少安全取消能力/);
    assert.equal(h.storage.getItem(SAVE_KEY),original);
    assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),null);
  }finally{globalThis.AbortController=originalController;}
  button.click();
  assert.equal(opens,1,'restored capability permits a new chooser');
});

test('P2.65t restore-before backup requests exact historical bytes without any gameplay write',async()=>{
  const h=await mount(),raw=JSON.stringify(createInitialState(1_000_000));
  h.storage.setItem(RESTORE_BACKUP_KEY,raw);
  const writes=h.writes.length,originalURL=globalThis.URL,blobs=[],links=[];
  const originalCreate=h.doc.createElement;
  h.doc.createElement=tag=>{
    const element=originalCreate(tag);
    if(tag==='a')links.push(element);
    return element;
  };
  globalThis.URL=class extends originalURL{
    static createObjectURL(blob){blobs.push(blob);return 'blob:p265t-valid';}
    static revokeObjectURL(){}
  };
  try{
    h.id('export-local-save').parentElement.children.find(e=>e.id==='export-restore-backup').click();
    assert.match(h.id('notice').textContent,/已请求下载恢复前原始存档/);
    assert.equal(links[0].download,'yunyu-before-restore-v3.json');
    assert.equal(await blobs[0].text(),raw);
    assert.equal(h.writes.length,writes);
    assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
  }finally{
    globalThis.URL=originalURL;
    h.doc.createElement=originalCreate;
  }
});

test('P2.65t malformed UTF-16 restore backup is explicitly non-importable and lossless',async()=>{
  const h=await mount(),raw='{"damaged":"'+String.fromCharCode(0xD800)+'"}';
  h.storage.setItem(RESTORE_BACKUP_KEY,raw);
  const writes=h.writes.length,originalURL=globalThis.URL,blobs=[],links=[];
  const originalCreate=h.doc.createElement;
  h.doc.createElement=tag=>{
    const element=originalCreate(tag);
    if(tag==='a')links.push(element);
    return element;
  };
  globalThis.URL=class extends originalURL{
    static createObjectURL(blob){blobs.push(blob);return 'blob:p265t-utf16';}
    static revokeObjectURL(){}
  };
  try{
    h.id('export-local-save').parentElement.children.find(e=>e.id==='export-restore-backup').click();
    assert.match(h.id('notice').textContent,/不可直接导入/);
    assert.equal(links[0].download,'yunyu-before-restore-utf16.json');
    assert.equal(JSON.parse(await blobs[0].text()).raw,raw);
    assert.equal(h.writes.length,writes);
    assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),raw);
    assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
  }finally{
    globalThis.URL=originalURL;
    h.doc.createElement=originalCreate;
  }
});

test('P2.65t restore backup download failures preserve evidence and give distinct guidance',async()=>{
  const h=await mount();
  h.id('export-local-save').parentElement.children.find(e=>e.id==='export-restore-backup').click();
  assert.match(h.id('notice').textContent,/尚无恢复前备份/);
  h.storage.setItem(RESTORE_BACKUP_KEY,'x'.repeat(2_000_001));
  const largeWrites=h.writes.length;
  h.id('export-local-save').parentElement.children.find(e=>e.id==='export-restore-backup').click();
  assert.match(h.id('notice').textContent,/超过安全导出上限/);
  assert.equal(h.writes.length,largeWrites);
  h.storage.setItem(RESTORE_BACKUP_KEY,'{broken');
  const originalURL=globalThis.URL;
  globalThis.URL=class extends originalURL{
    static createObjectURL(){throw Error('WebView denied');}
    static revokeObjectURL(){}
  };
  const failedWrites=h.writes.length;
  try{
    h.id('export-local-save').parentElement.children.find(e=>e.id==='export-restore-backup').click();
    assert.match(h.id('notice').textContent,/下载未启动/);
    assert.equal(h.writes.length,failedWrites);
    assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),'{broken');
    assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
  }finally{globalThis.URL=originalURL;}
});

test('P2.65v background/BFCache export clicks cannot start any of three downloads',async()=>{
  const h=await mount();
  h.map.set(ABNORMAL_RESET_BACKUP_KEY,'{abnormal-original');
  h.map.set(RESTORE_BACKUP_KEY,'{restore-original');
  const oldCreate=URL.createObjectURL,created=[];
  const before=h.writes.length;
  try{
    URL.createObjectURL=()=>{created.push(true);return 'blob:p265v-hidden';};
    h.doc.hidden=true;h.doc.dispatch('visibilitychange');
    const buttons=[h.id('export-local-save'),h.id('export-abnormal-reset-backup'),
      h.id('export-local-save').parentElement.children.find(e=>e.id==='export-restore-backup')];
    for(const button of buttons){
      button.click();
      assert.match(h.id('notice').textContent,/后台|尚未恢复核验/);
    }
    assert.deepEqual(created,[]);
    assert.equal(h.writes.length,before);
    assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
  }finally{URL.createObjectURL=oldCreate;}
});

test('P2.65v normal export refuses a save changed by another tab during preparation',async()=>{
  const h=await mount(),oldGet=h.storage.getItem.bind(h.storage);
  const changed=JSON.stringify({...h.saved(),coins:913});
  const before=h.writes.length,oldCreate=URL.createObjectURL;
  let reads=0,created=0;
  h.storage.getItem=key=>{
    const value=oldGet(key);
    if(key===SAVE_KEY&&++reads===1)h.map.set(SAVE_KEY,changed);
    return value;
  };
  try{
    URL.createObjectURL=()=>{created++;return 'blob:p265v-stale';};
    h.id('export-local-save').click();
    // The new pre-export reconciliation detects the fork earlier than
    // download preparation, and blocks the stale board rather than merely
    // reporting a failed download. Keep the zero-download assertion below.
    assert.match(h.id('notice').textContent,/检测到跨标签或后台存档变化/);
    assert.match(h.id('save-status').textContent,/已暂停/);
    assert.equal(created,0);
    assert.equal(oldGet(SAVE_KEY),changed);
    assert.equal(h.writes.length,before);
    assert.equal(oldGet(STORY_SAVE_KEY),'story-not-touched');
  }finally{URL.createObjectURL=oldCreate;h.storage.getItem=oldGet;}
});

test('P2.65v abnormal and restore backup exports reject changed original bytes',async()=>{
  for(const [key,buttonId] of [
    [ABNORMAL_RESET_BACKUP_KEY,'export-abnormal-reset-backup'],
    [RESTORE_BACKUP_KEY,'export-restore-backup']
  ]){
    const h=await mount(),oldGet=h.storage.getItem.bind(h.storage);
    const before=h.writes.length,oldCreate=URL.createObjectURL;
    const original='backup\ud800original',changed='backup-updated';
    h.map.set(key,original);
    let reads=0,created=0;
    h.storage.getItem=readKey=>{
      const value=oldGet(readKey);
      if(readKey===key&&++reads===1)h.map.set(key,changed);
      return value;
    };
    try{
      URL.createObjectURL=()=>{created++;return 'blob:p265v-backup';};
      const button=buttonId==='export-restore-backup'
        ?h.id('export-local-save').parentElement.children.find(e=>e.id===buttonId)
        :h.id(buttonId);
      button.click();
      assert.match(h.id('notice').textContent,/导出期间.*变化/);
      assert.equal(created,0);
      assert.equal(oldGet(key),changed);
      assert.equal(h.writes.length,before);
      assert.equal(oldGet(STORY_SAVE_KEY),'story-not-touched');
    }finally{URL.createObjectURL=oldCreate;h.storage.getItem=oldGet;}
  }
});


test('P2.65w all three real export buttons reject source change during anchor insertion',async()=>{
  for(const [key,buttonId] of [
    [SAVE_KEY,'export-local-save'],
    [ABNORMAL_RESET_BACKUP_KEY,'export-abnormal-reset-backup'],
    [RESTORE_BACKUP_KEY,'export-restore-backup']
  ]){
    const h=await mount(),originalURL=globalThis.URL;
    if(key!==SAVE_KEY)h.map.set(key,'backup-original');
    const before=h.writes.length;
    let clicked=0,revoked=0;
    const oldCreate=h.doc.createElement.bind(h.doc);
    h.doc.createElement=tag=>{
      const node=oldCreate(tag);
      if(tag==='a')node.click=()=>{clicked++;};
      return node;
    };
    const oldAppend=h.doc.body.append.bind(h.doc.body);
    h.doc.body.append=(...nodes)=>{
      oldAppend(...nodes);
      h.map.set(key,'source-changed-before-click');
    };
    globalThis.URL=class extends originalURL{
      static createObjectURL(){return 'blob:p265w-preclick';}
      static revokeObjectURL(){revoked++;}
    };
    try{
      const button=buttonId==='export-restore-backup'
        ?h.id('export-local-save').parentElement.children.find(e=>e.id===buttonId)
        :h.id(buttonId);
      button.click();
      assert.equal(clicked,0,key);
      assert.equal(revoked,1,key);
      assert.match(h.id('notice').textContent,/下载前.*变化/,key);
      assert.equal(h.writes.length,before,key);
      assert.equal(h.storage.getItem(key),'source-changed-before-click',key);
      assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched',key);
    }finally{globalThis.URL=originalURL;}
  }
});

test('P2.65w BFCache/hidden transition during download preparation blocks native click',async()=>{
  const h=await mount(),originalURL=globalThis.URL;
  const before=h.writes.length;
  let clicked=0,revoked=0;
  const oldCreate=h.doc.createElement.bind(h.doc);
  h.doc.createElement=tag=>{
    const node=oldCreate(tag);
    if(tag==='a')node.click=()=>{clicked++;};
    return node;
  };
  const oldAppend=h.doc.body.append.bind(h.doc.body);
  h.doc.body.append=(...nodes)=>{
    oldAppend(...nodes);
    h.win.dispatch('pagehide',{persisted:true});
  };
  globalThis.URL=class extends originalURL{
    static createObjectURL(){return 'blob:p265w-pagehide';}
    static revokeObjectURL(){revoked++;}
  };
  try{
    h.id('export-local-save').click();
    assert.equal(clicked,0);
    assert.equal(revoked,1);
    assert.match(h.id('notice').textContent,/下载前.*变化/);
    assert.equal(h.writes.length,before);
    assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
  }finally{globalThis.URL=originalURL;}
});

// P2.65z: older Safari/WeChat file pickers may omit the native cancel event.
test('P2.65z orphaned native chooser recovers after focus grace without any save write',async()=>{
  const h=await mount(),before=h.writes.length;
  const controls=h.id('export-local-save').parentElement.children;
  const button=controls.find(e=>e.id==='import-normal-save');
  const input=controls.find(e=>e.id==='import-normal-file');
  let opens=0;input.click=()=>{opens++;};
  const deadlines=[];
  h.win.setTimeout=(fn,ms)=>{if(ms===15_000)deadlines.push(fn);return 1;};
  button.click();assert.equal(opens,1);
  h.win.dispatch('blur');h.win.dispatch('focus');
  assert.equal(deadlines.length,1,'focus return must schedule bounded recovery');
  button.click();assert.equal(opens,1,'do not overlap native choosers before grace');
  deadlines.shift()();
  assert.equal(input.parentElement,null,'expired chooser input must be detached');
  const fresh=h.id('export-local-save').parentElement.children.find(e=>e.id==='import-normal-file');
  assert.notEqual(fresh,input);
  fresh.click=()=>{opens++;};
  button.click();assert.equal(opens,2,'an orphaned chooser no longer blocks retry');
  assert.equal(h.writes.length,before);
  assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),null);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65z valid delayed chooser change wins over stale focus recovery timer',async()=>{
  const h=await mount(),original=h.storage.getItem(SAVE_KEY);
  const controls=h.id('export-local-save').parentElement.children;
  const button=controls.find(e=>e.id==='import-normal-save');
  const input=controls.find(e=>e.id==='import-normal-file');
  const deadlines=[];
  h.win.setTimeout=(fn,ms)=>{if(ms===15_000)deadlines.push(fn);return 1;};
  button.click();h.win.dispatch('blur');h.win.dispatch('focus');
  assert.equal(deadlines.length,1);
  const imported=JSON.stringify({...h.saved(),coins:73,revision:1});
  input.files=[{size:imported.length,text:async()=>imported}];
  input.dispatch('change');
  await settle();
  deadlines.shift()();
  assert.equal(h.storage.getItem(SAVE_KEY),imported);
  assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),original);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65z old picker timeout cannot clear a fresh picker; visible return also recovers',async()=>{
  const h=await mount(),before=h.writes.length;
  const controls=h.id('export-local-save').parentElement.children;
  const button=controls.find(e=>e.id==='import-normal-save');
  const input=controls.find(e=>e.id==='import-normal-file');
  let opens=0;input.click=()=>{opens++;};
  const deadlines=[];
  h.win.setTimeout=(fn,ms)=>{if(ms===15_000)deadlines.push(fn);return 1;};
  button.click();h.win.dispatch('blur');h.win.dispatch('focus');
  assert.equal(deadlines.length,1);
  input.dispatch('cancel');
  const second=h.id('export-local-save').parentElement.children.find(e=>e.id==='import-normal-file');
  second.click=()=>{opens++;};
  button.click();assert.equal(opens,2);
  deadlines.shift()();
  button.click();assert.equal(opens,2,'old callback cannot release newer picker');
  h.doc.hidden=true;h.doc.dispatch('visibilitychange');
  h.doc.hidden=false;h.doc.dispatch('visibilitychange');
  assert.equal(deadlines.length,1,'visible return schedules a new grace period');
  deadlines.shift()();
  const third=h.id('export-local-save').parentElement.children.find(e=>e.id==='import-normal-file');
  third.click=()=>{opens++;};
  button.click();assert.equal(opens,3);
  assert.equal(h.writes.length,before);
  assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),null);
});

test('P2.65aa unrelated focus cannot expire an open native file chooser',async()=>{
  const h=await mount(),before=h.writes.length;
  const controls=h.id('export-local-save').parentElement.children;
  const button=controls.find(e=>e.id==='import-normal-save');
  const input=controls.find(e=>e.id==='import-normal-file');
  let opens=0;input.click=()=>{opens++;};
  const deadlines=[];
  h.win.setTimeout=(fn,ms)=>{if(ms===15_000)deadlines.push(fn);return 1;};
  button.click();
  h.win.dispatch('focus');
  assert.equal(deadlines.length,0,'focus without chooser blur/hide is not a return');
  h.win.dispatch('blur');h.win.dispatch('focus');h.win.dispatch('focus');
  assert.equal(deadlines.length,1,'duplicate focus cannot shorten the grace');
  assert.equal(opens,1);
  assert.equal(h.writes.length,before);
  assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),null);
});

test('P2.65aa expired chooser rejects late file, fresh chooser can still import',async()=>{
  const h=await mount(),original=h.storage.getItem(SAVE_KEY);
  const controls=h.id('export-local-save').parentElement.children;
  const button=controls.find(e=>e.id==='import-normal-save');
  const input=controls.find(e=>e.id==='import-normal-file');
  const deadlines=[];
  h.win.setTimeout=(fn,ms)=>{if(ms===15_000)deadlines.push(fn);return 1;};
  button.click();h.win.dispatch('blur');h.win.dispatch('focus');
  assert.equal(deadlines.length,1);
  deadlines.shift()();
  const imported=JSON.stringify({...h.saved(),revision:1,coins:55});
  input.files=[{size:imported.length,text:async()=>imported}];
  input.dispatch('change');await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),original);
  assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),null);
  const fresh=h.id('export-local-save').parentElement.children.find(e=>e.id==='import-normal-file');
  assert.notEqual(fresh,input,'timeout must rotate native chooser identity');
  button.click();
  input.files=[{size:imported.length,text:async()=>imported}];
  input.dispatch('change');input.dispatch('cancel');await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),original,'old change/cancel cannot use new chooser lease');
  fresh.files=[{size:imported.length,text:async()=>imported}];
  fresh.dispatch('change');await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),imported);
  assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),original);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65ab explicit cancel recovers chooser with no native cancel, blur or visibility event',async()=>{
  const h=await mount(),original=h.storage.getItem(SAVE_KEY),before=h.writes.length;
  const controls=h.id('export-local-save').parentElement.children;
  const button=controls.find(e=>e.id==='import-normal-save');
  const cancel=controls.find(e=>e.id==='cancel-normal-import');
  const stale=controls.find(e=>e.id==='import-normal-file');
  let opened=0;stale.click=()=>{opened++;};
  assert.equal(cancel.hidden,true);
  button.click();assert.equal(cancel.hidden,false);
  cancel.click();assert.equal(cancel.hidden,true);
  assert.match(h.id('notice').textContent,/已请求取消导入.*核对/);
  assert.equal(stale.parentElement,null,'old native chooser input is detached');
  assert.equal(h.writes.length,before);
  // Element.remove() replaces the fixture's children array; read the live
  // parent again rather than the pre-removal array snapshot.
  const fresh=h.id('export-local-save').parentElement.children.find(e=>e.id==='import-normal-file');
  assert.notEqual(fresh,stale);
  fresh.click=()=>{opened++;};
  button.click();assert.equal(opened,2);
  const imported=JSON.stringify({...h.saved(),revision:1,coins:91});
  stale.files=[{size:imported.length,text:async()=>imported}];
  stale.dispatch('change');stale.dispatch('cancel');
  await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),original,'stale input cannot authorize new chooser');
  fresh.files=[{size:imported.length,text:async()=>imported}];
  fresh.dispatch('change');await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),imported);
  assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),original);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65ab explicit cancel aborts hung file read without touching either save namespace',async()=>{
  const h=await mount(),original=h.storage.getItem(SAVE_KEY),before=h.writes.length;
  const controls=h.id('export-local-save').parentElement.children;
  const button=controls.find(e=>e.id==='import-normal-save');
  const cancel=controls.find(e=>e.id==='cancel-normal-import');
  const input=controls.find(e=>e.id==='import-normal-file');
  button.click();
  input.files=[{size:42,text:()=>new Promise(()=>{})}];
  input.dispatch('change');await settle();
  assert.equal(button.disabled,true);
  cancel.click();await settle();
  assert.equal(button.disabled,false,'abort releases the hung UI read');
  assert.equal(cancel.hidden,true);
  assert.equal(h.writes.length,before);
  assert.equal(h.storage.getItem(SAVE_KEY),original);
  assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),null);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65ab explicit cancel revokes restore confirmation while Web Lock is pending',async()=>{
  const h=await mount(),original=h.storage.getItem(SAVE_KEY);
  const controls=h.id('export-local-save').parentElement.children;
  const button=controls.find(e=>e.id==='import-normal-save');
  const cancel=controls.find(e=>e.id==='cancel-normal-import');
  const input=controls.find(e=>e.id==='import-normal-file');
  const imported=JSON.stringify({...h.saved(),revision:1,coins:74});
  h.win.pauseNextLock=true;
  button.click();input.files=[{size:imported.length,text:async()=>imported}];
  input.dispatch('change');await settle();
  assert.equal(typeof h.win.releaseLock,'function');
  cancel.click();
  h.win.releaseLock();await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),original);
  assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),null);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
  assert.equal(button.disabled,false);
});


test('P2.65af hidden first load defers startup without creating or blocking a save',async()=>{
  const h=await mount({initialHidden:true});
  assert.equal(h.storage.getItem(SAVE_KEY),null);
  assert.deepEqual(h.writes,[]);
  assert.match(h.id('save-status').textContent,/正在核验/);
  h.doc.hidden=false;
  h.doc.dispatch('visibilitychange');
  await settle();
  assert.equal(h.saved().revision,0);
  assert.deepEqual(h.writes,[SAVE_KEY]);
  assert.match(h.id('save-status').textContent,/已保存于此浏览器/);
  h.win.dispatch('pageshow',{persisted:true});
  await settle();
  assert.deepEqual(h.writes,[SAVE_KEY],'resumed pageshow must not replay startup');
});

test('P2.65af pagehide before first startup requires pageshow before any write',async()=>{
  const h=await mount({initialHidden:true});
  h.win.dispatch('pagehide');
  h.doc.hidden=false;
  h.doc.dispatch('visibilitychange');
  await settle();
  assert.deepEqual(h.writes,[],'visibility alone must not revive pagehide');
  h.win.dispatch('pageshow',{persisted:true});
  await settle();
  assert.equal(h.saved().revision,0);
  assert.deepEqual(h.writes,[SAVE_KEY]);
});

test('P2.65af hidden BFCache return defers first startup until visible',async()=>{
  const h=await mount({initialHidden:true});
  h.win.dispatch('pagehide');
  h.win.dispatch('pageshow',{persisted:true});
  assert.deepEqual(h.writes,[]);
  h.doc.hidden=false;
  h.doc.dispatch('visibilitychange');
  await settle();
  assert.equal(h.saved().revision,0);
  assert.deepEqual(h.writes,[SAVE_KEY]);
});

test('P2.65ah pagehide during unchanged-save preflight cancels a selected-item write',async()=>{
  const h=await mount(),board=h.id('board');
  board.dispatch('click',{target:board.children[0],detail:1});
  assert.equal(h.id('store-selected').disabled,false);
  const before=h.writes.length,raw=h.storage.getItem(SAVE_KEY);
  const original=h.storage.getItem;
  let fired=false;
  h.storage.getItem=key=>{
    const value=original(key);
    if(key===SAVE_KEY&&!fired){fired=true;h.win.dispatch('pagehide');}
    return value;
  };
  h.id('store-selected').click();
  await settle();
  assert.equal(fired,true,'pagehide was injected inside exact-byte read');
  assert.equal(h.writes.length,before,'no save may be written after pagehide');
  assert.equal(h.storage.getItem(SAVE_KEY),raw);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65ah visibility hide during post-confirm reset preflight prevents reset',async()=>{
  const h=await mount(),before=h.writes.length,raw=h.storage.getItem(SAVE_KEY);
  const original=h.storage.getItem;
  let armed=false,fired=false;
  h.win.confirm=()=>{armed=true;return true;};
  h.storage.getItem=key=>{
    const value=original(key);
    if(armed&&key===SAVE_KEY&&!fired){
      fired=true;h.doc.hidden=true;h.doc.dispatch('visibilitychange');
    }
    return value;
  };
  h.id('reset').click();
  await settle();
  assert.equal(armed,true,'reset confirmation was shown first');
  assert.equal(fired,true,'visibility hide occurred in post-confirm preflight');
  assert.equal(h.writes.length,before,'reset cannot use stale confirmation');
  assert.equal(h.storage.getItem(SAVE_KEY),raw);
  assert.equal(h.storage.getItem(ABNORMAL_RESET_BACKUP_KEY),null);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65ak in-flight Web Lock action cannot export a moving normal save',async()=>{
  const h=await mount(),board=h.id('board');
  h.win.pauseNextLock=true;
  board.dispatch('click',{target:board.children[42],detail:1});
  await settle();
  assert.equal(typeof h.win.releaseLock,'function');
  const before=h.writes.length;
  h.id('export-local-save').click();
  assert.match(h.id('notice').textContent,/正在安全保存或恢复存档/);
  assert.equal(h.writes.length,before,'export must not write or mutate either save');
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
  h.win.releaseLock();
  await settle();
  assert.equal(h.saved().revision,1,'the original locked action still completes');
});

test('P2.65ak stale normal export first adopts newer cross-tab board without downloading',async()=>{
  const h=await mount(),old=h.saved();
  const newer={...old,revision:old.revision+1,coins:old.coins+25};
  h.storage.setItem(SAVE_KEY,JSON.stringify(newer));
  const before=h.writes.length;
  // Deliberately omit storage event: the export button itself must inspect.
  h.id('export-local-save').click();
  assert.match(h.id('notice').textContent,/最新棋盘上重新操作/);
  assert.doesNotMatch(h.id('notice').textContent,/已请求下载/);
  assert.equal(h.id('coins').textContent,newer.coins.toLocaleString('zh-CN'));
  assert.equal(h.writes.length,before);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65al throwing import abort on pagehide still revokes old file consent',async()=>{
  const NativeController=globalThis.AbortController;
  class ThrowingController {
    constructor(){this.native=new NativeController();this.signal=this.native.signal;}
    abort(){throw Error('broken WebView abort');}
  }
  try{
    globalThis.AbortController=ThrowingController;
    const h=await mount(),original=h.storage.getItem(SAVE_KEY),before=h.writes.length;
    const controls=h.id('export-local-save').parentElement.children;
    const input=controls.find(e=>e.id==='import-normal-file');
    controls.find(e=>e.id==='import-normal-save').click();
    const imported=JSON.stringify({...h.saved(),revision:1,coins:83});
    let release;
    input.files=[{size:imported.length,text:()=>new Promise(resolve=>{release=resolve;})}];
    input.dispatch('change');await settle();
    assert.equal(typeof release,'function');
    assert.doesNotThrow(()=>h.win.dispatch('pagehide'));
    release(imported);await settle();
    assert.equal(h.storage.getItem(SAVE_KEY),original);
    assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),null);
    assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
    assert.equal(h.writes.length,before);
    assert.match(h.id('save-status').textContent,/已暂停/);
  }finally{globalThis.AbortController=NativeController;}
});

test('P2.65al no-op import abort on visibility hide cannot restore late file',async()=>{
  const NativeController=globalThis.AbortController;
  class NoopController {
    constructor(){this.native=new NativeController();this.signal=this.native.signal;}
    abort(){/* Broken WebView polyfill never marks signal aborted. */}
  }
  try{
    globalThis.AbortController=NoopController;
    const h=await mount(),original=h.storage.getItem(SAVE_KEY),before=h.writes.length;
    const controls=h.id('export-local-save').parentElement.children;
    const input=controls.find(e=>e.id==='import-normal-file');
    controls.find(e=>e.id==='import-normal-save').click();
    const imported=JSON.stringify({...h.saved(),revision:1,coins:84});
    let release;
    input.files=[{size:imported.length,text:()=>new Promise(resolve=>{release=resolve;})}];
    input.dispatch('change');await settle();
    assert.equal(typeof release,'function');
    h.doc.hidden=true;
    assert.doesNotThrow(()=>h.doc.dispatch('visibilitychange'));
    release(imported);await settle();
    assert.equal(h.storage.getItem(SAVE_KEY),original);
    assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),null);
    assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
    assert.equal(h.writes.length,before);
    assert.match(h.id('save-status').textContent,/已暂停/);
  }finally{globalThis.AbortController=NativeController;}
});

test('P2.65am pending native import chooser blocks reset and ordinary action until cancelled',async()=>{
  const h=await mount();
  const controls=h.id('export-local-save').parentElement.children;
  const importButton=controls.find(e=>e.id==='import-normal-save');
  const cancel=controls.find(e=>e.id==='cancel-normal-import');
  const original=h.storage.getItem(SAVE_KEY),before=h.writes.length;
  let confirmations=0;
  h.win.confirm=()=>{confirmations++;return true;};
  importButton.click();
  assert.equal(cancel.hidden,false);
  h.id('reset').click();
  h.id('board').dispatch('click',{target:h.id('board').children[42],detail:1});
  await settle();
  assert.equal(confirmations,0,'reset must not confirm over a native chooser');
  assert.equal(h.storage.getItem(SAVE_KEY),original);
  assert.equal(h.writes.length,before,'no ordinary writer may race a chooser');
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
  cancel.click();
  assert.equal(cancel.hidden,true);
  h.id('board').dispatch('click',{target:h.id('board').children[42],detail:1});
  await settle();
  assert.equal(h.saved().revision,1,'fresh action is allowed after explicit cancel');
});

test('P2.65am pending file read blocks clock, reset and player write without losing restore',async()=>{
  const seed=createInitialState(Date.now()-1_000_000);
  seed.energy=MAX_ENERGY-1;
  seed.energyAt=Date.now()-ENERGY_REGEN_MS*2;
  const h=await mount({initialRaw:JSON.stringify(seed)});
  const controls=h.id('export-local-save').parentElement.children;
  const button=controls.find(e=>e.id==='import-normal-save');
  const input=controls.find(e=>e.id==='import-normal-file');
  const target=JSON.stringify({...h.saved(),coins:87,revision:1});
  let release,confirmations=0;
  h.win.confirm=()=>{confirmations++;return true;};
  button.click();
  input.files=[{size:target.length,text:()=>new Promise(resolve=>{release=resolve;})}];
  input.dispatch('change');
  await settle();
  assert.equal(typeof release,'function');
  const before=h.writes.length,original=h.storage.getItem(SAVE_KEY);
  await h.win.timer();
  h.id('reset').click();
  h.id('board').dispatch('click',{target:h.id('board').children[42],detail:1});
  await settle();
  assert.equal(confirmations,0,'only the later restore confirmation may appear');
  assert.equal(h.storage.getItem(SAVE_KEY),original);
  assert.equal(h.writes.length,before,'timer and gestures cannot alter an in-flight import baseline');
  release(target);
  await settle();
  assert.equal(confirmations,1,'the import receives exactly its own confirmation');
  assert.equal(h.storage.getItem(SAVE_KEY),target,'the original file remains restorable');
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65am explicit import cancel releases single-flight gate without replaying late file',async()=>{
  const h=await mount();
  const controls=h.id('export-local-save').parentElement.children;
  const button=controls.find(e=>e.id==='import-normal-save');
  const input=controls.find(e=>e.id==='import-normal-file');
  const cancel=controls.find(e=>e.id==='cancel-normal-import');
  const original=h.storage.getItem(SAVE_KEY),before=h.writes.length;
  const target=JSON.stringify({...h.saved(),coins:99,revision:1});
  let release;
  button.click();
  input.files=[{size:target.length,text:()=>new Promise(resolve=>{release=resolve;})}];
  input.dispatch('change');
  await settle();
  assert.equal(typeof release,'function');
  cancel.click();
  release(target);
  await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),original);
  assert.equal(h.writes.length,before,'cancelled file cannot restore later');
  h.id('board').dispatch('click',{target:h.id('board').children[42],detail:1});
  await settle();
  assert.equal(h.saved().revision,1,'a fresh ordinary action can proceed after cancellation');
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65an reset confirmation cannot erase a save when a native chooser starts reentrantly',async()=>{
  const h=await mount(),controls=h.id('export-local-save').parentElement.children;
  const importButton=controls.find(e=>e.id==='import-normal-save');
  const cancel=controls.find(e=>e.id==='cancel-normal-import');
  const board=h.id('board');
  board.dispatch('click',{target:board.children[42],detail:1});
  await settle();
  assert.equal(h.saved().revision,1);
  const raw=h.storage.getItem(SAVE_KEY),before=h.writes.length;
  h.win.confirm=()=>{importButton.click();return true;};
  h.id('reset').click();
  await settle();
  assert.equal(cancel.hidden,false,'the nested chooser is still pending');
  assert.equal(h.storage.getItem(SAVE_KEY),raw,'reset cannot overtake a new import intent');
  assert.equal(h.writes.length,before);
  cancel.click();
  h.win.confirm=()=>true;
  h.id('reset').click();
  await settle();
  assert.equal(h.saved().revision,0,'fresh reset confirmation is permitted');
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65an opening import cancels a captured mobile drag and its delayed click',async()=>{
  const h=await mount(),board=h.id('board');
  const controls=h.id('export-local-save').parentElement.children;
  const importButton=controls.find(e=>e.id==='import-normal-save');
  const cancel=controls.find(e=>e.id==='cancel-normal-import');
  const first=board.children[0];
  board.dispatch('pointerdown',{target:first,pointerId:51,clientX:0,clientY:0});
  board.dispatch('pointermove',{target:first,pointerId:51,clientX:20,clientY:0});
  assert.equal(h.doc.body.children.length,1);
  importButton.click();
  assert.equal(h.doc.body.children.length,0,'native chooser removes old drag ghost');
  const before=h.writes.length,raw=h.storage.getItem(SAVE_KEY);
  cancel.click();
  board.dispatch('pointerup',{target:first,pointerId:51,clientX:20,clientY:0});
  board.dispatch('click',{target:board.children[42],detail:1});
  await settle();
  assert.equal(h.writes.length,before,'late compatibility click cannot produce');
  assert.equal(h.storage.getItem(SAVE_KEY),raw);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65an chooser-era pointerdown cannot arm a late click after cancel',async()=>{
  const h=await mount(),board=h.id('board');
  const controls=h.id('export-local-save').parentElement.children;
  const importButton=controls.find(e=>e.id==='import-normal-save');
  const cancel=controls.find(e=>e.id==='cancel-normal-import');
  importButton.click();
  const producer=board.children[42],raw=h.storage.getItem(SAVE_KEY);
  const before=h.writes.length;
  board.dispatch('pointerdown',{target:producer,pointerId:52});
  cancel.click();
  board.dispatch('click',{target:producer,detail:1});
  await settle();
  assert.equal(h.writes.length,before);
  assert.equal(h.storage.getItem(SAVE_KEY),raw);
  board.dispatch('pointerdown',{target:board.children[42],pointerId:53});
  board.dispatch('click',{target:board.children[42],detail:1});
  await settle();
  assert.equal(h.saved().revision,1,'fresh touch after cancel remains playable');
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65ao chooser-era pointer cannot spend coins through persistent warehouse upgrade',async()=>{
  const seed=createInitialState(Date.now());seed.coins=1000;seed.xp=1500;
  const h=await mount({initialRaw:JSON.stringify(seed)});
  const controls=h.id('export-local-save').parentElement.children;
  const importButton=controls.find(e=>e.id==='import-normal-save');
  const cancel=controls.find(e=>e.id==='cancel-normal-import');
  const upgrade=h.id('warehouse-upgrade');
  assert.equal(upgrade.disabled,false);
  importButton.click();
  const raw=h.storage.getItem(SAVE_KEY),before=h.writes.length;
  upgrade.dispatch('pointerdown',{pointerId:81});
  cancel.click();
  upgrade.dispatch('click',{detail:1});
  await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),raw,'old chooser-era upgrade must not spend coins');
  assert.equal(h.writes.length,before);
  upgrade.dispatch('pointerdown',{pointerId:82});
  upgrade.dispatch('click',{detail:1});
  await settle();
  assert.equal(h.saved().warehouse.capacity,6,'fresh pointer after cancellation can upgrade');
  assert.equal(h.saved().coins,950);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65ao chooser-era pointer cannot open destructive reset confirmation after cancel',async()=>{
  const h=await mount(),board=h.id('board');
  board.dispatch('click',{target:board.children[42],detail:1});
  await settle();
  assert.equal(h.saved().revision,1);
  const controls=h.id('export-local-save').parentElement.children;
  const importButton=controls.find(e=>e.id==='import-normal-save');
  const cancel=controls.find(e=>e.id==='cancel-normal-import');
  const reset=h.id('reset');
  let confirmations=0;
  h.win.confirm=()=>{confirmations++;return true;};
  importButton.click();
  const raw=h.storage.getItem(SAVE_KEY),before=h.writes.length;
  reset.dispatch('pointerdown',{pointerId:83});
  cancel.click();
  reset.dispatch('click',{detail:1});
  await settle();
  assert.equal(confirmations,0,'stale reset click must not even request confirmation');
  assert.equal(h.storage.getItem(SAVE_KEY),raw);
  assert.equal(h.writes.length,before);
  reset.dispatch('pointerdown',{pointerId:84});
  reset.dispatch('click',{detail:1});
  await settle();
  assert.equal(confirmations,1);
  assert.equal(h.saved().revision,0,'new confirmation may reset normally');
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65ap pointer pressed before chooser opens cannot spend coins after chooser cancellation',async()=>{
  const seed=createInitialState(Date.now());seed.coins=1000;seed.xp=1500;
  const h=await mount({initialRaw:JSON.stringify(seed)});
  const upgrade=h.id('warehouse-upgrade');
  const controls=h.id('export-local-save').parentElement.children;
  const importButton=controls.find(e=>e.id==='import-normal-save');
  const cancel=controls.find(e=>e.id==='cancel-normal-import');
  upgrade.dispatch('pointerdown',{pointerId:91});
  importButton.click();
  cancel.click();
  const original=h.storage.getItem(SAVE_KEY),before=h.writes.length;
  upgrade.dispatch('click',{detail:1});
  await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),original,'pre-chooser pointer cannot authorize later upgrade');
  assert.equal(h.writes.length,before);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
  upgrade.dispatch('pointerdown',{pointerId:92});
  upgrade.dispatch('click',{detail:1});
  await settle();
  assert.equal(h.saved().warehouse.capacity,6,'fresh pointer after cancel may upgrade');
  assert.equal(h.saved().coins,950);
});

test('P2.65ap BFCache invalidates reset pointer begun before pagehide',async()=>{
  const h=await mount(),board=h.id('board');
  board.dispatch('click',{target:board.children[42],detail:1});
  await settle();
  assert.equal(h.saved().revision,1);
  let confirmations=0;
  h.win.confirm=()=>{confirmations++;return true;};
  const reset=h.id('reset');
  reset.dispatch('pointerdown',{pointerId:93});
  h.win.dispatch('pagehide');
  h.win.dispatch('pageshow',{persisted:true});
  await settle();
  const original=h.storage.getItem(SAVE_KEY),before=h.writes.length;
  reset.dispatch('click',{detail:1});
  await settle();
  assert.equal(confirmations,0,'late BFCache click cannot open reset confirmation');
  assert.equal(h.storage.getItem(SAVE_KEY),original);
  assert.equal(h.writes.length,before);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
  reset.dispatch('pointerdown',{pointerId:94});
  reset.dispatch('click',{detail:1});
  await settle();
  assert.equal(confirmations,1,'fresh pointer may confirm reset');
  assert.equal(h.saved().revision,0);
});


test('P2.65aq chooser lease blocks all three save exports until explicit cancellation',async()=>{
  const h=await mount(),before=h.writes.length,original=h.storage.getItem(SAVE_KEY);
  const controls=h.id('export-local-save').parentElement.children;
  controls.find(e=>e.id==='import-normal-save').click();
  for(const id of ['export-local-save','export-abnormal-reset-backup','export-restore-backup']){
    h.id(id).click();
    assert.match(h.id('notice').textContent,/正在选择或核验导入文件/,id);
  }
  assert.equal(h.writes.length,before,'read-only export refusal cannot write');
  assert.equal(h.storage.getItem(SAVE_KEY),original);
  controls.find(e=>e.id==='import-normal-file').dispatch('cancel');
  h.id('export-local-save').click();
  assert.doesNotMatch(h.id('notice').textContent,/正在选择或核验导入文件/);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65aq pending file read blocks export; cancellation and late data cannot write',async()=>{
  const h=await mount(),original=h.storage.getItem(SAVE_KEY);
  const controls=h.id('export-local-save').parentElement.children;
  const input=controls.find(e=>e.id==='import-normal-file');
  const imported=JSON.stringify({...h.saved(),coins:127,revision:1});
  let resolveRead;
  controls.find(e=>e.id==='import-normal-save').click();
  input.files=[{size:imported.length,text:()=>new Promise(resolve=>{resolveRead=resolve;})}];
  input.dispatch('change');await settle();
  assert.equal(typeof resolveRead,'function');
  const before=h.writes.length;
  for(const id of ['export-local-save','export-abnormal-reset-backup','export-restore-backup']){
    h.id(id).click();
    assert.match(h.id('notice').textContent,/正在选择或核验导入文件/,id);
  }
  controls.find(e=>e.id==='cancel-normal-import').click();
  resolveRead(imported);await settle();
  assert.equal(h.writes.length,before,'late read and refused exports must not write');
  assert.equal(h.storage.getItem(SAVE_KEY),original);
  assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),null);
  h.id('export-local-save').click();
  assert.doesNotMatch(h.id('notice').textContent,/正在选择或核验导入文件/);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65aq chooser opened reentrantly during export preflight blocks download',async()=>{
  const h=await mount(),original=h.storage.getItem(SAVE_KEY);
  const controls=h.id('export-local-save').parentElement.children;
  const read=h.storage.getItem.bind(h.storage);
  let injected=false;
  h.storage.getItem=key=>{
    const value=read(key);
    if(key===SAVE_KEY&&!injected){
      injected=true;
      controls.find(e=>e.id==='import-normal-save').click();
    }
    return value;
  };
  const before=h.writes.length;
  h.id('export-local-save').click();
  assert.equal(injected,true,'chooser opened after the first export authorization');
  assert.match(h.id('notice').textContent,/正在选择或核验导入文件/);
  assert.equal(h.writes.length,before);
  assert.equal(h.storage.getItem(SAVE_KEY),original);
  controls.find(e=>e.id==='import-normal-file').dispatch('cancel');
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65ar pre-chooser export touches cannot download after cancellation',async()=>{
  const h=await mount(),controls=h.id('export-local-save').parentElement.children;
  const buttons=[h.id('export-local-save'),h.id('export-abnormal-reset-backup'),
    controls.find(e=>e.id==='export-restore-backup')];
  for(let i=0;i<buttons.length;i++)
    buttons[i].dispatch('pointerdown',{pointerId:110+i});
  controls.find(e=>e.id==='import-normal-save').click();
  controls.find(e=>e.id==='cancel-normal-import').click();
  const oldCreate=URL.createObjectURL;
  let created=0;
  try{
    URL.createObjectURL=()=>{created++;return 'blob:p265ar-stale';};
    for(const button of buttons){
      button.dispatch('click',{detail:1});
      assert.match(h.id('notice').textContent,/页面或导入状态已变化/,
        'late pointer must not request a backup download');
    }
    assert.equal(created,0,'no stale pointer may create a download URL');
  }finally{URL.createObjectURL=oldCreate;}
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65ar BFCache rejects a stale import button click, fresh touch still opens picker',async()=>{
  const h=await mount(),controls=h.id('export-local-save').parentElement.children;
  const importButton=controls.find(e=>e.id==='import-normal-save');
  const cancel=controls.find(e=>e.id==='cancel-normal-import');
  importButton.dispatch('pointerdown',{pointerId:120});
  h.win.dispatch('pagehide');
  h.win.dispatch('pageshow',{persisted:true});
  importButton.dispatch('click',{detail:1});
  assert.equal(cancel.hidden,true,'old pointer must not reopen native chooser');
  importButton.dispatch('pointerdown',{pointerId:121});
  importButton.dispatch('click',{detail:1});
  assert.equal(cancel.hidden,false,'new touch can open picker after BFCache');
  cancel.click();
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65ar delayed cancel touch cannot cancel a newer import chooser',async()=>{
  const h=await mount(),controls=h.id('export-local-save').parentElement.children;
  const importButton=controls.find(e=>e.id==='import-normal-save');
  const cancel=controls.find(e=>e.id==='cancel-normal-import');
  const input=controls.find(e=>e.id==='import-normal-file');
  importButton.click();
  assert.equal(cancel.hidden,false);
  cancel.dispatch('pointerdown',{pointerId:130});
  input.dispatch('cancel');
  assert.equal(cancel.hidden,true);
  importButton.click();
  assert.equal(cancel.hidden,false,'second chooser is pending');
  cancel.dispatch('click',{detail:1});
  assert.equal(cancel.hidden,false,'old cancel must not revoke second chooser');
  cancel.dispatch('pointerdown',{pointerId:131});
  cancel.dispatch('click',{detail:1});
  assert.equal(cancel.hidden,true,'fresh cancellation still works');
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65as pre-chooser producer touch cannot spend energy after file cancellation',async()=>{
  const h=await mount(),board=h.id('board');
  const controls=h.id('export-local-save').parentElement.children;
  const importer=controls.find(e=>e.id==='import-normal-save');
  const cancel=controls.find(e=>e.id==='cancel-normal-import');
  board.dispatch('pointerdown',{target:board.children[42],pointerId:201});
  importer.click();cancel.click();
  const before=h.writes.length,raw=h.storage.getItem(SAVE_KEY);
  board.dispatch('click',{target:board.children[42],detail:1});
  await settle();
  assert.equal(h.writes.length,before,'old producer click cannot spend energy');
  assert.equal(h.storage.getItem(SAVE_KEY),raw);
  board.dispatch('pointerdown',{target:board.children[42],pointerId:202});
  board.dispatch('click',{target:board.children[42],detail:1});
  await settle();
  assert.equal(h.saved().revision,1,'new touch still produces');
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65as BFCache return invalidates a pending producer tap',async()=>{
  const h=await mount(),board=h.id('board');
  board.dispatch('pointerdown',{target:board.children[42],pointerId:203});
  h.win.dispatch('pagehide');
  h.win.dispatch('pageshow',{persisted:true});
  const before=h.writes.length,raw=h.storage.getItem(SAVE_KEY);
  board.dispatch('click',{target:board.children[42],detail:1});
  await settle();
  assert.equal(h.writes.length,before,'old BFCache click cannot produce');
  assert.equal(h.storage.getItem(SAVE_KEY),raw);
  board.dispatch('pointerdown',{target:board.children[42],pointerId:204});
  board.dispatch('click',{target:board.children[42],detail:1});
  await settle();
  assert.equal(h.saved().revision,1,'fresh resumed tap works');
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65as pointer rejected during locked write cannot replay after it finishes',async()=>{
  const h=await mount(),board=h.id('board');
  h.win.pauseNextLock=true;
  board.dispatch('click',{target:board.children[42],detail:0});
  await settle();
  assert.equal(typeof h.win.releaseLock,'function');
  board.dispatch('pointerdown',{target:board.children[42],pointerId:205});
  h.win.releaseLock();await settle();
  assert.equal(h.saved().revision,1);
  const before=h.writes.length;
  board.dispatch('click',{target:board.children[42],detail:1});
  await settle();
  assert.equal(h.writes.length,before,'busy-era tap cannot cause second write');
  assert.equal(h.saved().revision,1);
  board.dispatch('pointerdown',{target:board.children[42],pointerId:206});
  board.dispatch('click',{target:board.children[42],detail:1});
  await settle();
  assert.equal(h.saved().revision,2,'new touch after save can produce');
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65as canceled producer pointer cannot turn into a compatibility click',async()=>{
  const h=await mount(),board=h.id('board');
  board.dispatch('pointerdown',{target:board.children[42],pointerId:207});
  board.dispatch('pointercancel',{target:board.children[42],pointerId:207});
  const before=h.writes.length;
  board.dispatch('click',{target:board.children[42],detail:1});
  await settle();
  assert.equal(h.writes.length,before,'canceled producer touch must not write');
  board.dispatch('pointerdown',{target:board.children[42],pointerId:208});
  board.dispatch('click',{target:board.children[42],detail:1});
  await settle();
  assert.equal(h.saved().revision,1);
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65ba actual normal page: full-board warehouse upgrade then selected storage is actionable',async()=>{
  const seed=createInitialState(Date.now());
  for(let i=0;i<seed.board.length;i++){
    if(!seed.board[i])seed.board[i]={id:'m'+seed.nextId++,kind:'material',chain:'tea',tier:6};
    else if(seed.board[i].kind==='material')seed.board[i].tier=6;
  }
  for(let i=0;i<seed.warehouse.capacity;i++)
    seed.warehouse.slots[i]={id:'m'+seed.nextId++,kind:'material',chain:'tea',tier:6};
  for(const order of seed.orders){order.chain='bakery';order.tier=2;}
  seed.coins=500;seed.xp=100;
  const h=await mount({initialRaw:JSON.stringify(seed)});
  const initialItemId=h.saved().board[0].id;
  h.id('board-guide').click();
  assert.match(h.id('guidance-message').textContent,/扩容/);
  assert.equal(h.id('warehouse-upgrade').disabled,false);
  h.id('warehouse-upgrade').click();
  await settle();
  assert.equal(h.saved().warehouse.capacity,6);
  assert.equal(h.saved().coins,450);
  h.id('board-guide').click();
  assert.match(h.id('guidance-message').textContent,/收入仓库/);
  const board=h.id('board');
  board.dispatch('click',{target:board.children[0],detail:0});
  assert.equal(h.id('store-selected').disabled,false);
  h.id('store-selected').click();
  await settle();
  assert.equal(h.saved().board[0],null);
  assert.equal(h.saved().warehouse.slots[4].id,initialItemId);
  assert.equal(h.saved().revision,2);
  assert.equal(h.id('board-guide').getAttribute('aria-pressed'),'false');
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});

test('P2.65cp empty native file change rotates chooser identity and blocks late events',async()=>{
  const h=await mount(),original=h.storage.getItem(SAVE_KEY),before=h.writes.length;
  const controls=h.id('export-local-save').parentElement.children;
  const button=controls.find(e=>e.id==='import-normal-save');
  const cancel=controls.find(e=>e.id==='cancel-normal-import');
  const old=controls.find(e=>e.id==='import-normal-file');
  button.click();
  assert.equal(cancel.hidden,false,'native chooser is awaiting selection');
  old.files=[];
  old.dispatch('change');await settle();
  const fresh=h.id('export-local-save').parentElement.children.find(e=>e.id==='import-normal-file');
  assert.notEqual(fresh,old,'empty change must rotate native input identity');
  assert.equal(old.parentElement,null,'old chooser input is detached');
  assert.equal(cancel.hidden,true,'empty selection must release the chooser UI');
  assert.equal(h.storage.getItem(SAVE_KEY),original);
  assert.equal(h.writes.length,before,'empty selection must never write');
  assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),null);
  button.click();
  const imported=JSON.stringify({...h.saved(),coins:129,revision:1});
  old.files=[{size:imported.length,text:async()=>imported}];
  old.dispatch('change');old.dispatch('cancel');await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),original,
    'late events from an empty old chooser cannot restore or cancel the new chooser');
  assert.equal(cancel.hidden,false,'fresh chooser remains active after stale events');
  fresh.files=[{size:imported.length,text:async()=>imported}];
  fresh.dispatch('change');await settle();
  assert.equal(h.storage.getItem(SAVE_KEY),imported,'new chooser remains usable');
  assert.equal(h.storage.getItem(RESTORE_BACKUP_KEY),original,
    'successful restore preserves the exact prior save');
  assert.equal(h.storage.getItem(STORY_SAVE_KEY),'story-not-touched');
});
