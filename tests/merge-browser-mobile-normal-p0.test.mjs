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
  {timeout:110000},async t=>{
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
      el.scrollIntoView({block:'center',inline:'center'});
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
      el.scrollIntoView({block:'center',inline:'center'});
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
      el.scrollIntoView({block:'center',inline:'center'});
      const r=el.getBoundingClientRect();
      return {x:r.left+r.width/2,y:r.top+r.height/2};
    });
    await until(()=>evalFn(({x,y})=>
      !!document.elementFromPoint(x,y)?.closest('#board .producer'),resumedTap),
      '320px native touch reaches producer after declined import');
    await call('Input.dispatchTouchEvent',
      {type:'touchStart',touchPoints:[resumedTap]},sessionId);
    await call('Input.dispatchTouchEvent',
      {type:'touchEnd',touchPoints:[]},sessionId);
    await until(()=>evalFn(k=>JSON.parse(localStorage.getItem(k))?.revision===2,KEY),
      'mobile play resumes after declined import');
    const resumed=await evalFn(k=>JSON.parse(localStorage.getItem(k)),KEY);
    assert.equal(resumed.energy,initial.energy-2);
    assert.equal(await evalFn(k=>localStorage.getItem(k),storyKey),storySentinel);
    assert.equal(await readFile(downloadedPath,'utf8'),savedRaw,
      'download remains a snapshot after later gameplay');
    assert.equal(await evalFn(()=>
      document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),true);
    t.diagnostic('Mobile Chromium 320/375/390/430px layout, native producer/export touches, exact JSON download, declined import and resumed play passed. Not iPhone Safari/WeChat testing.');
  });
