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
test('P0 Chromium private four-account cloud page and crash-safe story journal',
  {timeout:140000},async t=>{
  const chrome=chromePath();assert.ok(chrome,'Chromium is required');
  const tmp=await mkdtemp(join(tmpdir(),'yunyu-private-cloud-'));
  const server=createServer(async(req,res)=>{
    const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(name==='/__cloud_idb_test__'){
      res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><title>Cloud test</title>');
      return;
    }
    const file=resolve(root,'.'+name);
    if(!file.startsWith(root+sep)){res.writeHead(403).end();return}
    try{const bytes=await readFile(file);
      res.writeHead(200,{'Content-Type':{
        '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css'
      }[extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
    }catch{res.writeHead(404).end('not found')}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=spawn(chrome,['--headless=new','--no-sandbox','--disable-gpu',
    '--disable-dev-shm-usage','--disable-background-networking','--no-proxy-server',
    '--remote-debugging-port=0','--user-data-dir='+tmp,'about:blank'],{stdio:'ignore'});
  let client;
  t.after(async()=>{
    try{client?.close()}catch{}
    browser.kill('SIGKILL');
    await new Promise(resolve=>server.close(resolve));
    await rm(tmp,{recursive:true,force:true,maxRetries:3});
  });
  const portFile=join(tmp,'DevToolsActivePort');
  await until(()=>Promise.resolve(existsSync(portFile)),'Chromium startup');
  const [port,path]=(await readFile(portFile,'utf8')).trim().split('\n');
  client=cdp('ws://127.0.0.1:'+port+path);await client.ready;
  const call=(method,params={},session)=>client.call(method,params,session);
  async function page(url='/__cloud_idb_test__',contextId,init=''){
    const {targetId}=await call('Target.createTarget',{
      url:'about:blank',...(contextId?{browserContextId:contextId}:{})});
    const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
    await call('Page.enable',{},sessionId);await call('Runtime.enable',{},sessionId);
    if(init)await call('Page.addScriptToEvaluateOnNewDocument',{source:init},sessionId);
    await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+url},sessionId);
    await until(async()=>{
      const r=await call('Runtime.evaluate',{expression:"document.readyState==='complete'",
        returnByValue:true},sessionId);return r.result.value===true;
    },'page load');
    return {sessionId,async evaluate(fn,...args){
      const expression='('+fn.toString()+')('+args.map(JSON.stringify).join(',')+')';
      const r=await call('Runtime.evaluate',{expression,returnByValue:true,
        awaitPromise:true,userGesture:true},sessionId);
      if(r.exceptionDetails)throw Error('Browser '+JSON.stringify(r.exceptionDetails));
      return r.result.value;
    }};
  }
  const uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const a=await page(),b=await page();
  async function prepare(p,n){
    return p.evaluate(async(uid,operationId)=>{
      const {openStoryIntentJournal}=await import('/merge/cloud/story-intent-journal.mjs');
      const {createInitialState}=await import('/merge/engine.mjs');
      const {createEmptyStoryProgress}=await import('/merge/mode-boundaries.mjs');
      window.__journal=await openStoryIntentJournal({uid,indexedDB});
      return window.__journal.prepare({operationId,expectedRevision:0,
        pair:{progress:createEmptyStoryProgress(),workshop:createInitialState(1000000)},
        localRaw:[null,null]});
    },uid,'00000000-0000-4000-8000-'+String(n).padStart(12,'0'));
  }
  const [left,right]=await Promise.all([prepare(a,1),prepare(b,2)]);
  assert.equal([left,right].filter(x=>x.ok).length,1,'only one pending intent');
  const id=(left.ok?left:right).intent.operationId;
  const c=await page();
  const recovered=await c.evaluate(async uid=>{
    const {openStoryIntentJournal}=await import('/merge/cloud/story-intent-journal.mjs');
    window.__journal=await openStoryIntentJournal({uid,indexedDB});
    return window.__journal.read();
  },uid);
  assert.equal(recovered.operationId,id);
  assert.equal(recovered.attempts,0);
  assert.equal((await c.evaluate(id=>window.__journal.beginAttempt(id),id)).ok,true);
  assert.equal((await b.evaluate(()=>window.__journal.read())).attempts,1);
  assert.equal((await c.evaluate(id=>window.__journal.acknowledge(id),id)).ok,true);
  assert.equal(await c.evaluate(()=>window.__journal.read()),null);

  const {browserContextId}=await call('Target.createBrowserContext',{});
  const ui=await page('/merge/cloud-preview.html',browserContextId,"(function(){\n  const uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';\n  const project='https://demo-private.supabase.co';\n  const key='public-test-key-for-cloud-only';\n  const toolbox={\n    url:project,key,\n    peekSession(){return {access_token:'test-bearer-token',user:{id:uid}}},\n    createClient(){return {auth:{\n      getSession:async()=>({data:{session:{access_token:'test-bearer-token',user:{id:uid}}}})\n    }}},\n    signOut:async()=>true,signIn:async()=>true\n  };\n  Object.defineProperty(window,'ToolboxAuth',{configurable:true,get(){return toolbox},set(){}});\n  window.confirm=()=>true;\n  window.__cloudErrors=[];\n  window.addEventListener('error',e=>window.__cloudErrors.push(e.message));\n  window.addEventListener('unhandledrejection',e=>window.__cloudErrors.push(String(e.reason)));\n  window.fetch=async(url,options)=>{\n    if(url===project+'/auth/v1/user')return new Response(JSON.stringify({\n      id:uid,email_confirmed_at:'2026-11-11'}),\n      {status:200,headers:{'content-type':'application/json'}});\n    if(!window.__mockBackend)window.__mockBackend=(async()=>{\n      const {createInMemoryAuthority}=await import('/merge/cloud/authority.mjs');\n      const {createInMemoryStoryPairAuthority}=await import('/merge/cloud/story-pair-authority.mjs');\n      return {normal:createInMemoryAuthority({clock:()=>1000000,rng:()=>0.9}),\n        story:createInMemoryStoryPairAuthority({allowed:id=>id===uid})};\n    })();\n    const backend=await window.__mockBackend,body=JSON.parse(options.body);\n    let result;\n    if(url===project+'/functions/v1/merge-game')\n      result=body.mode==='read'?await backend.normal.read(uid):\n        await backend.normal.execute(uid,body.command);\n    else if(url===project+'/functions/v1/merge-story')\n      result=body.mode==='read'?await backend.story.read(uid):\n        await backend.story.commit(uid,{\n          operationId:body.operationId,expectedRevision:body.expectedRevision,pair:body.pair\n        });\n    else throw Error('Unexpected destination');\n    return new Response(JSON.stringify(result),{\n      status:result.status==='conflict'?409:200,\n      headers:{'content-type':'application/json'}});\n  };\n})();");
  await until(()=>ui.evaluate(()=>!document.getElementById('game').hidden&&
    document.querySelectorAll('#cloud-board button').length===56),
    'authenticated cloud game rendering');
  assert.equal(await ui.evaluate(()=>document.getElementById('energy').textContent),
    '体力 120');
  const clicked=await ui.evaluate(()=>{
    const b=[...document.querySelectorAll('#cloud-board button')].find(
      b=>b.getAttribute('aria-label')?.includes('工坊'));
    if(!b)return false;b.click();return true;
  });
  assert.equal(clicked,true);
  await until(()=>ui.evaluate(()=>document.getElementById('revision').textContent==='版本 1'),
    'one server-authorized production');
  assert.equal(await ui.evaluate(()=>localStorage.getItem('toolbox.merge-isle.local.v1')),
    null,'cloud operations never overwrite offline normal save');
  await ui.evaluate(()=>document.getElementById('story-init').click());
  await until(()=>ui.evaluate(()=>!document.getElementById('story-read').disabled),
    'story local IDB and cloud session ready');
  await ui.evaluate(()=>document.getElementById('story-read').click());
  await until(()=>ui.evaluate(()=>document.getElementById('story-status').textContent.includes('云端状态 empty')),
    'first cloud story read');
  await ui.evaluate(()=>document.getElementById('story-upload').click());
  await until(()=>ui.evaluate(()=>document.getElementById('story-status').textContent.includes('已由服务器确认')),
    'confirmed story pair upload');
  const mobileView=async width=>{
    await call('Emulation.setDeviceMetricsOverride',{
      width,height:740,deviceScaleFactor:3,mobile:true
    },ui.sessionId);
    await until(()=>ui.evaluate(w=>document.documentElement.clientWidth===w,width),
      'actual mobile viewport '+width);
    return ui.evaluate(()=>{
      const viewport=document.getElementById('cloud-board-viewport');
      const controls=document.getElementById('cloud-board-controls');
      const button=document.getElementById('cloud-board-right');
      const visible=element=>element&&getComputedStyle(element).display!=='none';
      return {
        width:document.documentElement.clientWidth,
        scrollWidth:document.documentElement.scrollWidth,
        boardScrollWidth:viewport?.scrollWidth??0,
        boardClientWidth:viewport?.clientWidth??0,
        controlVisible:visible(controls),
        arrowHeight:Math.round(button?.getBoundingClientRect().height??0),
        loginInputFont:Number.parseFloat(getComputedStyle(
          document.getElementById('login-email')).fontSize)
      };
    });
  };
  for(const width of [320,375,390,430]){
    const m=await mobileView(width);
    assert.ok(m.scrollWidth<=m.width+1,'cloud page must not overflow at '+width);
    assert.ok(m.loginInputFont>=16,'iOS login focus must not auto zoom at '+width);
    if(m.boardScrollWidth>m.boardClientWidth+1){
      assert.equal(m.controlVisible,true,'board arrows visible at '+width);
      assert.ok(m.arrowHeight>=44,'board arrow touch area >= 44px at '+width);
    }
  }
  await mobileView(320);
  await until(()=>ui.evaluate(()=>!document.getElementById('cloud-board-controls').hidden),
    'arrow controls appear when cloud board overflows');
  const beforeScroll=await ui.evaluate(()=>document.getElementById('cloud-board-viewport').scrollLeft);
  await ui.evaluate(()=>document.getElementById('cloud-board-right').click());
  const afterScroll=await ui.evaluate(()=>document.getElementById('cloud-board-viewport').scrollLeft);
  assert.ok(afterScroll>beforeScroll,'mobile cloud board right button actually scrolls');
  await ui.evaluate(()=>document.getElementById('cloud-board-left').click());
  assert.ok((await ui.evaluate(()=>document.getElementById('cloud-board-viewport').scrollLeft))
    <afterScroll,'left button scrolls back');
  // Use the same real mobile viewport to check story and workshop entrypoints.
  for(const [route,readySelector] of [
    ['/merge/story.html','#story-list'],
    ['/merge/story-workshop.html','#workshop-board']
  ]){
    await call('Page.navigate',{
      url:'http://127.0.0.1:'+server.address().port+route},ui.sessionId);
    await until(()=>ui.evaluate(selector=>
      document.querySelector(selector)!==null,readySelector),
      'mobile story route '+route);
    const layout=await ui.evaluate(()=>{
      const board=document.querySelector('.workshop-board-wrap');
      const actions=[...document.querySelectorAll(
        '.tabs button,.journey-primary,.story-card button,.workshop-cell,.workshop-build')]
        .filter(el=>getComputedStyle(el).display!=='none'&&el.getBoundingClientRect().width>0);
      return {width:document.documentElement.clientWidth,
        scroll:document.documentElement.scrollWidth,
        horizontalBoard:board?board.scrollWidth>board.clientWidth:false,
        minTouch:actions.length?Math.min(...actions.map(el=>
          el.getBoundingClientRect().height)):null
      };
    });
    assert.ok(layout.scroll<=layout.width+1,'document overflow on '+route);
    assert.ok(layout.minTouch===null||layout.minTouch>=44,
      'story touch target >=44px on '+route);
    if(route.includes('workshop'))assert.equal(layout.horizontalBoard,true,
      'workshop board has a dedicated horizontal scroll viewport at 320px');
  }
  await call('Target.disposeBrowserContext',{browserContextId});
});
