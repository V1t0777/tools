import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve,extname,sep} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';

const root=resolve(new URL('..',import.meta.url).pathname);
const KEY='toolbox.merge-isle.local.v1';
const STORY='toolbox.merge-isle.story.local.v1';
const BACKUP=KEY+'.restore-backup-v3';
const ABNORMAL=KEY+'.abnormal-reset-backup-v3';
const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'};
function chromePath(){
  for(const name of [process.env.CHROME_BIN,'google-chrome','chromium','chromium-browser'].filter(Boolean)){
    if(spawnSync(name,['--version'],{encoding:'utf8'}).status===0)return name;
  }
  return null;
}
async function until(fn,label,ms=12000){
  const end=Date.now()+ms;
  while(Date.now()<end){try{const result=await fn();if(result)return result;}catch{}await sleep(70);}
  throw Error('TIMEOUT: '+label);
}
function cdp(url){
  const ws=new WebSocket(url),pending=new Map();let serial=0;
  const ready=new Promise((resolve,reject)=>{
    ws.addEventListener('open',resolve,{once:true});
    ws.addEventListener('error',reject,{once:true});
  });
  ws.addEventListener('message',event=>{
    const data=JSON.parse(event.data),p=pending.get(data.id);
    if(!p)return;
    pending.delete(data.id);clearTimeout(p.timer);
    if(data.error)p.reject(Error(JSON.stringify(data.error)));
    else p.resolve(data.result);
  });
  return {ready,close:()=>ws.close(),async call(method,params={},sessionId){
    await ready;
    return new Promise((resolve,reject)=>{
      const id=++serial;
      const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},12000);
      pending.set(id,{resolve,reject,timer});
      ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
    });
  }};
}
test('P0 real Chromium deadlock rescue: consent, stale selection, BFCache and one-item conservation',
  {timeout:95000},async t=>{
  const chrome=chromePath();
  assert.ok(chrome,'Real Chromium is required; never replace this gate with DOM mocks');
  const temp=await mkdtemp(join(tmpdir(),'merge-rescue-'));
  const server=createServer(async(req,res)=>{
    const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file=resolve(root,'.'+path);
    if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
    try{const bytes=await readFile(file);
      res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream',
        'Cache-Control':'no-store'}).end(bytes);}
    catch{res.writeHead(404).end('not found');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const browser=spawn(chrome,['--headless=new','--no-sandbox','--disable-gpu',
    '--disable-dev-shm-usage','--no-first-run','--disable-background-networking',
    '--no-proxy-server','--remote-debugging-port=0','--user-data-dir='+temp,
    'about:blank'],{stdio:'ignore'});
  let client;
  t.after(async()=>{
    try{client?.close();}catch{}
    browser.kill('SIGKILL');
    await new Promise(resolve=>server.close(resolve));
    await rm(temp,{recursive:true,force:true,maxRetries:3});
  });
  const portFile=join(temp,'DevToolsActivePort');
  await until(()=>existsSync(portFile),'Chrome debugging port',20000);
  const [port,wsPath]=(await readFile(portFile,'utf8')).trim().split('\n');
  client=cdp('ws://127.0.0.1:'+port+wsPath);
  await client.ready;
  const call=(method,params={},session)=>client.call(method,params,session);
  const {targetId}=await call('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
  await call('Page.enable',{},sessionId);
  await call('Runtime.enable',{},sessionId);
  const front=async()=>{
    await call('Target.activateTarget',{targetId});
    await call('Page.bringToFront',{},sessionId);
  };
  await front();
  async function evaluate(expression){
    const result=await call('Runtime.evaluate',
      {expression,returnByValue:true,awaitPromise:true,userGesture:true},sessionId);
    if(result.exceptionDetails)throw Error('Browser JS: '+JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  const raw=()=>evaluate('localStorage.getItem('+JSON.stringify(KEY)+')');
  const save=async()=>JSON.parse(await raw());
  const ready=()=>until(()=>evaluate(
    "document.readyState==='complete' && document.getElementById('save-status')?.textContent.includes('已保存于此浏览器') && document.querySelectorAll('#board .cell').length===56"),
    'verified ordinary page');
  await call('Page.navigate',{url:base+'/merge/index.html'},sessionId);
  await ready();
  // A schema-valid hostile board is enough for browser UI coverage; the
  // separate legal-action witness test proves this class is player-reachable.
  async function seed(){
    const result=await evaluate("(async()=>{"+
      "const {createInitialState,MAX_TIER,validateSave}=await import('/merge/engine.mjs');"+
      "const s=createInitialState(Date.now());"+
      "for(let i=0;i<s.board.length;i++)if(s.board[i]?.kind!=='producer')"+
      "s.board[i]={id:'m'+s.nextId++,kind:'material',chain:'tea',tier:MAX_TIER};"+
      "for(let i=0;i<s.warehouse.capacity;i++)"+
      "s.warehouse.slots[i]={id:'m'+s.nextId++,kind:'material',chain:'tea',tier:MAX_TIER};"+
      "if(!validateSave(s))throw Error('invalid fixture');"+
      "localStorage.setItem("+JSON.stringify(KEY)+",JSON.stringify(s));"+
      "localStorage.setItem("+JSON.stringify(STORY)+",'story-unchanged');"+
      "localStorage.setItem("+JSON.stringify(BACKUP)+",'backup-unchanged');"+
      "localStorage.setItem("+JSON.stringify(ABNORMAL)+",'abnormal-unchanged');"+
      "return {revision:s.revision,coins:s.coins,xp:s.xp};})()");
    await evaluate('window.__rescueReloadSentinel=true;true');
    await call('Page.reload',{},sessionId);
    await until(()=>evaluate('window.__rescueReloadSentinel===undefined'),
      'fresh document after fixture reload');
    await ready();
    assert.equal((await save()).revision,result.revision);
    assert.equal(await evaluate("document.getElementById('deadlock-discard').disabled"),true);
  }
  const select=slot=>evaluate("document.querySelector('#board [data-slot=\""+slot+"\"]').click();true");
  const pointer=id=>evaluate("document.getElementById('"+id+"').dispatchEvent("+
    "new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch',isPrimary:true}));true");
  const clickTouch=id=>evaluate("document.getElementById('"+id+"').dispatchEvent("+
    "new MouseEvent('click',{bubbles:true,detail:1}));true");
  const checkOthers=async()=>{
    assert.equal(await evaluate('localStorage.getItem('+JSON.stringify(STORY)+')'),'story-unchanged');
    assert.equal(await evaluate('localStorage.getItem('+JSON.stringify(BACKUP)+')'),'backup-unchanged');
    assert.equal(await evaluate('localStorage.getItem('+JSON.stringify(ABNORMAL)+')'),'abnormal-unchanged');
  };

  await seed();
  await select(2);
  assert.equal(await evaluate("document.getElementById('deadlock-discard').disabled"),false);
  const before=await save(),original=await raw();
  await evaluate("window.__rescueConfirmCount=0;window.confirm=()=>{window.__rescueConfirmCount++;return false;};"+
    "document.getElementById('deadlock-discard').click();true");
  assert.equal(await evaluate('window.__rescueConfirmCount'),1);
  assert.equal(await raw(),original,'declined rescue cannot mutate exact save bytes');
  await evaluate("window.confirm=()=>{window.__rescueConfirmCount++;return true;};"+
    "document.getElementById('deadlock-discard').click();true");
  await until(async()=>(await save()).revision===before.revision+1,'confirmed rescue write');
  const after=await save();
  assert.equal(after.board[2],null);
  assert.equal(after.board.filter(Boolean).length,55);
  assert.equal(after.coins,before.coins);
  assert.equal(after.xp,before.xp);
  assert.equal(after.energy,before.energy);
  assert.deepEqual(after.orders,before.orders);
  assert.deepEqual(after.warehouse,before.warehouse);
  assert.equal(await evaluate("document.getElementById('deadlock-discard').disabled"),true);
  await clickTouch('deadlock-discard');
  assert.equal((await save()).revision,after.revision,'repeated disabled click must not write');
  await checkOthers();
  t.diagnostic('Chromium rescue: declined consent preserved bytes; accepted consent discarded exactly one material');

  await seed();
  await select(2);
  const staleRaw=await raw();
  await evaluate("window.__rescueConfirmCount=0;window.confirm=()=>{window.__rescueConfirmCount++;return true;};true");
  await pointer('deadlock-discard');
  await select(2); // deselect, invalidating persistent button render lease
  await select(5); // select a different material, no storage mutation
  assert.equal(await evaluate("document.getElementById('deadlock-discard').disabled"),false);
  await clickTouch('deadlock-discard');
  assert.equal(await evaluate('window.__rescueConfirmCount'),0);
  assert.equal(await raw(),staleRaw,'stale selection touch cannot sacrifice another item');
  await pointer('deadlock-discard');
  await clickTouch('deadlock-discard');
  await until(async()=>(await save()).revision===1,'fresh touch after selection change');
  assert.equal((await save()).board[5],null);
  assert.equal((await save()).board[2]?.kind,'material');
  await checkOthers();
  t.diagnostic('Chromium rescue: old selection pointer rejected, fresh pointer removed only reviewed material');

  await seed();
  await select(2);
  const bfcacheRaw=await raw();
  await evaluate("window.__rescueConfirmCount=0;window.confirm=()=>{window.__rescueConfirmCount++;return true;};"+
    "window.addEventListener('pageshow',e=>sessionStorage.setItem('rescue-bfcache',String(e.persisted)));true");
  await pointer('deadlock-discard');
  await call('Page.navigate',{url:base+'/merge/absent-test-page'},sessionId);
  await until(()=>evaluate("location.pathname.includes('absent-test-page')"),'navigate away');
  const history=await call('Page.getNavigationHistory',{},sessionId);
  await call('Page.navigateToHistoryEntry',
    {entryId:history.entries[history.currentIndex-1].id},sessionId);
  await front();
  await until(()=>evaluate("location.pathname==='/merge/index.html' && !!document.getElementById('deadlock-discard')"),
    'history restore');
  await ready();
  assert.equal(await evaluate("sessionStorage.getItem('rescue-bfcache')"),'true',
    'BFCache gate requires actual pageshow.persisted, not a synthetic event');
  assert.equal(await evaluate("document.querySelector('#board .cell.selected')===null"),true,
    'BFCache must not retain a visibly selected material after revoking its intent');
  assert.equal(await evaluate("document.getElementById('deadlock-discard').disabled"),true,
    'BFCache must disable persistent rescue control when selection is revoked');
  // Page lifecycle intentionally clears the selection. Re-select the same
  // material so the persistent button is enabled when the OLD touch arrives.
  // This proves pointer lease invalidation rather than merely disabled UI.
  if(!await evaluate("document.querySelector('#board [data-slot=\"2\"]').classList.contains('selected')"))
    await select(2);
  assert.equal(await evaluate("document.getElementById('deadlock-discard').disabled"),false);
  await clickTouch('deadlock-discard');
  assert.equal(await evaluate('window.__rescueConfirmCount'),0);
  assert.equal(await raw(),bfcacheRaw,'pre-pagehide pointer cannot rescue after BFCache');
  await pointer('deadlock-discard');
  await clickTouch('deadlock-discard');
  const immediate=await evaluate("(()=>({confirms:window.__rescueConfirmCount,"+
    "notice:document.getElementById('notice').textContent,"+
    "status:document.getElementById('save-status').textContent}))()");
  t.diagnostic('BFCache fresh rescue immediate state: '+JSON.stringify(immediate));
  try{await until(async()=>(await save()).revision===1,'fresh post-BFCache rescue');}
  catch(error){
    const snapshot=await evaluate("(()=>({confirms:window.__rescueConfirmCount,"+
      "status:document.getElementById('save-status').textContent,"+
      "notice:document.getElementById('notice').textContent,"+
      "disabled:document.getElementById('deadlock-discard').disabled,"+
      "selected:document.querySelector('#board .cell.selected')?.dataset.slot,"+
      "revision:JSON.parse(localStorage.getItem('toolbox.merge-isle.local.v1')).revision,"+
      "hidden:document.hidden}))()");
    t.diagnostic('BFCache rescue failure-only snapshot: '+JSON.stringify(snapshot));
    throw error;
  }
  assert.equal((await save()).board[2],null);
  await checkOthers();
  t.diagnostic('Chromium genuine BFCache invalidated old rescue touch and accepted fresh confirmed rescue');
});