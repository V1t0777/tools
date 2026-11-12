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
test('P0 genuine IndexedDB cloud queue: no Web Locks two tabs, ACK loss and legacy fence',
  {timeout:140000},async t=>{
  const chrome=chromePath();assert.ok(chrome,'real Chromium required');
  const {createInMemoryAuthority}=await import('../merge/cloud/authority.mjs');
  const uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const backend=createInMemoryAuthority({clock:()=>1000000,rng:()=>0.9});
  let loseAck=false,commands=0;
  const tmp=await mkdtemp(join(tmpdir(),'yunyu-idb-cloud-'));
  const server=createServer(async(req,res)=>{
    const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(name==='/__cloud_idb_test__'){
      res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><meta charset="utf-8">');
      return;
    }
    if(name==='/__mock_cloud__'){
      let raw='';for await(const chunk of req)raw+=chunk;
      const command=JSON.parse(raw);
      let result;
      if(command.mode==='read')result=await backend.read(uid);
      else if(command.mode==='command'){
        commands++;result=await backend.execute(uid,command.command);
      }else{res.writeHead(400).end();return}
      if(loseAck&&command.mode==='command'){
        loseAck=false;res.writeHead(503).end('ack lost');return;
      }
      res.writeHead(result.status==='conflict'?409:200,
        {'Content-Type':'application/json'}).end(JSON.stringify(result));
      return;
    }
    const file=resolve(root,'.'+name);
    if(!file.startsWith(root+sep)){res.writeHead(403).end();return}
    try{
      const bytes=await readFile(file);
      res.writeHead(200,{'Content-Type':{
        '.html':'text/html','.mjs':'text/javascript','.js':'text/javascript',
        '.json':'application/json'
      }[extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
    }catch{res.writeHead(404).end()}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=spawn(chrome,['--headless=new','--no-sandbox','--disable-gpu',
    '--disable-dev-shm-usage','--disable-background-networking','--no-proxy-server',
    '--remote-debugging-port=0','--user-data-dir='+tmp,'about:blank'],{stdio:'ignore'});
  let cdpClient;
  t.after(async()=>{
    try{cdpClient?.close()}catch{}
    browser.kill('SIGKILL');await new Promise(done=>server.close(done));
    await rm(tmp,{recursive:true,force:true,maxRetries:3});
  });
  const portFile=join(tmp,'DevToolsActivePort');
  await until(()=>Promise.resolve(existsSync(portFile)),'Chromium startup');
  const [port,path]=(await readFile(portFile,'utf8')).trim().split('\n');
  cdpClient=cdp('ws://127.0.0.1:'+port+path);await cdpClient.ready;
  const call=(method,params={},session)=>cdpClient.call(method,params,session);
  async function page(){
    const {targetId}=await call('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
    await call('Page.enable',{},sessionId);await call('Runtime.enable',{},sessionId);
    await call('Page.navigate',{
      url:'http://127.0.0.1:'+server.address().port+'/__cloud_idb_test__'},sessionId);
    await until(async()=>{
      const r=await call('Runtime.evaluate',{expression:"document.readyState==='complete'",
        returnByValue:true},sessionId);return r.result.value===true;
    },'page load');
    return {async evaluate(fn,...args){
      const expression='('+fn.toString()+')('+args.map(JSON.stringify).join(',')+')';
      const r=await call('Runtime.evaluate',{expression,returnByValue:true,
        awaitPromise:true},sessionId);
      if(r.exceptionDetails)throw Error('Browser '+JSON.stringify(r.exceptionDetails));
      return r.result.value;
    }};
  }
  const first=await page(),second=await page();
  const open=async p=>p.evaluate(async(uid)=>{
    const {openPrivateCloudSession}=await import('/merge/cloud/client-session.mjs');
    const auth={getSession:async()=>({data:{session:{access_token:'test-bearer-token',user:{id:uid}}}}),
      getUser:async()=>({data:{user:{id:uid,email_confirmed_at:'2026-11-11'}}})};
    window.__queue=await openPrivateCloudSession({
      projectUrl:'https://demo-private.supabase.co',
      publishableKey:'public-test-key-for-cloud-only',auth,
      storage:localStorage,locks:null,indexedDB,Channel:BroadcastChannel,
      fetchImpl:(_,request)=>fetch('/__mock_cloud__',{
        method:'POST',headers:{'Content-Type':'application/json'},body:request.body})
    });
    return window.__queue.preview();
  },uid);
  const a=await open(first),b=await open(second);
  assert.equal(a.backend,'indexeddb');assert.equal(b.backend,'indexeddb');
  assert.equal(a.verified,false);assert.equal(b.verified,false);
  assert.equal((await first.evaluate(()=>window.__queue.connect())).ok,true);
  const [x,y]=await Promise.all([
    first.evaluate(()=>window.__queue.enqueue({type:'produce',slot:42})),
    second.evaluate(()=>window.__queue.enqueue({type:'produce',slot:44}))
  ]);
  assert.equal([x,y].filter(v=>v.ok).length,2);
  assert.equal((await first.evaluate(()=>window.__queue.flush())).ok,true);
  assert.equal((await backend.read(uid)).revision,2);
  assert.equal((await backend.read(uid)).state.energy,118);
  const reopened=await page();
  assert.equal((await open(reopened)).verified,false);
  assert.equal((await reopened.evaluate(()=>window.__queue.connect())).ok,true);
  assert.equal((await reopened.evaluate(()=>window.__queue.preview())).revision,2);
  assert.equal(await reopened.evaluate(k=>localStorage.getItem(k),
    'toolbox.merge-isle.cloud-queue.v1.'+uid),null,
    'IDB cloud commands do not use a parallel localStorage journal');
  const q=await reopened.evaluate(async()=>{
    const {createCoordinatedCloudQueue}=await import('/merge/cloud/tab-coordinator.mjs');
    const old=createCoordinatedCloudQueue({uid:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      storage:localStorage,locks:{request:async(_n,_o,cb)=>cb({
        name:'wrong',mode:'exclusive'})},
      transport:{read:async()=>{},execute:async()=>{}}});
    return old.enqueue({type:'produce',slot:42});
  });
  assert.equal(q.ok,false,'migrated marker fences former native queue');
  assert.equal((await reopened.evaluate(()=>window.__queue.enqueue({
    type:'produce',slot:42}))).ok,true);
  loseAck=true;
  assert.equal((await reopened.evaluate(()=>window.__queue.flush())).ok,false);
  assert.equal((await backend.read(uid)).revision,3);
  assert.equal((await reopened.evaluate(()=>window.__queue.preview())).attemptedPending,1);
  assert.equal((await reopened.evaluate(()=>window.__queue.flush({force:true}))).ok,true);
  assert.equal((await backend.read(uid)).revision,3,'exact id replay may not reward twice');
  assert.equal(commands,4,'2 initial, one lost ACK, one original ID retry');
  await reopened.evaluate(k=>localStorage.setItem(k,'old-tab-mutated'),
    'toolbox.merge-isle.cloud-queue.v1.'+uid);
  assert.equal((await reopened.evaluate(()=>window.__queue.enqueue({
    type:'produce',slot:42}))).ok,false,
    'legacy post-migration write cannot be silently overwritten');
  const future=await page();
  await assert.rejects(open(future),/Browser|IDB/);
});
