import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, readdir, mkdtemp, rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawn, spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join, resolve, extname, sep} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';

const root=resolve(new URL('..',import.meta.url).pathname);
const key='toolbox.merge-isle.local.v1';
const lock='toolbox.merge-isle.normal-save.write-v1';
const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.png':'image/png'};
function chromePath(){
  for(const name of [process.env.CHROME_BIN,'google-chrome','google-chrome-stable','chromium','chromium-browser'].filter(Boolean)){
    const r=spawnSync(name,['--version'],{encoding:'utf8'});
    if(r.status===0)return name;
  }
  return null;
}
async function until(check,label,limit=12000){
  const end=Date.now()+limit;
  while(Date.now()<end){
    try{const value=await check();if(value)return value;}catch{}
    await sleep(70);
  }
  throw Error('TIMEOUT: '+label);
}
function cdp(url){
  const ws=new WebSocket(url),pending=new Map();let serial=0;
  ws.addEventListener('message',event=>{
    const data=JSON.parse(event.data);
    if(!data.id)return;
    const item=pending.get(data.id);if(!item)return;
    pending.delete(data.id);clearTimeout(item.timer);
    if(data.error)item.reject(Error(JSON.stringify(data.error)));
    else item.resolve(data.result);
  });
  const ready=new Promise((resolve,reject)=>{
    ws.addEventListener('open',resolve,{once:true});
    ws.addEventListener('error',reject,{once:true});
  });
  return {ready,close:()=>ws.close(),async call(method,params={},sessionId){
    await ready;
    return new Promise((resolve,reject)=>{
      const id=++serial;
      const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},10000);
      pending.set(id,{resolve,reject,timer});
      ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
    });
  }};
}

test('P0 real Chromium: two tabs, Web Locks, BFCache navigation and save download', {timeout:85000}, async t=>{
  const chrome=chromePath();
  assert.ok(chrome,'Real Chromium/Chrome is required; DOM mocks cannot pass this gate');
  const temp=await mkdtemp(join(tmpdir(),'merge-browser-'));
  const server=createServer(async(req,res)=>{
    const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file=resolve(root,'.'+path);
    if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
    try{
      const bytes=await readFile(file);
      res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
    }catch{res.writeHead(404).end('not found');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const browser=spawn(chrome,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--disable-background-networking','--no-proxy-server','--remote-debugging-port=0',`--user-data-dir=${temp}`, 'about:blank'],{stdio:'ignore'});
  let client;
  t.after(async()=>{
    try{client?.close();}catch{}
    browser.kill('SIGKILL');
    await new Promise(resolve=>server.close(resolve));
    await rm(temp,{recursive:true,force:true,maxRetries:3});
  });
  const portFile=join(temp,'DevToolsActivePort');
  await until(()=>existsSync(portFile),'Chrome debugging port');
  const [port,wsPath]=(await readFile(portFile,'utf8')).trim().split('\n');
  client=cdp(`ws://127.0.0.1:${port}${wsPath}`);
  await client.ready;
  const call=(method,params={},session)=>client.call(method,params,session);
  async function page(){
    const {targetId}=await call('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
    await call('Page.enable',{},sessionId);
    await call('Runtime.enable',{},sessionId);
    return {targetId,sessionId};
  }
  async function evalOn(p,expression){
    const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true},p.sessionId);
    if(result.exceptionDetails)throw Error('Browser JS: '+JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  const front=async p=>{await call('Target.activateTarget',{targetId:p.targetId});await call('Page.bringToFront',{},p.sessionId);};
  async function navigate(p,url){
    await call('Page.navigate',{url},p.sessionId);
    await until(async()=>await evalOn(p,`document.readyState==='complete'&&!!document.getElementById('save-status')`),'page loaded');
    await until(async()=>String(await evalOn(p,`document.getElementById('save-status').textContent`)).includes('已保存于此浏览器')||String(await evalOn(p,`document.getElementById('save-status').textContent`)).includes('已同步其他标签页'),'verified startup');
  }
  const a=await page();await front(a);await navigate(a,base+'/merge/index.html');
  const b=await page();await front(b);await navigate(b,base+'/merge/index.html');
  const readSave=p=>evalOn(p,`JSON.parse(localStorage.getItem(${JSON.stringify(key)}))`);
  const before=await readSave(b);
  assert.equal(before.revision,0);
  await evalOn(b,`document.querySelector('#board .producer').click();true`);
  await until(async()=> (await readSave(b)).revision===1,'tab B producer persisted');
  const after=await readSave(b);
  assert.equal(after.energy,before.energy-1);
  await front(a);
  await until(async()=>await evalOn(a,`document.querySelector('#energy').textContent.startsWith(${JSON.stringify(String(after.energy)+' /')})`),'tab A adopted tab B snapshot');
  assert.equal((await readSave(a)).revision,after.revision);

  // Hold the exact production lock in B, then reject A's concurrent action.
  await evalOn(b,`window.__holdPromise=navigator.locks.request(${JSON.stringify(lock)},()=>new Promise(resolve=>window.__releaseHold=resolve));true`);
  await until(async()=>evalOn(b,'typeof window.__releaseHold === "function"'),'B acquired Web Lock');
  await front(a);
  await evalOn(a,`document.querySelector('#board .producer').click();true`);
  await sleep(300);
  assert.equal((await readSave(a)).revision,after.revision,'busy lock must not write');
  await evalOn(b,'window.__releaseHold();true');
  await sleep(200);
  await front(a);
  await evalOn(a,`document.querySelector('#board .producer').click();true`);
  await until(async()=>(await readSave(a)).revision===after.revision+1,'new action after lock release');

  // A real browser navigation exercises pagehide and restoration. Chrome may
  // elect not to use BFCache; persisted===true is reported, not assumed.
  await evalOn(a,`window.addEventListener('pagehide',()=>sessionStorage.setItem('merge-pagehide','1'));window.addEventListener('pageshow',e=>sessionStorage.setItem('merge-bfcache',String(e.persisted)));true`);
  await call('Page.navigate',{url:base+'/merge/absent-test-page'},a.sessionId);
  await until(async()=>await evalOn(a,`document.readyState==='complete'&&location.pathname.includes('absent-test-page')`),'away navigation');
  const history=await call('Page.getNavigationHistory',{},a.sessionId);
  await call('Page.navigateToHistoryEntry',{entryId:history.entries[history.currentIndex-1].id},a.sessionId);
  await until(async()=>await evalOn(a,`location.pathname==='/merge/index.html'&&!!document.getElementById('save-status')`),'history restoration');
  await until(async()=>await evalOn(a,`document.querySelector('#save-status').textContent.includes('已保存')||document.querySelector('#save-status').textContent.includes('已同步')`),'verified after history');
  const bfcache=await evalOn(a,`sessionStorage.getItem('merge-bfcache')`);
  assert.equal(bfcache,'true','This gate requires a genuine pageshow.persisted BFCache restoration');
  assert.equal((await readSave(a)).revision,after.revision+1);

  await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:temp});
  await front(a);
  await evalOn(a,`document.getElementById('export-local-save').click();true`);
  const file=await until(async()=>{
    const names=await readdir(temp);
    return names.find(name=>name.endsWith('.json')||name.endsWith('.txt'));
  },'real Chromium download');
  const downloaded=await readFile(join(temp,file),'utf8');
  assert.ok(downloaded.includes('schemaVersion')||downloaded.includes('revision'),'downloaded save must contain real state');
  const savedSnapshot=await readSave(a);
  assert.deepEqual(JSON.parse(downloaded),savedSnapshot,'download must match the exact reviewed game state');

  // Real browser storage/lock/UI path: reset from B, adopt it in A, then
  // restore the downloaded JSON in B and verify its before-restore backup.
  // Only the OS file chooser and confirmation are test-injected; File.text(),
  // Web Locks, localStorage, the page runtime and both tabs remain native.
  await front(b);
  await evalOn(b,`window.confirm=()=>true;document.getElementById('reset').click();true`);
  await until(async()=>{
    const current=await readSave(b);
    return current.revision===0&&current.energy>savedSnapshot.energy;
  },'confirmed reset persisted');
  const resetRaw=await evalOn(b,`localStorage.getItem(${JSON.stringify(key)})`);
  const resetSnapshot=JSON.parse(resetRaw);
  assert.notDeepEqual(resetSnapshot,savedSnapshot,'reset must not retain the prior progress');
  await front(a);
  await until(async()=>await evalOn(a,`document.querySelector('#energy').textContent.startsWith(${JSON.stringify(String(resetSnapshot.energy)+' /')})`),'other tab adopted reset');
  await front(b);
  await evalOn(b,`(()=>{
    const chooser=document.getElementById('import-normal-file');
    chooser.click=()=>{}; // suppress OS dialog only; exercise native File read
    document.getElementById('import-normal-save').click();
    const transfer=new DataTransfer();
    transfer.items.add(new File([${JSON.stringify(downloaded)}],'yunyu-normal-save-v3.json',{type:'application/json'}));
    chooser.files=transfer.files;
    chooser.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`);
  await until(async()=>{
    const current=await readSave(b);
    return current.revision===savedSnapshot.revision&&current.energy===savedSnapshot.energy;
  },'downloaded save restored after reset');
  assert.deepEqual(await readSave(b),savedSnapshot,'restored state must match downloaded JSON');
  const backup=await evalOn(b,`localStorage.getItem(${JSON.stringify(key+'.restore-backup-v3')})`);
  assert.equal(backup,resetRaw,'restore must preserve the exact pre-restore reset bytes');
  await front(a);
  await until(async()=>await evalOn(a,`document.querySelector('#energy').textContent.startsWith(${JSON.stringify(String(savedSnapshot.energy)+' /')})`),'other tab adopted restored save');
  t.diagnostic(`Chromium two-tab lock, BFCache persisted=${bfcache}, download=${file}, reset/import/backup verified`);
});
