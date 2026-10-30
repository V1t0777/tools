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
const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript',
  '.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.png':'image/png'};
async function until(check,label,limit=12000){
  const end=Date.now()+limit;
  while(Date.now()<end){try{if(await check())return;}catch{}await sleep(70);}
  throw Error('TIMEOUT: '+label);
}
function chromePath(){
  for(const name of [process.env.CHROME_BIN,'google-chrome','google-chrome-stable',
    'chromium','chromium-browser'].filter(Boolean)){
    if(spawnSync(name,['--version'],{encoding:'utf8'}).status===0)return name;
  }
  return null;
}
function cdp(url){
  const ws=new WebSocket(url),pending=new Map();let serial=0;
  const ready=new Promise((resolve,reject)=>{
    ws.addEventListener('open',resolve,{once:true});
    ws.addEventListener('error',reject,{once:true});
  });
  ws.addEventListener('message',event=>{
    const data=JSON.parse(event.data),p=pending.get(data.id);if(!p)return;
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

test('P0 mobile Chromium: 320–430px normal mode layout, native touch and save controls',
  {timeout:140000},async t=>{
    const chrome=chromePath();
    assert.ok(chrome,'Real Chromium required; DOM mocks cannot satisfy mobile layout gate');
    const temp=await mkdtemp(join(tmpdir(),'merge-mobile-normal-'));
    const server=createServer(async(req,res)=>{
      const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      const file=resolve(root,'.'+path);
      if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
      try{
        const bytes=await readFile(file);
        res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream',
          'Cache-Control':'no-store'}).end(bytes);
      }catch{res.writeHead(404).end('not found');}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const browser=spawn(chrome,['--headless=new','--no-sandbox','--disable-gpu',
      '--disable-dev-shm-usage','--no-first-run','--no-default-browser-check',
      '--disable-background-networking','--no-proxy-server','--remote-debugging-port=0',
      '--user-data-dir='+temp,'about:blank'],{stdio:'ignore'});
    let client;
    t.after(async()=>{
      try{client?.close();}catch{}
      browser.kill('SIGKILL');
      await new Promise(resolve=>server.close(resolve));
      await rm(temp,{recursive:true,force:true,maxRetries:3});
    });
    const portFile=join(temp,'DevToolsActivePort');
    await until(()=>existsSync(portFile),'Chromium debugging port',20000);
    const [port,wsPath]=(await readFile(portFile,'utf8')).trim().split('\n');
    client=cdp('ws://127.0.0.1:'+port+wsPath);await client.ready;
    const call=(method,params={},session)=>client.call(method,params,session);
    const {targetId}=await call('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
    await call('Page.enable',{},sessionId);await call('Runtime.enable',{},sessionId);
    await call('Target.activateTarget',{targetId});
    await call('Page.bringToFront',{},sessionId);
    const evaluate=async expression=>{
      const r=await call('Runtime.evaluate',
        {expression,returnByValue:true,awaitPromise:true,userGesture:true},sessionId);
      if(r.exceptionDetails)throw Error('Chromium JS: '+JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const evalFn=(fn,...args)=>evaluate('('+fn.toString()+')('+args.map(JSON.stringify).join(',')+')');
    const setViewport=async width=>{
      await call('Emulation.setDeviceMetricsOverride',
        {width,height:740,deviceScaleFactor:3,mobile:true},sessionId);
      await until(()=>evalFn(w=>document.documentElement.clientWidth===w,width),
        'mobile viewport '+width);
    };
    // about:blank has no viewport meta and may use a 980px layout viewport.
    // Apply device metrics first; assert the CSS viewport only after navigation.
    await call('Emulation.setDeviceMetricsOverride',
      {width:320,height:740,deviceScaleFactor:3,mobile:true},sessionId);
    await call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1},sessionId);
    await call('Page.navigate',
      {url:'http://127.0.0.1:'+server.address().port+'/merge/index.html'},sessionId);
    await until(()=>evalFn(()=>document.readyState==='complete'&&
      document.getElementById('save-status')?.textContent.includes('已保存于此浏览器')&&
      document.querySelectorAll('#board .cell').length===56&&
      !!document.getElementById('import-normal-save')),'verified mobile startup');
    await setViewport(320);
    const initial=await evalFn(k=>JSON.parse(localStorage.getItem(k)),KEY);
    const initialRaw=await evalFn(k=>localStorage.getItem(k),KEY);
    assert.equal(initial.revision,0);

    for(const width of [320,375,390,430]){
      await setViewport(width);
      const layout=await evalFn(()=>{
        const rect=el=>el.getBoundingClientRect();
        const board=document.getElementById('board');
        const section=document.querySelector('.board-section');
        const controls=['how-to','board-guide','export-local-save','export-abnormal-reset-backup',
          'import-normal-save','export-restore-backup','reset','warehouse-upgrade',
          'store-selected','deadlock-discard'];
        return {
          width:document.documentElement.clientWidth,
          documentWidth:document.documentElement.scrollWidth,
          boardCellWidth:rect(board.querySelector('.cell')).width,
          boardScroll:section.scrollWidth-section.clientWidth,
          controls:controls.map(id=>{
            const el=document.getElementById(id),r=rect(el);
            return {id,width:r.width,height:r.height,visible:!!r.width&&!!r.height};
          })
        };
      });
      assert.ok(layout.documentWidth<=width+1,
        'whole document must not scroll horizontally at '+width+': '+JSON.stringify(layout));
      assert.ok(layout.boardCellWidth>=43.5,
        'board touch cells must stay at least 44 CSS px at '+width);
      if(width===320)assert.ok(layout.boardScroll>0,
        '320px board must pan within its own section, not the document');
      for(const control of layout.controls){
        assert.ok(control.visible,'missing control '+control.id+' at '+width);
        assert.ok(control.height>=43.5,
          'undersized control '+control.id+' at '+width+': '+control.height);
      }
    }
    await setViewport(320);
    const point=await evalFn(()=>{
      const el=document.querySelector('#board .producer');
      el.scrollIntoView({behavior:'instant',block:'center',inline:'center'});
      const r=el.getBoundingClientRect();
      return {x:r.left+r.width/2,y:r.top+r.height/2};
    });
    await sleep(100);
    assert.equal(await evalFn(({x,y})=>{
      const hit=document.elementFromPoint(x,y);
      return !!hit?.closest('#board .producer');
    },point),true,'emulated touch must hit the producer');
    await call('Input.dispatchTouchEvent',
      {type:'touchStart',touchPoints:[{x:point.x,y:point.y}]},sessionId);
    await call('Input.dispatchTouchEvent',
      {type:'touchEnd',touchPoints:[]},sessionId);
    await until(()=>evalFn(k=>JSON.parse(localStorage.getItem(k))?.revision===1,KEY),
      'native emulated touch produced and persisted one action');
    const after=await evalFn(k=>JSON.parse(localStorage.getItem(k)),KEY);
    assert.equal(after.energy,initial.energy-1);
    assert.equal(await evalFn(()=>document.documentElement.scrollWidth<=
      document.documentElement.clientWidth+1),true);
    // Complete the mobile-sized save workflow with actual Chromium bytes:
    // a native touch export, a declined older-file import, and resumed play.
    // This is CDP mobile emulation, NOT an iOS/WeChat file picker.
    const savedRaw=await evalFn(k=>localStorage.getItem(k),KEY);
    const backupKey=KEY+'.restore-backup-v3';
    const beforeBackup=await evalFn(k=>localStorage.getItem(k),backupKey);
    const storyKey='toolbox.merge-isle.story.local.v1';
    const storySentinel='mobile-normal-isolation-sentinel';
    await evalFn((k,value)=>localStorage.setItem(k,value),storyKey,storySentinel);
    await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:temp});
    const exportTap=await evalFn(()=>{
      const el=document.getElementById('export-local-save');
      el.scrollIntoView({behavior:'instant',block:'center',inline:'center'});
      const r=el.getBoundingClientRect();
      return {x:r.left+r.width/2,y:r.top+r.height/2};
    });
    await until(()=>evalFn(({x,y})=>
      !!document.elementFromPoint(x,y)?.closest('#export-local-save'),exportTap),
      '320px native touch reaches export button');
    await call('Input.dispatchTouchEvent',
      {type:'touchStart',touchPoints:[exportTap]},sessionId);
    await call('Input.dispatchTouchEvent',
      {type:'touchEnd',touchPoints:[]},sessionId);
    const downloadedPath=join(temp,'yunyu-normal-save-v3.json');
    await until(()=>existsSync(downloadedPath),'mobile emulated native-touch download',15000);
    assert.equal(await readFile(downloadedPath,'utf8'),savedRaw,
      'native-touch export must download exact verified save bytes');
    assert.equal(await evalFn(k=>localStorage.getItem(k),KEY),savedRaw,
      'mobile export must not mutate the normal save');
    assert.equal(await evalFn(k=>localStorage.getItem(k),backupKey),beforeBackup);

    // Use a prior revision through the real input change handler. Declining
    // confirmation must neither downgrade the save nor poison later touches.
    await evalFn(oldRaw=>{
      window.__mobileImportConfirms=0;
      window.confirm=()=>{window.__mobileImportConfirms++;return false;};
      const input=document.getElementById('import-normal-file');
      input.click=()=>{}; // replace only the native OS picker in CDP
      document.getElementById('import-normal-save').click();
      const transfer=new DataTransfer();
      transfer.items.add(new File([oldRaw],'previous-normal.json',
        {type:'application/json'}));
      input.files=transfer.files;
      input.dispatchEvent(new Event('change',{bubbles:true}));
    },initialRaw);
    await until(()=>evalFn(()=>
      document.getElementById('notice').textContent.includes('已取消导入')&&
      !document.getElementById('import-normal-save').disabled&&
      document.getElementById('cancel-normal-import').hidden),
      '320px declined older import releases UI');
    assert.equal(await evalFn(()=>window.__mobileImportConfirms),1);
    assert.equal(await evalFn(k=>localStorage.getItem(k),KEY),savedRaw,
      'declined mobile import must preserve current progress');
    assert.equal(await evalFn(k=>localStorage.getItem(k),backupKey),beforeBackup);
    assert.equal(await evalFn(k=>localStorage.getItem(k),storyKey),storySentinel);

    const resumedTap=await evalFn(()=>{
      const el=document.querySelector('#board .producer');
      el.scrollIntoView({behavior:'instant',block:'center',inline:'center'});
      const r=el.getBoundingClientRect();
      return {x:r.left+r.width/2,y:r.top+r.height/2};
    });
    await until(()=>evalFn(({x,y})=>
      !!document.elementFromPoint(x,y)?.closest('#board .producer'),resumedTap),
      '320px native touch reaches producer after declined import');
    await evalFn(()=>new Promise(resolve=>
      requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true)))));
    assert.equal(await evalFn(({x,y})=>
      !!document.elementFromPoint(x,y)?.closest('#board .producer'),resumedTap),true,
      'producer must remain under finger after scroll settles');
    await call('Input.dispatchTouchEvent',
      {type:'touchStart',touchPoints:[resumedTap]},sessionId);
    await call('Input.dispatchTouchEvent',
      {type:'touchEnd',touchPoints:[]},sessionId);
    try{
      await until(()=>evalFn(k=>JSON.parse(localStorage.getItem(k))?.revision===2,KEY),
        'mobile play resumes after declined import');
    }catch(error){
      const snapshot=await evalFn(k=>{
        const raw=localStorage.getItem(k);
        let state=null;
        try{state=raw?JSON.parse(raw):null;}catch{}
        return {revision:state?.revision,energy:state?.energy,
          notice:document.getElementById('notice')?.textContent,
          saveStatus:document.getElementById('save-status')?.textContent,
          importDisabled:document.getElementById('import-normal-save')?.disabled,
          cancelHidden:document.getElementById('cancel-normal-import')?.hidden,
          pageHidden:document.hidden};
      },KEY);
      t.diagnostic('Mobile resumed touch failure-only snapshot: '+JSON.stringify(snapshot));
      throw error;
    }
    const resumed=await evalFn(k=>JSON.parse(localStorage.getItem(k)),KEY);
    assert.equal(resumed.energy,initial.energy-2);
    assert.equal(await evalFn(k=>localStorage.getItem(k),storyKey),storySentinel);
    assert.equal(await readFile(downloadedPath,'utf8'),savedRaw,
      'download remains a snapshot after later gameplay');
    assert.equal(await evalFn(()=>
      document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),true);

    // Mobile BFCache + pending chooser: old input events must never authorize
    // a restore after pagehide. Only the OS picker is stubbed.
    const beforeLeave=await evalFn(k=>localStorage.getItem(k),KEY);
    await evalFn(()=>{
      window.__mobileBfcacheReturn=false;
      window.addEventListener('pageshow',e=>{
        if(e.persisted)window.__mobileBfcacheReturn=true;
      });
      window.__returnConfirms=0;
      window.confirm=()=>{window.__returnConfirms++;return false;};
      const input=document.getElementById('import-normal-file');
      window.__staleMobileInput=input;
      input.click=()=>{};
      document.getElementById('import-normal-save').click();
    });
    await until(()=>evalFn(()=>!document.getElementById('cancel-normal-import').hidden),
      'pending mobile chooser before navigation');
    await call('Page.navigate',
      {url:'http://127.0.0.1:'+server.address().port+'/merge/mobile-away-test'},sessionId);
    await until(()=>evalFn(()=>location.pathname==='/merge/mobile-away-test'&&
      document.readyState==='complete'),'mobile navigation away');
    const history=await call('Page.getNavigationHistory',{},sessionId);
    await call('Page.navigateToHistoryEntry',
      {entryId:history.entries[history.currentIndex-1].id},sessionId);
    await until(()=>evalFn(()=>location.pathname==='/merge/index.html'&&
      !!document.getElementById('import-normal-save')),'mobile history return');
    assert.equal(await evalFn(()=>window.__mobileBfcacheReturn),true,
      'must exercise genuine BFCache, not a reload');
    await until(()=>evalFn(()=>
      document.getElementById('save-status').textContent.includes('已保存于此浏览器')&&
      document.getElementById('cancel-normal-import').hidden&&
      !document.getElementById('import-normal-save').disabled),
      'BFCache revoked chooser and revalidated save');
    assert.equal(await evalFn(k=>localStorage.getItem(k),KEY),beforeLeave);
    await evalFn(raw=>{
      const files=new DataTransfer();
      files.items.add(new File([raw],'stale-mobile.json',{type:'application/json'}));
      window.__staleMobileInput.files=files.files;
      window.__staleMobileInput.dispatchEvent(new Event('change',{bubbles:true}));
    },initialRaw);
    await until(()=>evalFn(()=>document.getElementById('notice').textContent.includes(
      '文件选择期间页面或存档已变化')),'stale chooser rejected after BFCache');
    assert.equal(await evalFn(()=>window.__returnConfirms),0);
    assert.equal(await evalFn(k=>localStorage.getItem(k),KEY),beforeLeave);
    assert.equal(await evalFn(k=>localStorage.getItem(k),backupKey),beforeBackup);
    assert.equal(await evalFn(k=>localStorage.getItem(k),storyKey),storySentinel);

    // A new picker can be declined safely, then normal native touch and
    // an exact JSON download still work in the restored mobile document.
    await evalFn(raw=>{
      const input=document.getElementById('import-normal-file');
      input.click=()=>{};
      document.getElementById('import-normal-save').click();
      const files=new DataTransfer();
      files.items.add(new File([raw],'fresh-mobile.json',{type:'application/json'}));
      input.files=files.files;
      input.dispatchEvent(new Event('change',{bubbles:true}));
    },initialRaw);
    await until(()=>evalFn(()=>document.getElementById('notice').textContent.includes(
      '已取消导入')&&!document.getElementById('import-normal-save').disabled&&
      document.getElementById('cancel-normal-import').hidden),
      'fresh import declined after BFCache');
    assert.equal(await evalFn(()=>window.__returnConfirms),1);
    assert.equal(await evalFn(k=>localStorage.getItem(k),KEY),beforeLeave);
    const postReturnTap=await evalFn(()=>{
      const el=document.querySelector('#board .producer');
      el.scrollIntoView({behavior:'instant',block:'center',inline:'center'});
      const r=el.getBoundingClientRect();
      return {x:r.left+r.width/2,y:r.top+r.height/2};
    });
    await until(()=>evalFn(({x,y})=>
      !!document.elementFromPoint(x,y)?.closest('#board .producer'),postReturnTap),
      'post-BFCache mobile producer hit');
    await evalFn(()=>new Promise(resolve=>
      requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true)))));
    assert.equal(await evalFn(({x,y})=>
      !!document.elementFromPoint(x,y)?.closest('#board .producer'),postReturnTap),true,
      'producer must remain under finger after scroll settles');
    await call('Input.dispatchTouchEvent',
      {type:'touchStart',touchPoints:[postReturnTap]},sessionId);
    await call('Input.dispatchTouchEvent',
      {type:'touchEnd',touchPoints:[]},sessionId);
    await until(()=>evalFn(k=>JSON.parse(localStorage.getItem(k))?.revision===3,KEY),
      'post-BFCache mobile production persisted');
    await until(()=>evalFn(()=>document.getElementById('notice').textContent.startsWith(
      '获得 ')&&document.getElementById('save-status').textContent.includes(
      '已保存于此浏览器')&&!document.getElementById('import-normal-save').disabled),
      'post-BFCache UI settled before export');
    const postReturnRaw=await evalFn(k=>localStorage.getItem(k),KEY);
    assert.equal(JSON.parse(postReturnRaw).energy,initial.energy-3);
    await rm(downloadedPath,{force:true});
    const postReturnExport=await evalFn(()=>{
      const el=document.getElementById('export-local-save');
      el.scrollIntoView({behavior:'instant',block:'center',inline:'center'});
      const r=el.getBoundingClientRect();
      return {x:r.left+r.width/2,y:r.top+r.height/2};
    });
    await until(()=>evalFn(({x,y})=>
      !!document.elementFromPoint(x,y)?.closest('#export-local-save'),
      postReturnExport),'post-BFCache mobile export hit');
    await call('Input.dispatchTouchEvent',
      {type:'touchStart',touchPoints:[postReturnExport]},sessionId);
    await call('Input.dispatchTouchEvent',
      {type:'touchEnd',touchPoints:[]},sessionId);
    await until(()=>existsSync(downloadedPath),'post-BFCache mobile download',15000);
    assert.equal(await readFile(downloadedPath,'utf8'),postReturnRaw);
    assert.equal(await evalFn(k=>localStorage.getItem(k),KEY),postReturnRaw);
    assert.equal(await evalFn(k=>localStorage.getItem(k),backupKey),beforeBackup);
    assert.equal(await evalFn(k=>localStorage.getItem(k),storyKey),storySentinel);
    assert.equal(await evalFn(()=>document.documentElement.scrollWidth<=
      document.documentElement.clientWidth+1),true);

    // A stays in BFCache while B performs a real, locked normal-mode UI write.
    const preCross=await evalFn(k=>localStorage.getItem(k),KEY);
    assert.equal(JSON.parse(preCross).revision,3);
    await evalFn(()=>{
      window.__mobileBfcacheReturn=false;
      window.__crossConfirm=0;
      window.confirm=()=>{window.__crossConfirm++;return false;};
      const input=document.getElementById('import-normal-file');
      window.__crossStaleInput=input;
      input.click=()=>{}; // Only the native OS chooser is substituted.
      document.getElementById('import-normal-save').click();
    });
    await until(()=>evalFn(()=>!document.getElementById('cancel-normal-import').hidden),
      'cross-tab chooser pending');
    await call('Page.navigate',{url:'http://127.0.0.1:'+
      server.address().port+'/merge/mobile-cross-away'},sessionId);
    await until(()=>evalFn(()=>location.pathname==='/merge/mobile-cross-away'&&
      document.readyState==='complete'),'A navigated away');
    const {targetId:tabB}=await call('Target.createTarget',{url:'about:blank'});
    const {sessionId:sessionB}=await call('Target.attachToTarget',
      {targetId:tabB,flatten:true});
    await call('Page.enable',{},sessionB);
    await call('Runtime.enable',{},sessionB);
    const evalB=async expression=>{
      const r=await call('Runtime.evaluate',
        {expression,returnByValue:true,awaitPromise:true,userGesture:true},sessionB);
      if(r.exceptionDetails)throw Error('B JS: '+JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    await call('Target.activateTarget',{targetId:tabB});
    await call('Page.bringToFront',{},sessionB);
    await call('Page.navigate',{url:'http://127.0.0.1:'+
      server.address().port+'/merge/index.html'},sessionB);
    await until(()=>evalB("document.readyState==='complete' && "+
      "document.getElementById('save-status')?.textContent.includes('已保存于此浏览器')"),
      'B verified normal startup');
    assert.equal(await evalB('document.hidden'),false);
    assert.equal(await evalB("JSON.parse(localStorage.getItem("+JSON.stringify(KEY)+")).revision"),3);
    await evalB("document.querySelector('#board .producer').click();true");
    await until(()=>evalB("JSON.parse(localStorage.getItem("+JSON.stringify(KEY)+")).revision===4"),
      'B normal Web Locks write');
    const rawB=await evalB("localStorage.getItem("+JSON.stringify(KEY)+")");
    assert.notEqual(rawB,preCross);
    assert.equal(JSON.parse(rawB).energy,initial.energy-4);
    await call('Target.activateTarget',{targetId});
    await call('Page.bringToFront',{},sessionId);
    const nav=await call('Page.getNavigationHistory',{},sessionId);
    await call('Page.navigateToHistoryEntry',
      {entryId:nav.entries[nav.currentIndex-1].id},sessionId);
    await until(()=>evalFn(()=>location.pathname==='/merge/index.html'&&
      !!document.getElementById('save-status')),'A history return');
    assert.equal(await evalFn(()=>window.__mobileBfcacheReturn),true,
      'A must genuinely resume BFCache');
    await until(()=>evalFn(energy=>
      document.getElementById('energy').textContent.startsWith(energy+' /')&&
      document.getElementById('cancel-normal-import').hidden&&
      !document.getElementById('import-normal-save').disabled&&
      (document.getElementById('save-status').textContent.includes('已同步其他标签页')||
       document.getElementById('save-status').textContent.includes('已保存于此浏览器')),
      String(initial.energy-4)),'A adopted B revision and revoked chooser');
    assert.equal(await evalFn(k=>localStorage.getItem(k),KEY),rawB);
    await evalFn(raw=>{
      const transfer=new DataTransfer();
      transfer.items.add(new File([raw],'old-cross-tab.json',{type:'application/json'}));
      window.__crossStaleInput.files=transfer.files;
      window.__crossStaleInput.dispatchEvent(new Event('change',{bubbles:true}));
    },initialRaw);
    await until(()=>evalFn(()=>document.getElementById('notice').textContent.includes(
      '文件选择期间页面或存档已变化')),'old chooser rejected after B update');
    assert.equal(await evalFn(()=>window.__crossConfirm),0);
    assert.equal(await evalFn(k=>localStorage.getItem(k),KEY),rawB);
    const nextTap=await evalFn(()=>{
      const el=document.querySelector('#board .producer');
      el.scrollIntoView({behavior:'instant',block:'center',inline:'center'});
      const r=el.getBoundingClientRect();
      return {x:r.left+r.width/2,y:r.top+r.height/2};
    });
    await until(()=>evalFn(({x,y})=>
      !!document.elementFromPoint(x,y)?.closest('#board .producer'),nextTap),
      'A fresh producer hit');
    await evalFn(()=>new Promise(resolve=>
      requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true)))));
    assert.equal(await evalFn(({x,y})=>
      !!document.elementFromPoint(x,y)?.closest('#board .producer'),nextTap),true);
    await call('Input.dispatchTouchEvent',
      {type:'touchStart',touchPoints:[nextTap]},sessionId);
    await call('Input.dispatchTouchEvent',
      {type:'touchEnd',touchPoints:[]},sessionId);
    await until(()=>evalFn(k=>JSON.parse(localStorage.getItem(k))?.revision===5,KEY),
      'A fresh native touch after B adoption');
    await until(()=>evalFn(()=>document.getElementById('notice').textContent.startsWith(
      '获得 ')&&document.getElementById('save-status').textContent.includes(
      '已保存于此浏览器')&&!document.getElementById('import-normal-save').disabled),
      'A settled before final export');
    const finalRaw=await evalFn(k=>localStorage.getItem(k),KEY);
    assert.equal(JSON.parse(finalRaw).energy,initial.energy-5);
    await rm(downloadedPath,{force:true});
    const nextExport=await evalFn(()=>{
      const el=document.getElementById('export-local-save');
      el.scrollIntoView({behavior:'instant',block:'center',inline:'center'});
      const r=el.getBoundingClientRect();
      return {x:r.left+r.width/2,y:r.top+r.height/2};
    });
    await until(()=>evalFn(({x,y})=>
      !!document.elementFromPoint(x,y)?.closest('#export-local-save'),nextExport),
      'A final export hit');
    await call('Input.dispatchTouchEvent',
      {type:'touchStart',touchPoints:[nextExport]},sessionId);
    await call('Input.dispatchTouchEvent',
      {type:'touchEnd',touchPoints:[]},sessionId);
    await until(()=>existsSync(downloadedPath),'cross-tab export landed',15000);
    assert.equal(await readFile(downloadedPath,'utf8'),finalRaw);
    assert.equal(await evalFn(k=>localStorage.getItem(k),KEY),finalRaw);
    assert.equal(await evalFn(k=>localStorage.getItem(k),backupKey),beforeBackup);
    assert.equal(await evalFn(k=>localStorage.getItem(k),storyKey),storySentinel);
    assert.equal(await evalFn(()=>document.documentElement.scrollWidth<=
      document.documentElement.clientWidth+1),true);
    t.diagnostic('320px Chromium: B locked UI write while A BFCache; A adopted B, rejected stale chooser, resumed native touch, exact downloaded JSON. Not iPhone/WeChat.');

    t.diagnostic('Mobile Chromium: 320–430px layout, touch/download/declined import, genuine BFCache stale chooser rejection, fresh touch and exact re-export passed. Not iPhone Safari/WeChat testing.');
  });
