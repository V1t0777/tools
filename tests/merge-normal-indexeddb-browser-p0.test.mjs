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
function chromePath(){
  for(const name of [process.env.CHROME_BIN,'google-chrome','google-chrome-stable','chromium','chromium-browser'].filter(Boolean))
    if(spawnSync(name,['--version'],{encoding:'utf8'}).status===0)return name;
  return null;
}
async function until(predicate,label){
  for(let i=0;i<150;i++){
    if(await predicate())return;
    await sleep(90);
  }
  throw Error('TIMEOUT '+label);
}
function cdp(url){
  const ws=new WebSocket(url),pending=new Map();let next=0;
  const ready=new Promise((resolve,reject)=>{
    ws.addEventListener('open',resolve,{once:true});
    ws.addEventListener('error',reject,{once:true});
  });
  ws.addEventListener('message',ev=>{
    const data=JSON.parse(ev.data),p=pending.get(data.id);
    if(!p)return;
    pending.delete(data.id);clearTimeout(p.timer);
    if(data.error)p.reject(Error(JSON.stringify(data.error)));
    else p.resolve(data.result);
  });
  return {ready,close:()=>ws.close(),async call(method,params={},sessionId){
    await ready;
    return new Promise((resolve,reject)=>{
      const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},15000);
      pending.set(id,{resolve,reject,timer});
      ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
    });
  }};
}
test('P0 real Chromium normal V3 IndexedDB: multi-tab CAS, restore/reset backup and rollback',
  {timeout:140000},async t=>{
    const chrome=chromePath();
    assert.ok(chrome,'real Chromium is required');
    const tmp=await mkdtemp(join(tmpdir(),'yunyu-normal-idb-'));
    const server=createServer(async(req,res)=>{
      const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      if(name==='/__normal_idb_test__'){
        res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'})
          .end('<!doctype html><meta charset="utf-8">Normal IDB test');
        return;
      }
      const file=resolve(root,'.'+name);
      if(!file.startsWith(root+sep)){res.writeHead(403).end();return}
      try{const bytes=await readFile(file);
        res.writeHead(200,{'Content-Type':{
          '.html':'text/html','.mjs':'text/javascript','.js':'text/javascript',
          '.json':'application/json','.css':'text/css'
        }[extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
      }catch{res.writeHead(404).end('not found')}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const browser=spawn(chrome,['--headless=new','--no-sandbox','--disable-gpu',
      '--disable-dev-shm-usage','--disable-background-networking',
      '--no-proxy-server','--remote-debugging-port=0','--user-data-dir='+tmp,
      'about:blank'],{stdio:'ignore'});
    let client;
    t.after(async()=>{
      try{client?.close()}catch{}
      browser.kill('SIGKILL');
      await new Promise(resolve=>server.close(resolve));
      await rm(tmp,{recursive:true,force:true,maxRetries:3});
    });
    const portFile=join(tmp,'DevToolsActivePort');
    await until(()=>Promise.resolve(existsSync(portFile)),'Chromium port');
    const [port,path]=(await readFile(portFile,'utf8')).trim().split('\n');
    client=cdp('ws://127.0.0.1:'+port+path);
    await client.ready;
    const call=(method,params={},session)=>client.call(method,params,session);
    async function page(url='/__normal_idb_test__',noLocks=false,contextId=null){
      const {targetId}=await call('Target.createTarget',
        {url:'about:blank',...(contextId?{browserContextId:contextId}:{})});
      const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
      await call('Page.enable',{},sessionId);
      await call('Runtime.enable',{},sessionId);
      if(noLocks)await call('Page.addScriptToEvaluateOnNewDocument',{
        source:"Object.defineProperty(navigator,'locks',{value:undefined,configurable:true});"+
          "window.__normalErrors=[];window.addEventListener('error',e=>window.__normalErrors.push(e.message));"
      },sessionId);
      await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+url},sessionId);
      await until(async()=>{const r=await call('Runtime.evaluate',
        {expression:"document.readyState==='complete'",returnByValue:true},sessionId);
        return r.result.value===true},'page ready');
      return {sessionId,async evaluate(fn,...args){
        const expression='('+fn.toString()+')('+args.map(JSON.stringify).join(',')+')';
        const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true},sessionId);
        if(result.exceptionDetails)throw Error('Browser '+JSON.stringify(result.exceptionDetails));
        return result.result.value;
      }};
    }
    const a=await page(),b=await page();
    const key='toolbox.merge-isle.local.v1';
    const seed=await a.evaluate(async key=>{
      const {createInitialState}=await import('/merge/engine.mjs');
      const raw=JSON.stringify(createInitialState(1000000));
      localStorage.setItem(key,raw);return raw;
    },key);
    const open=async p=>p.evaluate(async()=>{
      const {openNormalPersistence}=await import('/merge/normal-indexeddb-persistence.mjs');
      window.__normal=await openNormalPersistence({
        legacyStorage:localStorage,nativeLocks:null,indexedDB,Channel:BroadcastChannel
      });
      return {backend:window.__normal.backend,
        value:window.__normal.storage.getItem('toolbox.merge-isle.local.v1'),
        original:localStorage.getItem('toolbox.merge-isle.local.v1')};
    });
    const aInfo=await open(a),bInfo=await open(b);
    assert.equal(aInfo.backend,'indexeddb');assert.equal(bInfo.backend,'indexeddb');
    assert.equal(aInfo.value,seed);assert.equal(bInfo.value,seed);
    const apply=(p,expected)=>p.evaluate(async raw=>{
      const {commitNormalActionWithLock}=await import('/merge/normal-action-transaction.mjs');
      const {produce}=await import('/merge/engine.mjs');
      return await commitNormalActionWithLock(window.__normal.locks,window.__normal.storage,{
        expectedRaw:raw,action:state=>produce(state,42,1000000,()=>0.9)
      });
    },expected);
    const both=await Promise.all([apply(a,seed),apply(b,seed)]);
    assert.equal(both.filter(r=>r.ok===true).length,1,
      'different tabs cannot spend two energy from one stale baseline');
    const committed=both.find(r=>r.ok===true);
    assert.equal(committed.state.revision,1);
    assert.equal(committed.state.energy,119);
    const c=await page();
    const observed=await open(c);
    assert.equal(observed.value,committed.raw,'authoritative IDB state persists');
    assert.equal(observed.original,seed,'original localStorage remains unchanged');
    const abort=await c.evaluate(async()=>{
      const p=window.__normal,key='toolbox.merge-isle.local.v1';
      try{
        await p.locks.runNormalTransaction(()=>{
          p.storage.setItem(key,'bad-state');
          p.storage.setItem(key+'.restore-backup-v3','bad-backup');
          throw Error('forced abort');
        });
      }catch{}
      return true;
    });
    assert.equal(abort,true);
    const d=await page(),dInfo=await open(d);
    assert.equal(dInfo.value,committed.raw,'aborted transaction must not change save');
    assert.equal(await d.evaluate(()=>window.__normal.storage.getItem(
      'toolbox.merge-isle.local.v1.restore-backup-v3')),null);
    const restored=await d.evaluate(async(candidate,expected)=>{
      const {coordinateNormalSaveRestore}=await import('/merge/save-restore-lock.mjs');
      return coordinateNormalSaveRestore(candidate,window.__normal.storage,
        window.__normal.locks,{expectedRaw:expected,confirmed:true,allowDowngrade:true});
    },seed,committed.raw);
    assert.equal(restored.ok,true,'restore writes original and backup atomically');
    assert.equal(await d.evaluate(()=>window.__normal.storage.getItem(
      'toolbox.merge-isle.local.v1.restore-backup-v3')),committed.raw);
    const reset=await d.evaluate(async expected=>{
      const {commitNormalResetWithLock}=await import('/merge/normal-reset-transaction.mjs');
      return commitNormalResetWithLock(window.__normal.locks,window.__normal.storage,
        {expectedRaw:expected,confirmedReset:true,requireOriginalBackup:true,now:1000000});
    },seed);
    assert.equal(reset.ok,true);
    assert.equal(await d.evaluate(()=>window.__normal.storage.getItem(
      'toolbox.merge-isle.local.v1.abnormal-reset-backup-v3')),seed);
    assert.equal(JSON.parse(reset.raw).revision,0);
    // A browser without navigator.locks must keep the ACTUAL normal UI writable.
    const {browserContextId}=await call('Target.createBrowserContext',{});
    const ui=await page('/merge/index.html',true,browserContextId);
    await until(()=>ui.evaluate(()=>document.getElementById('save-status')?.textContent
      .includes('已保存于此浏览器')&&!!document.querySelector('#board .producer')),
      'normal UI writable on genuine IndexedDB without Web Locks');
    const before=await ui.evaluate(async()=>{
      const open=indexedDB.open('yunyu-normal-offline-v1',1);
      const db=await new Promise((resolve,reject)=>{
        open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);
      });
      try{return await new Promise((resolve,reject)=>{
        const tx=db.transaction('normal-records','readonly'),
          req=tx.objectStore('normal-records').get('toolbox.merge-isle.local.v1');
        req.onsuccess=()=>resolve(JSON.parse(req.result));
        req.onerror=()=>reject(req.error);
      });}finally{db.close()}
    });
    assert.equal(before.revision,0);
    const uiClicked=await ui.evaluate(()=>{
      const p=document.querySelector('#board .producer');
      if(p.disabled)return false;p.click();return true;
    });
    assert.equal(uiClicked,true);
    await until(()=>ui.evaluate(async()=>{
      const open=indexedDB.open('yunyu-normal-offline-v1',1);
      const db=await new Promise((resolve,reject)=>{
        open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);
      });
      try{return await new Promise((resolve,reject)=>{
        const tx=db.transaction('normal-records','readonly'),
          req=tx.objectStore('normal-records').get('toolbox.merge-isle.local.v1');
        req.onsuccess=()=>resolve(JSON.parse(req.result)?.revision===1);
        req.onerror=()=>reject(req.error);
      })}finally{db.close()}
    }), 'real normal UI action persists without Web Locks');
    assert.equal(await ui.evaluate(()=>localStorage.getItem('toolbox.merge-isle.local.v1')),null);
    await call('Target.disposeBrowserContext',{browserContextId});
    // Post-migration old-tab writes must invalidate the IDB backend.
    await d.evaluate(key=>localStorage.setItem(key,'old-tab-changed'),key);
    const blocked=await d.evaluate(async()=>{
      const p=window.__normal;
      return await p.locks.runNormalTransaction(()=>({ok:true}));
    });
    assert.equal(blocked.ok,false);
    const e=await page();
    assert.equal((await open(e)).backend,'read-only',
      'never re-import an old-tab overwrite into the authoritative IDB');
  });
