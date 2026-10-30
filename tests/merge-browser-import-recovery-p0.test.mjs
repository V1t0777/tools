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
const key='toolbox.merge-isle.local.v1',backup=key+'.restore-backup-v3';
const story='toolbox.merge-isle.story.local.v1';
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
  ws.addEventListener('message',event=>{
    const data=JSON.parse(event.data),item=pending.get(data.id);if(!item)return;
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

test('P0 Chromium: rejected read, cancelled late read, resumed play and fresh import',
  {timeout:85000},async t=>{
    const chrome=chromePath();
    assert.ok(chrome,'Real Chromium required; no DOM-mock fallback');
    const temp=await mkdtemp(join(tmpdir(),'merge-import-recovery-'));
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
    const target=await call('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await call('Target.attachToTarget',
      {targetId:target.targetId,flatten:true});
    await call('Page.enable',{},sessionId);await call('Runtime.enable',{},sessionId);
    async function evaluate(expression){
      const result=await call('Runtime.evaluate',
        {expression,returnByValue:true,awaitPromise:true,userGesture:true},sessionId);
      if(result.exceptionDetails)throw Error('Chromium JS: '+JSON.stringify(result.exceptionDetails));
      return result.result.value;
    }
    const evalFn=(fn,...args)=>evaluate('('+fn.toString()+')('+args.map(JSON.stringify).join(',')+')');
    await call('Page.navigate',
      {url:'http://127.0.0.1:'+server.address().port+'/merge/index.html'},sessionId);
    await until(()=>evalFn(()=>document.readyState==='complete'&&
      document.getElementById('save-status')?.textContent.includes('已保存于此浏览器')),
    'verified startup');
    const initial=await evalFn(k=>localStorage.getItem(k),key);
    const originalBackup=await evalFn(k=>localStorage.getItem(k),backup);
    assert.ok(initial);
    await evalFn((raw,storyKey)=>{
      localStorage.setItem(storyKey,'story-recovery-sentinel');
      window.__confirms=0;window.confirm=()=>{window.__confirms++;return false;};
      window.__nativeText=File.prototype.text;
      File.prototype.text=()=>Promise.reject(Error('injected read failure'));
      const input=document.getElementById('import-normal-file');input.click=()=>{};
      document.getElementById('import-normal-save').click();
      const transfer=new DataTransfer();transfer.items.add(new File([raw],'failed.json'));
      input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    },initial,story);
    await until(()=>evalFn(()=>document.getElementById('notice').textContent.includes('读取文件失败')&&
      !document.getElementById('import-normal-save').disabled&&
      document.getElementById('cancel-normal-import').hidden),'read failure releases UI');
    assert.equal(await evalFn(()=>window.__confirms),0);
    assert.equal(await evalFn(k=>localStorage.getItem(k),key),initial);
    assert.equal(await evalFn(k=>localStorage.getItem(k),backup),originalBackup);

    const pending=await evalFn(raw=>{
      File.prototype.text=()=>new Promise(resolve=>{window.__lateResolve=resolve;});
      const input=document.getElementById('import-normal-file');input.click=()=>{};
      document.getElementById('import-normal-save').click();
      const transfer=new DataTransfer();transfer.items.add(new File([raw],'slow.json'));
      input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
      return document.getElementById('import-normal-save').disabled&&
        !document.getElementById('cancel-normal-import').hidden&&
        typeof window.__lateResolve==='function';
    },initial);
    assert.equal(pending,true,'second chooser must hold a pending native File read');
    // While a native File.text() is unresolved, the same persistent export
    // control must not request a Blob download of an unreviewed snapshot.
    const blockedExport=await evalFn(()=>{
      const original=HTMLAnchorElement.prototype.click;
      let clicks=0;
      HTMLAnchorElement.prototype.click=function(){clicks++;};
      try{
        document.getElementById('export-local-save').click();
        return {clicks,notice:document.getElementById('notice').textContent};
      }finally{HTMLAnchorElement.prototype.click=original;}
    });
    assert.equal(blockedExport.clicks,0,'pending file read must block export anchor');
    assert.match(blockedExport.notice,/正在选择或核验导入文件/,
      'blocked export must explain the pending import');
    assert.equal(await evalFn(()=>{
      const old=document.getElementById('import-normal-file');
      document.getElementById('cancel-normal-import').click();
      return old!==document.getElementById('import-normal-file');
    }),true,'cancellation must detach the old native chooser');
    await until(()=>evalFn(()=>!document.getElementById('import-normal-save').disabled&&
      document.getElementById('cancel-normal-import').hidden),'cancel releases UI');
    await evalFn(raw=>{window.__lateResolve(raw);File.prototype.text=window.__nativeText;},initial);
    assert.equal(await evalFn(()=>window.__confirms),0,'late read cannot confirm');
    assert.equal(await evalFn(k=>localStorage.getItem(k),key),initial);
    assert.equal(await evalFn(k=>localStorage.getItem(k),backup),originalBackup);

    await evalFn(()=>document.querySelector('#board .producer').click());
    await until(()=>evalFn(k=>JSON.parse(localStorage.getItem(k)).revision===1,
      key),'gameplay after failed reads');
    await until(()=>evalFn(()=>document.getElementById('notice').textContent.startsWith('获得 ')&&
      !document.getElementById('import-normal-save').disabled),'gameplay UI settled');
    const gameplay=await evalFn(k=>localStorage.getItem(k),key);
    // Real Chromium Blob download, not an intercepted anchor: the exact
    // current save must be recoverable after read failure and cancellation.
    await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:temp});
    await evalFn(()=>document.getElementById('export-local-save').click());
    const downloadedPath=join(temp,'yunyu-normal-save-v3.json');
    await until(()=>existsSync(downloadedPath),'download after import recovery',15000);
    assert.equal(await readFile(downloadedPath,'utf8'),gameplay,
      'post-error download must contain the exact verified original bytes');
    assert.equal(await evalFn(k=>localStorage.getItem(k),key),gameplay,
      'read-only export must not write to the normal save');
    assert.equal(await evalFn(k=>localStorage.getItem(k),backup),originalBackup,
      'read-only export must not overwrite the recovery backup');
    await evalFn(raw=>{
      const input=document.getElementById('import-normal-file');input.click=()=>{};
      document.getElementById('import-normal-save').click();
      const transfer=new DataTransfer();transfer.items.add(new File([raw],'fresh.json'));
      input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    },initial);
    await until(()=>evalFn(()=>document.getElementById('notice').textContent.includes('已取消导入')&&
      !document.getElementById('import-normal-save').disabled&&
      document.getElementById('cancel-normal-import').hidden),'fresh import declined');
    assert.equal(await evalFn(()=>window.__confirms),1,'fresh file must reach first consent');
    assert.equal(await evalFn(k=>localStorage.getItem(k),key),gameplay);
    assert.equal(await evalFn(k=>localStorage.getItem(k),backup),originalBackup);
    assert.equal(await evalFn(k=>localStorage.getItem(k),story),'story-recovery-sentinel');
    t.diagnostic('Chromium blocked export during pending read, downloaded exact bytes after recovery, and declined fresh import');
  });
