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
test('P0 genuine IndexedDB transactions: migration, cross-tab CAS, durable reload, atomic abort, legacy fence',
  {timeout:140000},async t=>{
    const chrome=chromePath();
    assert.ok(chrome,'real Chromium required for IndexedDB transaction gate');
    const tmp=await mkdtemp(join(tmpdir(),'yunyu-idb-story-'));
    const server=createServer(async(req,res)=>{
      const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      if(name==='/__story_idb_test__'){
        res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'}).end('<!doctype html><meta charset="utf-8"><title>IDB story test</title>');
        return;
      }
      const file=resolve(root,'.'+name);
      if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
      try{
        const bytes=await readFile(file);
        res.writeHead(200,{'Content-Type':{'.mjs':'text/javascript','.js':'text/javascript','.json':'application/json'}[extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
      }catch{res.writeHead(404).end('not found');}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const browser=spawn(chrome,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
      '--disable-background-networking','--no-proxy-server','--remote-debugging-port=0','--user-data-dir='+tmp,'about:blank'],{stdio:'ignore'});
    let client;
    t.after(async()=>{
      try{client?.close();}catch{}
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
    async function page(){
      const {targetId}=await call('Target.createTarget',{url:'about:blank'});
      const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
      await call('Page.enable',{},sessionId);
      await call('Runtime.enable',{},sessionId);
      await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/__story_idb_test__'},sessionId);
      await until(async()=>{
        const r=await call('Runtime.evaluate',{expression:"document.readyState==='complete'",returnByValue:true},sessionId);
        return r.result.value===true;
      },'page load');
      return {async evaluate(fn,...args){
        const expression='('+fn.toString()+')('+args.map(JSON.stringify).join(',')+')';
        const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);
        if(r.exceptionDetails)throw Error('Browser '+JSON.stringify(r.exceptionDetails));
        return r.result.value;
      }};
    }
    const A=await page(),B=await page();
    const baseline='{"revision":9,"chapter":"legacy"}';
    const savedKey='toolbox.merge-isle.story.local.v1';
    const shopKey='toolbox.merge-isle.story.workshop.local.v1';
    await A.evaluate((key,original)=>localStorage.setItem(key,original),savedKey,baseline);
    const initialize=async P=>P.evaluate(async()=>{
      const m=await import('/merge/story/indexeddb-persistence.mjs');
      window.__backend=await m.openStoryPersistence({
        legacyStorage:localStorage,nativeLocks:null,indexedDB,Channel:BroadcastChannel
      });
      return {backend:window.__backend.backend,story:window.__backend.storage.getItem('toolbox.merge-isle.story.local.v1'),
        original:localStorage.getItem('toolbox.merge-isle.story.local.v1'),
        marker:localStorage.getItem(m.STORY_IDB_MARKER)};
    });
    const initA=await initialize(A),initB=await initialize(B);
    assert.equal(initA.backend,'indexeddb');assert.equal(initB.backend,'indexeddb');
    assert.equal(initA.story,baseline);assert.equal(initB.story,baseline);
    assert.equal(initA.original,baseline);assert.equal(initA.marker,'indexeddb-v1');
    const commit=(page,expected,value)=>page.evaluate(async(expectedRaw,next)=>{
      const p=window.__backend,key='toolbox.merge-isle.story.local.v1',name='toolbox.merge-isle.story.write.'+key;
      try{return await p.locks.request(name,{mode:'exclusive'},()=>{
        if(p.storage.getItem(key)!==expectedRaw)return false;
        p.storage.setItem(key,next);return true;
      });}catch{return false;}
    },expected,value);
    const results=await Promise.all([commit(A,baseline,'new-left'),commit(B,baseline,'new-right')]);
    assert.equal(results.filter(Boolean).length,1,'only one stale-baseline writer commits');
    const winner=results[0]?'new-left':'new-right';
    const C=await page(),initC=await initialize(C);
    assert.equal(initC.story,winner,'authoritative IDB value survives new page');
    assert.equal(initC.original,baseline,'legacy raw bytes are untouched');
    const aborted=await C.evaluate(async()=>{
      const p=window.__backend,key='toolbox.merge-isle.story.local.v1',shop='toolbox.merge-isle.story.workshop.local.v1';
      try{await p.locks.request('toolbox.merge-isle.story.write.'+key,{mode:'exclusive'},()=>{
        p.storage.setItem(key,'must-rollback');
        p.storage.setItem(shop,'must-rollback');
        throw Error('forced abort');
      });}catch{return true;}
      return false;
    });
    assert.equal(aborted,true);
    const D=await page(),initD=await initialize(D);
    assert.equal(initD.story,winner,'failed multi-key transaction rolled back');
    assert.equal(await D.evaluate(()=>window.__backend.storage.getItem('toolbox.merge-isle.story.workshop.local.v1')),null);
    await D.evaluate((key)=>localStorage.setItem(key,'legacy-tab-changed'),savedKey);
    assert.equal(await D.evaluate(async()=>{
      const p=window.__backend,key='toolbox.merge-isle.story.local.v1';
      try{await p.locks.request('toolbox.merge-isle.story.write.'+key,{mode:'exclusive'},()=>{
        p.storage.setItem(key,'unsafe');return true;
      });return false;}catch{return true;}
    }),true,'legacy write after migration blocks IDB writes');
    const E=await page();
    assert.equal((await initialize(E)).backend,'read-only','old-version legacy mutation must never import stale data over IndexedDB');
  });
