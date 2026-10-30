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
  // A busy CI runner can need longer than the default 12s to create the
  // DevTools port. This remains a bounded hard failure, never a mock fallback.
  await until(()=>existsSync(portFile),'Chrome debugging port',20000);
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
  // Failure-only diagnostics preserve the original timeout. Never print raw
  // save or backup bytes, and never convert a retry into a passing assertion.
  async function waitWithSnapshot(check,label,p,limit=12000){
    try{return await until(check,label,limit);}
    catch(error){
      try{
        const snapshot=await evalOn(p,`(()=>{
          const raw=localStorage.getItem("toolbox.merge-isle.local.v1");
          let save=null;
          try{save=raw?JSON.parse(raw):null;}catch{}
          const backup=localStorage.getItem("toolbox.merge-isle.local.v1.restore-backup-v3");
          return {
            revision:save?.revision,energy:save?.energy,rawLength:raw?.length,
            backupLength:backup?.length,hidden:document.hidden,
            status:document.getElementById('save-status')?.textContent,
            notice:document.getElementById('notice')?.textContent,
            displayedEnergy:document.getElementById('energy')?.textContent,
            importDisabled:document.getElementById('import-normal-save')?.disabled,
            cancelHidden:document.getElementById('cancel-normal-import')?.hidden,
            ghosts:document.querySelectorAll('.drag-ghost').length,
            lastTouchEvents:window.__touchTrace?.slice(-12)
          };
        })()`);
        t.diagnostic('Chromium failure snapshot ['+label+']: '+JSON.stringify(snapshot));
      }catch(snapshotError){
        t.diagnostic('Chromium failure snapshot unavailable ['+label+']: '+String(snapshotError));
      }
      throw error;
    }
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
  // P2.65bv: capture two persistent touch leases on the actual page BEFORE
  // navigating away. A genuine BFCache restoration must not revive them.
  const beforeBfcacheGesture=await evalOn(a,'localStorage.getItem('+JSON.stringify(key)+')');
  await evalOn(a,`(()=>{
    for(const id of ['reset','export-local-save']){
      document.getElementById(id).dispatchEvent(new PointerEvent('pointerdown',
        {bubbles:true,pointerType:'touch',isPrimary:true}));
    }
    return true;
  })()`);
  await call('Page.navigate',{url:base+'/merge/absent-test-page'},a.sessionId);
  await until(async()=>await evalOn(a,`document.readyState==='complete'&&location.pathname.includes('absent-test-page')`),'away navigation');
  const history=await call('Page.getNavigationHistory',{},a.sessionId);
  await call('Page.navigateToHistoryEntry',{entryId:history.entries[history.currentIndex-1].id},a.sessionId);
  await until(async()=>await evalOn(a,`location.pathname==='/merge/index.html'&&!!document.getElementById('save-status')`),'history restoration');
  await until(async()=>await evalOn(a,`document.querySelector('#save-status').textContent.includes('已保存')||document.querySelector('#save-status').textContent.includes('已同步')`),'verified after history');
  const bfcache=await evalOn(a,`sessionStorage.getItem('merge-bfcache')`);
  assert.equal(bfcache,'true','This gate requires a genuine pageshow.persisted BFCache restoration');
  assert.equal((await readSave(a)).revision,after.revision+1);

  // The restored document has the same buttons and save bytes, but its
  // pagehide invalidated the earlier pointerdown generation. Neither a late
  // reset click nor a late export click may be treated as fresh consent.
  await evalOn(a,`(()=>{
    window.__bvResetConfirms=0;
    window.confirm=()=>{window.__bvResetConfirms++;return false;};
    window.__bvAnchorClicks=0;
    window.__bvOriginalAnchorClick=HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click=function(){window.__bvAnchorClicks++;};
    for(const id of ['reset','export-local-save']){
      document.getElementById(id).dispatchEvent(new MouseEvent('click',
        {bubbles:true,detail:1}));
    }
    return true;
  })()`);
  await sleep(80);
  assert.equal(await evalOn(a,'window.__bvResetConfirms'),0,
    'BFCache must reject the pre-pagehide reset pointer even when bytes match');
  assert.equal(await evalOn(a,'window.__bvAnchorClicks'),0,
    'BFCache must reject the pre-pagehide export pointer');
  assert.equal(await evalOn(a,'localStorage.getItem('+JSON.stringify(key)+')'),
    beforeBfcacheGesture,'late BFCache touch clicks must not mutate save bytes');
  await evalOn(a,`(()=>{
    const button=document.getElementById('reset');
    button.dispatchEvent(new PointerEvent('pointerdown',
      {bubbles:true,pointerType:'touch',isPrimary:true}));
    button.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));
    return true;
  })()`);
  assert.equal(await evalOn(a,'window.__bvResetConfirms'),1,
    'a new post-BFCache touch may reach a fresh, declined reset confirmation');
  assert.equal(await evalOn(a,'localStorage.getItem('+JSON.stringify(key)+')'),
    beforeBfcacheGesture,'declined fresh reset must preserve the original bytes');
  await evalOn(a,'HTMLAnchorElement.prototype.click=window.__bvOriginalAnchorClick;true');
  t.diagnostic('Chromium genuine BFCache revoked stale reset/export touches and allowed a fresh reset confirmation');

  await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:temp});
  await front(a);
  await evalOn(a,`(()=>{
    const button=document.getElementById('export-local-save');
    button.dispatchEvent(new PointerEvent('pointerdown',
      {bubbles:true,pointerType:'touch',isPrimary:true}));
    button.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));
    return true;
  })()`);
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
  // A just committed another producer action. A reset confirmation must be
  // made against the latest reviewed B-tab board, not a stale UI that will
  // correctly reject its first destructive click during reconciliation.
  await until(async()=>await evalOn(b,`document.querySelector('#energy').textContent.startsWith(${JSON.stringify(String(savedSnapshot.energy)+' /')})`),'reset tab adopted latest progress');
  await evalOn(b,`window.confirm=()=>true;document.getElementById('reset').click();true`);
  // A background clock or a cross-tab reconciliation can legitimately hold
  // the same lock during the first click. Retry only if the exact reviewed
  // snapshot is still unchanged; never confirm against unseen new progress.
  let resetCompleted=false;
  try{
    await until(async()=>{
      const current=await readSave(b);
      return current.revision===0&&current.energy>savedSnapshot.energy;
    },'first reset attempt',3000);
    resetCompleted=true;
  }catch{
    const still=await readSave(b);
    assert.deepEqual(still,savedSnapshot,'reset retry requires unchanged reviewed baseline');
    t.diagnostic('First reset click was rejected while save remained unchanged; retrying after lock settles');
    await sleep(250);
    await evalOn(b,`document.getElementById('reset').click();true`);
  }
  if(!resetCompleted)await until(async()=>{
    const current=await readSave(b);
    return current.revision===0&&current.energy>savedSnapshot.energy;
  },'confirmed reset persisted');
  const resetRaw=await evalOn(b,`localStorage.getItem(${JSON.stringify(key)})`);
  const resetSnapshot=JSON.parse(resetRaw);
  assert.notDeepEqual(resetSnapshot,savedSnapshot,'reset must not retain the prior progress');
  // Storage persistence can precede the async UI publication. Do not start a
  // destructive import against a reset not yet displayed to the player.
  await until(async()=>await evalOn(b,`document.getElementById('save-status').textContent.includes('已保存于此浏览器')&&
    document.querySelector('#energy').textContent.startsWith(${JSON.stringify(String(resetSnapshot.energy)+' /')})&&
    !document.getElementById('import-normal-save').disabled`),
    'reset UI published before import');
  await front(a);
  // A reset lowers revision. A tab holding the older higher revision MUST
  // block rather than silently adopting a rollback or resurrecting old data.
  await until(async()=>await evalOn(a,`document.getElementById('save-status').textContent.includes('已暂停')`),'stale tab blocked after cross-tab reset');
  await evalOn(a,`document.querySelector('#board .producer').click();true`);
  assert.equal(await evalOn(a,`localStorage.getItem(${JSON.stringify(key)})`),resetRaw,
    'blocked old tab must not resurrect progress after another tab resets');
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
  await waitWithSnapshot(async()=>{
    const current=await readSave(b);
    return current.revision===savedSnapshot.revision&&current.energy===savedSnapshot.energy;
  },'downloaded save restored after reset',b);
  assert.deepEqual(await readSave(b),savedSnapshot,'restored state must match downloaded JSON');
  const backup=await evalOn(b,`localStorage.getItem(${JSON.stringify(key+'.restore-backup-v3')})`);
  assert.equal(backup,resetRaw,'restore must preserve the exact pre-restore reset bytes');
  await front(a);
  // Once blocked by a cross-tab reset, an old tab must reload to regain a
  // verified baseline; merely receiving a later storage event is not enough.
  await call('Page.reload',{ignoreCache:true},a.sessionId);
  await until(async()=>await evalOn(a,`document.readyState==='complete'&&
    document.getElementById('save-status')?.textContent.includes('已保存于此浏览器')&&
    document.querySelector('#energy')?.textContent.startsWith(${JSON.stringify(String(savedSnapshot.energy)+' /')})`),'reloaded tab verified restored save');

  // Real-browser negative recovery chain: invalid input, canceled native
  // chooser, then a second tab changing the save during file selection.
  // All failures must leave the original bytes and recovery backup intact.
  await front(b);
  const originalRaw=await evalOn(b,`localStorage.getItem(${JSON.stringify(key)})`);
  const originalBackup=await evalOn(b,`localStorage.getItem(${JSON.stringify(key+'.restore-backup-v3')})`);
  await evalOn(b,`(()=>{
    window.__importConfirmCount=0;
    window.confirm=()=>{window.__importConfirmCount++;return true;};
    const input=document.getElementById('import-normal-file');
    input.click=()=>{};
    document.getElementById('import-normal-save').click();
    const transfer=new DataTransfer();
    transfer.items.add(new File(['{"broken":'],'invalid-normal.json',{type:'application/json'}));
    input.files=transfer.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`);
  await until(async()=>await evalOn(b,`document.getElementById('notice').textContent.includes('导入预检或恢复未通过')`),'invalid JSON rejected');
  assert.equal(await evalOn(b,`localStorage.getItem(${JSON.stringify(key)})`),originalRaw,'invalid import must preserve exact save bytes');
  assert.equal(await evalOn(b,`localStorage.getItem(${JSON.stringify(key+'.restore-backup-v3')})`),originalBackup,'invalid import must not overwrite recovery backup');
  assert.equal(await evalOn(b,'window.__importConfirmCount'),0,'invalid JSON must not ask for destructive confirmation');

  const detached=await evalOn(b,`(()=>{
    const input=document.getElementById('import-normal-file');
    input.click=()=>{};
    document.getElementById('import-normal-save').click();
    document.getElementById('cancel-normal-import').click();
    const replacement=document.getElementById('import-normal-file');
    const transfer=new DataTransfer();
    transfer.items.add(new File([${JSON.stringify(downloaded)}],'stale-chooser.json',{type:'application/json'}));
    input.files=transfer.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
    return {replaced:input!==replacement,cancelHidden:document.getElementById('cancel-normal-import').hidden};
  })()`);
  assert.deepEqual(detached,{replaced:true,cancelHidden:true},'canceled chooser must replace the input and dismiss its waiting UI');
  assert.equal(await evalOn(b,`localStorage.getItem(${JSON.stringify(key)})`),originalRaw,'late event from detached input must not restore');
  assert.equal(await evalOn(b,'window.__importConfirmCount'),0,'late canceled input must not request confirmation');

  const pickerStarted=await evalOn(b,`(()=>{
    const input=document.getElementById('import-normal-file');
    input.click=()=>{};
    document.getElementById('import-normal-save').click();
    return !document.getElementById('cancel-normal-import').hidden;
  })()`);
  assert.equal(pickerStarted,true,'cross-tab race must start with a live pending chooser');
  const beforeConcurrent=await readSave(b);
  await front(a);
  await evalOn(a,`document.querySelector('#board .producer').click();true`);
  await until(async()=>(await readSave(a)).revision===beforeConcurrent.revision+1,'other tab saved during chooser');
  const changedRaw=await evalOn(a,`localStorage.getItem(${JSON.stringify(key)})`);
  const changedState=JSON.parse(changedRaw);
  await front(b);
  await until(async()=>await evalOn(b,`document.querySelector('#energy').textContent.startsWith(${JSON.stringify(String(changedState.energy)+' /')})`),'chooser tab reconciled external progress');
  await evalOn(b,`(()=>{
    const input=document.getElementById('import-normal-file');
    const transfer=new DataTransfer();
    transfer.items.add(new File([${JSON.stringify(downloaded)}],'stale-baseline.json',{type:'application/json'}));
    input.files=transfer.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`);
  await until(async()=>await evalOn(b,`document.getElementById('notice').textContent.includes('文件选择期间页面或存档已变化')`),'stale chooser rejected after cross-tab update');
  assert.equal(await evalOn(b,`localStorage.getItem(${JSON.stringify(key)})`),changedRaw,'stale chooser must not roll back newer tab progress');
  assert.equal(await evalOn(b,`localStorage.getItem(${JSON.stringify(key+'.restore-backup-v3')})`),originalBackup,'stale chooser must not replace recovery backup');
  assert.equal(await evalOn(b,'window.__importConfirmCount'),0,'stale chooser must not show destructive confirmation');
  // The locked transaction publishes its save bytes before the UI flight
  // finishes. A revision-only poll can therefore race the next import click:
  // observe the real gameplay success notice, emitted after runtime.action()
  // settles, instead of adding an arbitrary CI timing delay.
  await evalOn(b,`(()=>{
    window.__postChooserActionFinished=false;
    const notice=document.getElementById('notice');
    const observer=new MutationObserver(()=>{
      if(notice.textContent.startsWith('获得 ')){
        window.__postChooserActionFinished=true;
        observer.disconnect();
      }
    });
    observer.observe(notice,{childList:true,characterData:true,subtree:true});
    document.querySelector('#board .producer').click();
    return true;
  })()`);
  await until(async()=>(await readSave(b)).revision===changedState.revision+1,'fresh gameplay after rejected chooser');
  await waitWithSnapshot(async()=>await evalOn(b,
    "window.__postChooserActionFinished===true && "+
    "document.getElementById('save-status').textContent.includes('已保存于此浏览器') && "+
    "!document.getElementById('import-normal-save').disabled && "+
    "document.getElementById('cancel-normal-import').hidden"),
    'fresh gameplay UI flight settled before chooser lease',b);
  // P2.65bd: while a native file chooser is pending, neither a destructive
  // reset nor a backup download may proceed on a possibly stale baseline.
  // Use a chooser stub only; real browser storage, buttons and Web Locks remain live.
  await front(b);
  const chooserLeaseRaw=await evalOn(b,`localStorage.getItem(${JSON.stringify(key)})`);
  const chooserLeaseBackup=await evalOn(b,`localStorage.getItem(${JSON.stringify(key+'.restore-backup-v3')})`);
  const downloadsBeforeLease=(await readdir(temp)).filter(name=>name.endsWith('.json')||name.endsWith('.txt')).length;
  const chooserLease=await evalOn(b,`(()=>{
    window.__blockedResetConfirms=0;
    window.confirm=()=>{window.__blockedResetConfirms++;return true;};
    const input=document.getElementById('import-normal-file');
    input.click=()=>{};
    document.getElementById('import-normal-save').click();
    return !document.getElementById('cancel-normal-import').hidden;
  })()`);
  assert.equal(chooserLease,true,'native chooser lease must be active');
  await evalOn(b,`document.getElementById('reset').click();document.getElementById('export-local-save').click();true`);
  await sleep(120);
  assert.equal(await evalOn(b,'window.__blockedResetConfirms'),0,
    'reset must not ask for confirmation while chooser is pending');
  assert.equal(await evalOn(b,`localStorage.getItem(${JSON.stringify(key)})`),chooserLeaseRaw,
    'reset blocked by chooser must preserve exact save bytes');
  assert.equal(await evalOn(b,`localStorage.getItem(${JSON.stringify(key+'.restore-backup-v3')})`),chooserLeaseBackup,
    'blocked reset must preserve exact restore backup bytes');
  assert.equal((await readdir(temp)).filter(name=>name.endsWith('.json')||name.endsWith('.txt')).length,
    downloadsBeforeLease,'export must not initiate a download while chooser is pending');
  await evalOn(b,`document.getElementById('cancel-normal-import').click();true`);
  await until(async()=>await evalOn(b,`document.getElementById('cancel-normal-import').hidden`),
    'chooser cancellation releases pending UI');
  assert.equal(await evalOn(b,`localStorage.getItem(${JSON.stringify(key)})`),chooserLeaseRaw,
    'canceling a pending chooser must not mutate save');
  t.diagnostic('Chromium pending chooser blocked reset and export without touching save/backup');

  // P2.65be: a native chooser may deliver its File change while the tab is
  // hidden. No confirmation, read/restore or backup overwrite is allowed
  // until the page returns and its lifecycle reconciliation has run.
  await front(b);
  const hiddenChooserRaw=await evalOn(b,`localStorage.getItem(${JSON.stringify(key)})`);
  const hiddenChooserBackup=await evalOn(b,`localStorage.getItem(${JSON.stringify(key+'.restore-backup-v3')})`);
  const hiddenPickerOpen=await evalOn(b,`(()=>{
    window.__hiddenChooserConfirmStates=[];
    window.confirm=()=>{window.__hiddenChooserConfirmStates.push(document.hidden);return false;};
    const input=document.getElementById('import-normal-file');
    input.click=()=>{};
    document.getElementById('import-normal-save').click();
    return !document.getElementById('cancel-normal-import').hidden;
  })()`);
  assert.equal(hiddenPickerOpen,true,'hidden chooser must start with an active import lease');
  await front(a);
  await until(async()=>await evalOn(b,'document.hidden'),'chooser tab hidden before file selection');
  await evalOn(b,`(()=>{
    const input=document.getElementById('import-normal-file');
    const transfer=new DataTransfer();
    transfer.items.add(new File([${JSON.stringify(downloaded)}],'hidden-chooser.json',{type:'application/json'}));
    input.files=transfer.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`);
  assert.deepEqual(await evalOn(b,'window.__hiddenChooserConfirmStates'),[],
    'hidden file selection must not invoke a destructive confirmation');
  assert.equal(await evalOn(b,`localStorage.getItem(${JSON.stringify(key)})`),hiddenChooserRaw,
    'hidden file selection must not write the save');
  assert.equal(await evalOn(b,`localStorage.getItem(${JSON.stringify(key+'.restore-backup-v3')})`),hiddenChooserBackup,
    'hidden file selection must not replace the backup');
  await front(b);
  await until(async()=>!await evalOn(b,'document.hidden'),'chooser tab returned to foreground');
  await waitWithSnapshot(async()=>await evalOn(b,`document.getElementById('cancel-normal-import').hidden`),
    'hidden chooser settled after foreground reconciliation',b);
  assert.deepEqual(await evalOn(b,'window.__hiddenChooserConfirmStates').then(states=>states.filter(Boolean)),[],
    'no hidden-state confirmation may occur during chooser return');
  assert.equal(await evalOn(b,`localStorage.getItem(${JSON.stringify(key)})`),hiddenChooserRaw,
    'declined or rejected hidden chooser must preserve save bytes');
  assert.equal(await evalOn(b,`localStorage.getItem(${JSON.stringify(key+'.restore-backup-v3')})`),hiddenChooserBackup,
    'declined or rejected hidden chooser must preserve backup bytes');

  // A second background transition is not one native chooser roundtrip:
  // revoke the stale chooser and its visible cancel UI immediately. Any
  // delayed change from that input must remain unable to restore progress.
  await waitWithSnapshot(async()=>await evalOn(b,
    "document.getElementById('cancel-normal-import').hidden&&"+
    "!document.getElementById('import-normal-save').disabled"),
    'previous hidden chooser fully released before next selection',b);
  await evalOn(b,`(()=>{
    window.__doubleHideConfirms=0;
    window.confirm=()=>{window.__doubleHideConfirms++;return true;};
    const input=document.getElementById('import-normal-file');
    input.click=()=>{};
    document.getElementById('import-normal-save').click();
    return true;
  })()`);
  await waitWithSnapshot(async()=>await evalOn(b,
    "!document.getElementById('cancel-normal-import').hidden"),
    'double-hide scenario begins with active chooser',b);
  await front(a);
  await until(async()=>await evalOn(b,'document.hidden'),'first chooser background');
  await front(b);
  await until(async()=>!await evalOn(b,'document.hidden'),'first chooser foreground');
  await front(a);
  await until(async()=>await evalOn(b,'document.hidden'),'second chooser background');
  await waitWithSnapshot(async()=>await evalOn(b,`document.getElementById('cancel-normal-import').hidden`),
    'second hide must revoke orphaned chooser cancel UI',b);
  await front(b);
  await until(async()=>!await evalOn(b,'document.hidden'),'second chooser foreground');
  await evalOn(b,`(()=>{
    const input=document.getElementById('import-normal-file');
    const transfer=new DataTransfer();
    transfer.items.add(new File([${JSON.stringify(downloaded)}],'twice-hidden-stale.json',{type:'application/json'}));
    input.files=transfer.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`);
  await until(async()=>await evalOn(b,`document.getElementById('notice').textContent.includes('文件选择期间页面或存档已变化')`),
    'twice-hidden stale chooser rejected');
  assert.equal(await evalOn(b,'window.__doubleHideConfirms'),0,
    'twice-hidden chooser must not request destructive confirmation');
  assert.equal(await evalOn(b,`localStorage.getItem(${JSON.stringify(key)})`),hiddenChooserRaw,
    'twice-hidden stale chooser must preserve save');
  assert.equal(await evalOn(b,`localStorage.getItem(${JSON.stringify(key+'.restore-backup-v3')})`),hiddenChooserBackup,
    'twice-hidden stale chooser must preserve backup');
  t.diagnostic('Chromium hidden chooser deferral, second-hide cancellation and stale file rejection verified');

  t.diagnostic('Chromium invalid import, detached chooser, cross-tab chooser baseline and recovery-backup integrity verified');

  // P2.65aw: exercise the actual page under mobile viewport metrics, not
  // a static stylesheet grep. This is Chromium emulation, NOT iPhone/WeChat.
  await front(b);
  await call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1},b.sessionId);
  for(const width of [320,375,390,430,768]){
    await call('Emulation.setDeviceMetricsOverride',{
      width,height:812,deviceScaleFactor:3,mobile:true,screenWidth:width,screenHeight:812
    },b.sessionId);
    await call('Emulation.setEmulatedMedia',{
      features:[{name:'prefers-reduced-motion',value:'reduce'}]
    },b.sessionId);
    await sleep(90);
    const layout=await evalOn(b,`(()=>{
      const width=window.innerWidth;
      const visible=el=>{
        const s=getComputedStyle(el),r=el.getBoundingClientRect();
        return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;
      };
      const bounds=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,height:r.height,width:r.width}};
      const critical=[...document.querySelectorAll('.shell,.board-section,#board,.resource-bar,.save-actions,.supply-section,.orders-section,.management-section,button,select')].filter(visible);
      const clipped=critical.filter(el=>{if(width<=360&&(el.id==='board'||el.closest('#board')))return false;const r=bounds(el);return r.left < -1||r.right > width+1;}).map(el=>el.id||el.className).slice(0,12);
      const targets=[...document.querySelectorAll('.order-button,.small-action,.secondary-action,.guide-action,.save-actions button,#how-to,.back-link,.supply-select')].filter(visible);
      const tooShort=targets.filter(el=>bounds(el).height<43.5).map(el=>el.id||el.className).slice(0,12);
      const minSize=selector=>Math.min(...[...document.querySelectorAll(selector)].filter(visible).map(el=>bounds(el).width),999);
      return {width,scrollWidth:document.documentElement.scrollWidth,clipped,tooShort,
        boardMin:minSize('#board .cell'),warehouseMin:minSize('#warehouse .warehouse-slot'),
        boardScrollRange:document.querySelector('.board-section').scrollWidth-document.querySelector('.board-section').clientWidth,
        warehouseColumns:getComputedStyle(document.querySelector('#warehouse')).gridTemplateColumns.split(' ').length,
        orderColumns:getComputedStyle(document.querySelector('#orders')).gridTemplateColumns.split(' ').length,
        reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches};
    })()`);
    assert.equal(layout.width,width,'mobile viewport width must match CDP device metrics');
    assert.ok(layout.scrollWidth<=width+1,`horizontal document overflow at ${width}px: ${JSON.stringify(layout)}`);
    assert.deepEqual(layout.clipped,[],`clipped controls at ${width}px`);
    assert.deepEqual(layout.tooShort,[],`undersized non-board touch targets at ${width}px`);
    assert.ok(layout.warehouseMin>=44,`warehouse slots below 44px at ${width}px`);
    assert.ok(layout.boardMin>=44,`board targets below 44px at ${width}px`);
    if(width<=360){
      assert.ok(layout.boardScrollRange>0,'320px board must scroll inside its section, not overflow the document');
      const reached=await evalOn(b,`(()=>{
        const section=document.querySelector('.board-section');
        section.scrollLeft=section.scrollWidth;
        const cell=document.querySelector('#board .cell[data-slot="6"]').getBoundingClientRect();
        return {scrollLeft:section.scrollLeft,left:cell.left,right:cell.right};
      })()`);
      assert.ok(reached.scrollLeft>0&&reached.left>=-1&&reached.right<=width+1,
        `last board column must be reachable inside the 320px viewport: ${JSON.stringify(reached)}`);
    }
    assert.equal(layout.warehouseColumns,width<=480?4:8,'warehouse responsive columns');
    assert.equal(layout.orderColumns,width<=480?2:3,'order responsive columns');
    assert.equal(layout.reducedMotion,true,'reduced-motion emulation must be active');
    t.diagnostic(`Chromium mobile viewport ${width}px: no overflow; board min ${layout.boardMin.toFixed(1)}px; warehouse min ${layout.warehouseMin.toFixed(1)}px`);
  }

  // P2.65bg: real CDP touch pan plus cross-scroll two-tap movement at 320px.
  await call('Emulation.setDeviceMetricsOverride',{
    width:320,height:812,deviceScaleFactor:3,mobile:true,screenWidth:320,screenHeight:812
  },b.sessionId);
  await front(b);
  await sleep(220);
  const beforeNarrow=await readSave(b);
  const panStart=await evalOn(b,'(()=>{const s=document.querySelector(".board-section");s.scrollIntoView({block:"center"});s.scrollLeft=0;const r=document.querySelectorAll("#board .cell")[3].getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()');
  assert.ok(panStart.x>110&&panStart.x<300&&panStart.y>0&&panStart.y<812,
    '320px native pan must start on a visible board cell');
  await sleep(120);
  await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[
    {...panStart,id:20,radiusX:2,radiusY:2,force:1}
  ]},b.sessionId);
  for(const delta of [35,70,110]){
    await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[
      {x:panStart.x-delta,y:panStart.y,id:20,radiusX:2,radiusY:2,force:1}
    ]},b.sessionId);
    await sleep(65);
  }
  await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]},b.sessionId);
  await until(async()=>await evalOn(b,'document.querySelector(".board-section").scrollLeft>4'),
    '320px native touch gesture pans the board');
  assert.deepEqual(await readSave(b),beforeNarrow,'panning must not modify the save');
  assert.equal(await evalOn(b,'document.querySelectorAll(".drag-ghost").length'),0,
    'panning must not leave a drag ghost');
  const narrowPair=await evalOn(b,'(()=>{const a=JSON.parse(localStorage.getItem("toolbox.merge-isle.local.v1")).board;return {from:a.findIndex(x=>x?.kind==="material"),to:a.findIndex((x,i)=>!x&&i%7===6)};})()');
  assert.ok(narrowPair.from>=0&&narrowPair.to>=0,'need material and last-column vacancy');
  assert.equal(await evalOn(b,'document.querySelectorAll("#board .cell.selected").length'),0,
    'two-tap move must start without stale selection');
  async function narrowTap(slot,id){
    const p=await evalOn(b,'(()=>{const el=document.querySelectorAll("#board .cell")['+slot+'];el.scrollIntoView({block:"center",inline:"nearest"});const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()');
    assert.ok(p.x>0&&p.x<320&&p.y>0&&p.y<812,'tap must be on screen');
    await until(async()=>await evalOn(b,'document.elementFromPoint('+p.x+','+p.y+')?.closest?.("[data-slot]")?.dataset.slot==="'+slot+'"'),
      '320px hit test after scrolling');
    await sleep(100);
    await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[
      {...p,id,radiusX:2,radiusY:2,force:1}
    ]},b.sessionId);
    await sleep(75);
    await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]},b.sessionId);
  }
  await narrowTap(narrowPair.from,21);
  await until(async()=>await evalOn(b,'document.querySelector("#board .cell.selected")?.dataset.slot==="'+narrowPair.from+'"'),
    'first tap selects material');
  assert.deepEqual(await readSave(b),beforeNarrow,'selection must not write');
  await narrowTap(narrowPair.to,22);
  await waitWithSnapshot(async()=>(await readSave(b)).revision===beforeNarrow.revision+1,
    '320px cross-scroll move saved once',b);
  const afterNarrow=await readSave(b);
  assert.deepEqual(afterNarrow.board[narrowPair.to],beforeNarrow.board[narrowPair.from],
    'last-column target must receive original material');
  assert.equal(afterNarrow.board[narrowPair.from],null,'source must be cleared');
  assert.equal(afterNarrow.energy,beforeNarrow.energy,'movement must not spend energy');
  await sleep(150);
  assert.equal((await readSave(b)).revision,beforeNarrow.revision+1,
    'compatibility click must not duplicate move');
  t.diagnostic('Chromium 320px native touch pan and cross-scroll two-tap move verified');

  // P2.65bh: verify vertical page scrolling is not trapped by the narrow
  // board's horizontal scroller. Also prove save controls remain reachable
  // after a real gesture; this is Chromium emulation, not physical iOS.
  const verticalPoint=await evalOn(b,`(()=>{
    const cell=document.querySelector('#board .cell[data-slot="3"]');
    cell.scrollIntoView({block:'center',inline:'nearest'});
    const r=cell.getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2};
  })()`);
  assert.ok(verticalPoint.x>0&&verticalPoint.x<320&&verticalPoint.y>170&&verticalPoint.y<812,
    'vertical gesture must begin on a visible board cell with travel room');
  await sleep(120);
  const verticalBefore=await evalOn(b,`({
    y:window.scrollY,x:document.querySelector('.board-section').scrollLeft
  })`);
  const verticalSave=await readSave(b);
  await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[
    {...verticalPoint,id:23,radiusX:2,radiusY:2,force:1}
  ]},b.sessionId);
  for(const delta of [40,85,135]){
    await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[
      {x:verticalPoint.x,y:verticalPoint.y-delta,id:23,radiusX:2,radiusY:2,force:1}
    ]},b.sessionId);
    await sleep(65);
  }
  await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]},b.sessionId);
  await until(async()=>await evalOn(b,`window.scrollY>${verticalBefore.y}+8`),
    '320px vertical swipe must scroll the document');
  await sleep(160);
  const verticalAfter=await evalOn(b,`({
    y:window.scrollY,x:document.querySelector('.board-section').scrollLeft,
    ghosts:document.querySelectorAll('.drag-ghost').length
  })`);
  assert.ok(Math.abs(verticalAfter.x-verticalBefore.x)<5,
    'vertical swipe must not unexpectedly pan the board sideways');
  assert.equal(verticalAfter.ghosts,0,'vertical swipe must leave no drag ghost');
  assert.deepEqual(await readSave(b),verticalSave,'vertical swipe must not change save');

  // Native scrollIntoView and elementFromPoint must locate each control even
  // if the board was horizontally panned and the page vertically scrolled.
  for(const id of ['export-local-save','export-abnormal-reset-backup','reset','import-normal-save']){
    const point=await evalOn(b,`(()=>{
      const el=document.getElementById(${JSON.stringify(id)});
      if(!el)return null;
      el.scrollIntoView({block:'center',inline:'nearest'});
      const r=el.getBoundingClientRect();
      return {x:r.left+r.width/2,y:r.top+r.height/2,disabled:el.disabled};
    })()`);
    assert.ok(point&&!point.disabled&&point.x>0&&point.x<320&&point.y>0&&point.y<812,
      '320px save control must be enabled and onscreen: '+id);
    await until(async()=>await evalOn(b,`document.elementFromPoint(${point.x},${point.y})?.closest('button')?.id===${JSON.stringify(id)}`),
      '320px save control hit test: '+id);
  }
  await evalOn(b,`(()=>{
    document.getElementById('notice').textContent='';
    document.getElementById('export-local-save').click();
    return true;
  })()`);
  await until(async()=>await evalOn(b,`/下载|导出/.test(document.getElementById('notice').textContent)`),
    '320px export control must handle click after panning');
  assert.deepEqual(await readSave(b),verticalSave,
    'export after vertical/horizontal panning must not write game state');
  t.diagnostic('Chromium 320px vertical page pan, save-control hit testing and export click verified');


  // Dispatch a native CDP touch sequence on the actual producer and assert
  // exactly one saved action (not a duplicate synthetic compatibility click).
  await call('Emulation.setDeviceMetricsOverride',{
    width:390,height:844,deviceScaleFactor:3,mobile:true,screenWidth:390,screenHeight:844
  },b.sessionId);
  await front(b);
  // CDP device-metrics changes dispatch asynchronous resize/layout events.
  // Allow the final viewport and page lifecycle to settle before pointerdown.
  await sleep(350);
  const beforeTouch=await readSave(b);
  const center=await evalOn(b,`(()=>{
    const el=document.querySelector('#board .producer');
    el.scrollIntoView({block:'center',inline:'nearest'});
    const r=el.getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2};
  })()`);
  assert.ok(center.x>0&&center.x<390&&center.y>0&&center.y<844,'producer must be onscreen for native touch');
  await sleep(150);
  await evalOn(b,`(()=>{
    window.__touchTrace=[];
    for(const type of ['touchstart','touchend','touchcancel','pointerdown','pointerup','pointercancel','lostpointercapture','click'])
      document.addEventListener(type,event=>window.__touchTrace.push({
        type,target:event.target?.className,detail:event.detail,
        slot:event.target?.closest?.('[data-slot]')?.dataset.slot,
        isPrimary:event.isPrimary,pointerType:event.pointerType,
        x:event.clientX,y:event.clientY
      }),true);
    return true;
  })()`);
  await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[
    {x:center.x,y:center.y,id:1,radiusX:2,radiusY:2,force:1}
  ]},b.sessionId);
  await sleep(75);
  await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]},b.sessionId);
  const trace=await evalOn(b,`({
    events:window.__touchTrace,
    hidden:document.hidden,
    hit:document.elementFromPoint(${center.x},${center.y})?.className,
    notice:document.getElementById('notice').textContent,
    status:document.getElementById('save-status').textContent,
  })`);
  t.diagnostic('CDP native touch trace: '+JSON.stringify({beforeRevision:beforeTouch.revision,...trace}));
  // A resize/foreground reconciliation may reject the first tap against
  // an obsolete rendered board. Permit a second physical gesture ONLY when
  // the first was explicitly refused and left the exact save unchanged.
  // Unknown touch failures, duplicate writes or silent retries remain errors.
  try {
    await until(async()=>(await readSave(b)).revision===beforeTouch.revision+1,
      'first native touch producer persisted',2200);
  } catch {
    assert.deepEqual(await readSave(b),beforeTouch,
      'first safely rejected touch must preserve the complete original save');
    assert.equal(trace.hidden,false,'retry requires a visible page');
    assert.match(trace.notice,/存档已更新或正在保存，请在最新棋盘上重新操作/,
      'only the explicit stale-board refusal authorizes a new gesture');
    const freshCenter=await evalOn(b,`(()=>{
      const el=document.querySelector('#board .producer');
      el.scrollIntoView({block:'center',inline:'nearest'});
      const r=el.getBoundingClientRect();
      return {x:r.left+r.width/2,y:r.top+r.height/2};
    })()`);
    await until(async()=>await evalOn(b,
      "document.elementFromPoint("+freshCenter.x+","+freshCenter.y+")?.closest('.producer')!==null"),
      'retry producer is the actual hit target');
    await sleep(160);
    await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[
      {...freshCenter,id:24,radiusX:2,radiusY:2,force:1}
    ]},b.sessionId);
    await sleep(75);
    await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]},b.sessionId);
    await waitWithSnapshot(async()=>(await readSave(b)).revision===beforeTouch.revision+1,
      'new physical touch after explicit stale-board refusal',b);
    t.diagnostic('First native producer touch safely rejected stale board; second distinct gesture saved');
  }
  await sleep(250);
  const afterTouch=await readSave(b);
  assert.equal(afterTouch.revision,beforeTouch.revision+1,'touch compatibility click must not duplicate production');
  assert.equal(afterTouch.energy,beforeTouch.energy-1,'touch must consume exactly one energy');
  t.diagnostic('Chromium mobile-emulated physical touch protocol: exactly one producer write');


  // P2.65ax: native touch drag, OS cancellation and fresh-touch recovery.
  // Dispatch real CDP touch sequences, never synthetic DOM pointer events.
  const dragGeometry=await evalOn(b,`(()=>{
    const save=JSON.parse(localStorage.getItem("toolbox.merge-isle.local.v1"));
    const from=save.board.findIndex(item=>item?.kind==='material');
    if(from<0)throw Error('No material to drag');
    const candidates=save.board.map((item,i)=>item?null:i).filter(i=>i!==null);
    if(!candidates.length)throw Error('No empty destination');
    const distance=i=>Math.hypot((i%7)-(from%7),Math.floor(i/7)-Math.floor(from/7));
    const to=candidates.sort((x,y)=>distance(x)-distance(y))[0];
    document.getElementById('board').scrollIntoView({block:'center'});
    const center=i=>{
      const r=document.querySelector('#board [data-slot="'+i+'"]').getBoundingClientRect();
      return {x:r.left+r.width/2,y:r.top+r.height/2};
    };
    return {from,to,start:center(from),end:center(to)};
  })()`);
  for(const point of [dragGeometry.start,dragGeometry.end])
    assert.ok(point.x>0&&point.x<390&&point.y>0&&point.y<844,'drag targets must be onscreen');
  await sleep(160);
  const beforeDrag=await readSave(b);
  const movedItem=beforeDrag.board[dragGeometry.from];
  assert.ok(movedItem?.kind==='material','native drag must start on material');
  await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[
    {...dragGeometry.start,id:2,radiusX:2,radiusY:2,force:1}
  ]},b.sessionId);
  await sleep(65);
  await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[
    {x:(dragGeometry.start.x+dragGeometry.end.x)/2,
     y:(dragGeometry.start.y+dragGeometry.end.y)/2,id:2,radiusX:2,radiusY:2,force:1}
  ]},b.sessionId);
  await sleep(65);
  await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[
    {...dragGeometry.end,id:2,radiusX:2,radiusY:2,force:1}
  ]},b.sessionId);
  await sleep(65);
  await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]},b.sessionId);
  await until(async()=>(await readSave(b)).revision===beforeDrag.revision+1,
    'native material drag persisted exactly once');
  await sleep(250);
  const afterDrag=await readSave(b);
  assert.equal(afterDrag.revision,beforeDrag.revision+1,'native drag must not double-write');
  assert.equal(afterDrag.board[dragGeometry.from],null,'drag source must be empty');
  assert.deepEqual(afterDrag.board[dragGeometry.to],movedItem,'destination must retain material');
  assert.equal(afterDrag.energy,beforeDrag.energy,'dragging must not spend energy');
  assert.equal(await evalOn(b,`document.querySelectorAll('.drag-ghost').length`),0,
    'drag ghost must be removed after pointerup');

  // OS touch cancellation must never commit a half-finished move.
  const cancelGeometry=await evalOn(b,`(()=>{
    const save=JSON.parse(localStorage.getItem("toolbox.merge-isle.local.v1"));
    const from=${dragGeometry.to};
    const to=save.board.findIndex((item,i)=>!item&&i!==from);
    if(to<0)throw Error('No empty cancellation target');
    document.getElementById('board').scrollIntoView({block:'center'});
    const center=i=>{
      const r=document.querySelector('#board [data-slot="'+i+'"]').getBoundingClientRect();
      return {x:r.left+r.width/2,y:r.top+r.height/2};
    };
    return {start:center(from),end:center(to)};
  })()`);
  for(const point of [cancelGeometry.start,cancelGeometry.end])
    assert.ok(point.x>0&&point.x<390&&point.y>0&&point.y<844,'cancel targets must be onscreen');
  await sleep(120);
  await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[
    {...cancelGeometry.start,id:3,radiusX:2,radiusY:2,force:1}
  ]},b.sessionId);
  await sleep(65);
  await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[
    {...cancelGeometry.end,id:3,radiusX:2,radiusY:2,force:1}
  ]},b.sessionId);
  await sleep(65);
  await call('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]},b.sessionId);
  await sleep(300);
  const afterCancel=await readSave(b);
  assert.deepEqual(afterCancel,afterDrag,'OS touch cancellation must preserve save');
  assert.equal(await evalOn(b,`document.querySelectorAll('.drag-ghost').length`),0,
    'cancelled touch must remove the ghost');
  const newProducer=await evalOn(b,`(()=>{
    // Prior gameplay may have exhausted the first producer. The recovery
    // assertion is about native touch after cancellation, not cooldown.
    const save=JSON.parse(localStorage.getItem("toolbox.merge-isle.local.v1"));
    const slot=save.board.findIndex(item=>item?.kind==='producer'&&item.charges>0);
    if(slot<0)throw Error('No charged producer available after touch cancellation');
    const el=document.querySelector('#board [data-slot="'+slot+'"]');
    el.scrollIntoView({block:'center'});
    const r=el.getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2};
  })()`);
  // Wait for hit-testing after scroll and touchCancel. A fixed sleep can
  // dispatch the next gesture onto an old compositor target.
  await until(async()=>await evalOn(b,`(()=>{
    const hit=document.elementFromPoint(${newProducer.x},${newProducer.y});
    return !document.hidden&&!!hit?.closest?.('.producer')&&
      document.querySelectorAll('.drag-ghost').length===0;
  })()`),'fresh producer hit target after cancel');
  await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[
    {...newProducer,id:4,radiusX:2,radiusY:2,force:1}
  ]},b.sessionId);
  await sleep(65);
  await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]},b.sessionId);
  await waitWithSnapshot(async()=>(await readSave(b)).revision===afterCancel.revision+1,
    'fresh producer touch after cancellation',b);
  await sleep(250);
  const afterRecovery=await readSave(b);
  assert.equal(afterRecovery.revision,afterCancel.revision+1,
    'fresh touch after cancellation must commit only once');
  assert.equal(afterRecovery.energy,afterCancel.energy-1,
    'fresh touch after cancellation must consume exactly one energy');
  t.diagnostic('Chromium native touch drag, touchCancel and fresh-touch recovery passed');


  // P2.65ay: background a native material drag, then update the save from
  // another tab. A stale touch must never overwrite the newer save.
  const hiddenDrag=await evalOn(b,`(()=>{
    const save=JSON.parse(localStorage.getItem("toolbox.merge-isle.local.v1"));
    const from=save.board.findIndex(item=>item?.kind==='material');
    const to=save.board.findIndex((item,i)=>!item&&i!==from);
    if(from<0||to<0)throw Error('No material/empty cell');
    document.getElementById('board').scrollIntoView({block:'center'});
    const center=i=>{
      const r=document.querySelector('#board [data-slot="'+i+'"]').getBoundingClientRect();
      return {x:r.left+r.width/2,y:r.top+r.height/2};
    };
    return {start:center(from),end:center(to)};
  })()`);
  for(const p of [hiddenDrag.start,hiddenDrag.end])
    assert.ok(p.x>0&&p.x<390&&p.y>0&&p.y<844,'background drag target onscreen');
  await sleep(120);
  const beforeHide=await readSave(b);
  await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[
    {...hiddenDrag.start,id:5,radiusX:2,radiusY:2,force:1}
  ]},b.sessionId);
  await sleep(65);
  await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[
    {...hiddenDrag.end,id:5,radiusX:2,radiusY:2,force:1}
  ]},b.sessionId);
  await until(async()=>await evalOn(b,`document.querySelectorAll('.drag-ghost').length===1`),
    'drag ghost visible before tab background');
  await front(a);
  await until(async()=>await evalOn(b,'document.hidden'),'touch owner hidden');
  assert.deepEqual(await readSave(a),beforeHide,'unfinished drag must not write');
  await until(async()=>await evalOn(a,`document.querySelector('#energy').textContent.startsWith(${JSON.stringify(String(beforeHide.energy)+' /')})`),
    'other tab adopted save before writing');
  await evalOn(a,`document.querySelector('#board .producer').click();true`);
  await until(async()=>(await readSave(a)).revision===beforeHide.revision+1,
    'other tab saved while touch owner hidden');
  const newerRaw=await evalOn(a,`localStorage.getItem(${JSON.stringify(key)})`);
  const newerState=JSON.parse(newerRaw);
  await front(b);
  await until(async()=>!await evalOn(b,'document.hidden'),'touch owner visible');
  await until(async()=>await evalOn(b,`document.querySelector('#energy').textContent.startsWith(${JSON.stringify(String(newerState.energy)+' /')})`),
    'foreground tab adopted concurrent save');
  await call('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]},b.sessionId);
  await sleep(200);
  assert.equal(await evalOn(b,`localStorage.getItem(${JSON.stringify(key)})`),newerRaw,
    'stale background drag must not overwrite newer save');
  assert.equal(await evalOn(b,`document.querySelectorAll('.drag-ghost').length`),0,
    'background drag ghost must be removed');
  const fresh=await evalOn(b,`(()=>{
    const el=document.querySelector('#board .producer');
    el.scrollIntoView({block:'center'});
    const r=el.getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2};
  })()`);
  // A foreground visibility event and scroll can settle before the compositor
  // updates hit testing. Check the actual target instead of a fixed delay.
  await until(async()=>await evalOn(b,`(()=>{
    const hit=document.elementFromPoint(${fresh.x},${fresh.y});
    return !document.hidden&&!!hit?.closest?.('.producer')&&
      document.querySelectorAll('.drag-ghost').length===0;
  })()`),'fresh producer hit target after background');
  await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[
    {...fresh,id:6,radiusX:2,radiusY:2,force:1}
  ]},b.sessionId);
  await sleep(65);
  await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]},b.sessionId);
  // Preserve the immediate UI rejection reason: the existing 12s timeout
  // snapshot can outlive the 2.4s notice and hide a legitimate busy guard.
  const immediateAfterBackgroundTouch=await evalOn(b,`({
    notice:document.getElementById('notice').textContent,
    status:document.getElementById('save-status').textContent,
    visible:!document.hidden,
    recentEvents:window.__touchTrace?.slice(-6).map(e=>e.type)
  })`);
  // A foreground reconciliation may discover a newer cross-tab snapshot
  // only when the first touch arrives. That touch MUST be rejected (not
  // replayed) and the user must make a distinct, fresh gesture. Do not turn
  // an arbitrary timeout into success: permit only the exact safe rejection,
  // unchanged bytes, and then require one verified new write.
  let firstBackgroundTouchSaved=false;
  try{
    await until(async()=>(await readSave(b)).revision===newerState.revision+1,
      'first fresh touch after background',2200);
    firstBackgroundTouchSaved=true;
  }catch{
    const rejectedRaw=await evalOn(b,`localStorage.getItem(${JSON.stringify(key)})`);
    assert.equal(rejectedRaw,newerRaw,
      'rejected first foreground touch must preserve the exact newer save bytes');
    assert.equal(immediateAfterBackgroundTouch.visible,true,
      'only a visible-page safe rejection may be retried');
    assert.match(immediateAfterBackgroundTouch.notice,
      /存档已更新或正在保存，请在最新棋盘上重新操作/,
      'retry requires the explicit stale-board safety notice');
    t.diagnostic('First foreground tap safely rejected against stale board; requiring a new physical touch');
    const retryPoint=await evalOn(b,`(()=>{
      const el=document.querySelector('#board .producer');
      el.scrollIntoView({block:'center',inline:'nearest'});
      const r=el.getBoundingClientRect();
      return {x:r.left+r.width/2,y:r.top+r.height/2};
    })()`);
    await until(async()=>await evalOn(b,`(()=>{
      const hit=document.elementFromPoint(${retryPoint.x},${retryPoint.y});
      return !document.hidden&&!!hit?.closest?.('.producer')&&
        document.querySelectorAll('.drag-ghost').length===0;
    })()`),'retry producer hit target after safe rejection');
    await sleep(160);
    await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[
      {...retryPoint,id:7,radiusX:2,radiusY:2,force:1}
    ]},b.sessionId);
    await sleep(75);
    await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]},b.sessionId);
    await waitWithSnapshot(async()=>(await readSave(b)).revision===newerState.revision+1,
      'new physical touch after safe foreground rejection',b);
  }
  if(firstBackgroundTouchSaved)
    t.diagnostic('First foreground touch committed against verified latest save');
  await sleep(200);
  const recovered=await readSave(b);
  assert.equal(recovered.revision,newerState.revision+1,'fresh touch writes exactly once');
  assert.equal(recovered.energy,newerState.energy-1,'fresh touch spends one energy');
  t.diagnostic('Chromium background mid-drag, concurrent tab write and fresh touch recovery passed');


  // P2.65bi: loaded normal mode must remain playable and export its exact
  // snapshot when the browser goes offline. This is NOT an offline reload or
  // installed-PWA test; it proves the already-loaded runtime has no network
  // dependency for a normal action or a local Blob download.
  await front(b);
  // Isolate each download in its own directory: headless Chromium may reuse
  // the same filename for repeated exports instead of creating a new name.
  const offlineDownloadDir=await mkdtemp(join(temp,'offline-download-'));
  await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:offlineDownloadDir});
  await call('Network.enable',{},b.sessionId);
  await call('Network.emulateNetworkConditions',{
    offline:true,latency:0,downloadThroughput:0,uploadThroughput:0
  },b.sessionId);
  try {
    await until(async()=>await evalOn(b,'navigator.onLine===false'),
      'browser reports offline after network emulation');
    const offlineBefore=await readSave(b);
    await evalOn(b,"document.querySelector('#board .producer').click();true");
    await waitWithSnapshot(async()=>(await readSave(b)).revision===offlineBefore.revision+1,
      'offline normal-mode producer saved once',b);
    const offlineAfter=await readSave(b);
    assert.equal(offlineAfter.energy,offlineBefore.energy-1,
      'offline production consumes exactly one energy');
    // Storage readback can precede the async onVerified UI publication.
    // Export only after the player actually sees the new persisted state.
    await waitWithSnapshot(async()=>await evalOn(b,
      "document.getElementById('save-status').textContent.includes('已保存于此浏览器') && "+
      "document.querySelector('#energy').textContent.startsWith('"+offlineAfter.energy+" /')"),
      'offline UI published before export',b);
    await sleep(180);
    assert.equal((await readSave(b)).revision,offlineBefore.revision+1,
      'offline action must not duplicate its write');
    const existingDownloads=new Set((await readdir(offlineDownloadDir)).filter(
      name=>name.endsWith('.json')||name.endsWith('.txt')));
    await evalOn(b,"document.getElementById('export-local-save').click();true");
    const offlineExportFeedback=await evalOn(b,"({notice:document.getElementById('notice').textContent,status:document.getElementById('save-status').textContent,hidden:document.hidden,online:navigator.onLine})");
    t.diagnostic('Chromium offline export feedback: '+JSON.stringify(offlineExportFeedback));
    // Chromium may suppress even a local Blob download while CDP network
    // emulation is offline. A successful anchor click is NOT file evidence.
    // Record that limitation explicitly and verify the bytes after reconnect.
    let offlineFile=null;
    try {
      offlineFile=await until(async()=>{
        const names=(await readdir(offlineDownloadDir)).filter(
          name=>name.endsWith('.json')||name.endsWith('.txt'));
        return names.find(name=>!existingDownloads.has(name));
      },'offline Blob download reached disk',1800);
    } catch {
      assert.match(offlineExportFeedback.notice,/已请求下载.*请核实文件已保存/,
        'offline UI must describe a request, never falsely claim saved bytes');
      t.diagnostic('OFFLINE DOWNLOAD UNVERIFIED: Chromium requested Blob download but no new file landed; keep mobile offline-export P0 open');
    }
    if(offlineFile){
      const offlineDownloaded=await readFile(join(offlineDownloadDir,offlineFile),'utf8');
      assert.deepEqual(JSON.parse(offlineDownloaded),offlineAfter,
        'offline landed file must equal the reviewed snapshot');
      t.diagnostic('Chromium offline Blob download actually landed and matched saved bytes');
    }
    assert.deepEqual(await readSave(b),offlineAfter,
      'offline export must remain read-only');
  } finally {
    await call('Network.emulateNetworkConditions',{
      offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1
    },b.sessionId);
  }
  await until(async()=>await evalOn(b,'navigator.onLine===true'),
    'browser network restored');
  // Once online again, the user must still be able to obtain a real file.
  // Never treat the earlier offline click/notice as proof of a saved backup.
  const onlineBaseline=await readSave(b);
  const onlineDownloadDir=await mkdtemp(join(temp,'online-download-'));
  await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:onlineDownloadDir});
  const beforeOnlineDownload=new Set((await readdir(onlineDownloadDir)).filter(
    name=>name.endsWith('.json')||name.endsWith('.txt')));
  await evalOn(b,"document.getElementById('export-local-save').click();true");
  const onlineFile=await until(async()=>{
    const names=(await readdir(onlineDownloadDir)).filter(
      name=>name.endsWith('.json')||name.endsWith('.txt'));
    return names.find(name=>!beforeOnlineDownload.has(name));
  },'real local export after reconnect');
  assert.deepEqual(JSON.parse(await readFile(join(onlineDownloadDir,onlineFile),'utf8')),onlineBaseline,
    'reconnected download must match the persisted snapshot exactly');
  assert.deepEqual(await readSave(b),onlineBaseline,
    'reconnected export must not change progress');
  t.diagnostic('Chromium offline gameplay and online recovery download verified; offline file landing remains an explicit manual gate');


  // P2.65bj: a loaded, offline observer tab must still adopt a newer save
  // written by another same-origin tab. Network state must not create a
  // separate local authority or silently roll back the newer revision.
  await front(a);
  await call('Page.reload',{ignoreCache:true},a.sessionId);
  await waitWithSnapshot(async()=>await evalOn(a,`document.readyState==='complete' &&
    document.getElementById('save-status')?.textContent.includes('已保存于此浏览器')`),
    'offline observer verified startup',a);
  assert.deepEqual(await readSave(a),onlineBaseline,
    'observer must start from the exact latest persisted state');
  const crossTabBackupBefore=await evalOn(a,
    `localStorage.getItem(${JSON.stringify(key+'.restore-backup-v3')})`);
  await call('Network.enable',{},a.sessionId);
  await call('Network.emulateNetworkConditions',{
    offline:true,latency:0,downloadThroughput:0,uploadThroughput:0
  },a.sessionId);
  try {
    await until(async()=>await evalOn(a,'navigator.onLine===false'),
      'observer is offline before concurrent write');
    await front(b);
    await waitWithSnapshot(async()=>await evalOn(b,
      `document.getElementById('save-status').textContent.includes('已保存于此浏览器') &&
        document.querySelector('#energy').textContent.startsWith(${JSON.stringify(String(onlineBaseline.energy)+' /')})`),
      'writer UI verified before offline observer update',b);
    await evalOn(b,"document.querySelector('#board .producer').click();true");
    await waitWithSnapshot(async()=>(await readSave(b)).revision===onlineBaseline.revision+1,
      'online tab saved while observer was offline',b);
    const crossTabRaw=await evalOn(b,`localStorage.getItem(${JSON.stringify(key)})`);
    const crossTabSave=JSON.parse(crossTabRaw);
    assert.equal(crossTabSave.energy,onlineBaseline.energy-1,
      'writer must spend exactly one energy');
    await front(a);
    await waitWithSnapshot(async()=>await evalOn(a,
      `document.querySelector('#energy').textContent.startsWith(${JSON.stringify(String(crossTabSave.energy)+' /')})`),
      'offline observer adopted newer tab progress',a);
    assert.equal(await evalOn(a,'navigator.onLine'),false,
      'observer must still be offline when it adopts the shared save');
    assert.equal(await evalOn(a,`localStorage.getItem(${JSON.stringify(key)})`),
      crossTabRaw,'offline observer must preserve exact newer save bytes');
    assert.equal(await evalOn(a,
      `localStorage.getItem(${JSON.stringify(key+'.restore-backup-v3')})`),
      crossTabBackupBefore,'offline reconciliation must not replace recovery backup');
    // A read-only export request is allowed, but cannot prove iOS/WebView
    // file landing. The prior download assertions remain the actual disk gate.
    await evalOn(a,"document.getElementById('export-local-save').click();true");
    assert.match(await evalOn(a,"document.getElementById('notice').textContent"),
      /已请求下载.*请核实文件已保存/,
      'offline observer must not claim a file was saved');
    assert.equal(await evalOn(a,`localStorage.getItem(${JSON.stringify(key)})`),
      crossTabRaw,'offline export must not write or roll back the newer save');
    // P2.65bk: adoption must not leave the offline observer read-only. A
    // fresh two-click move writes once under Web Locks; the online tab then
    // adopts those exact bytes without a rollback or backup replacement.
    const offlineMovePair=await evalOn(a,`(()=>{
      const cells=JSON.parse(localStorage.getItem("toolbox.merge-isle.local.v1")).board;
      return {from:cells.findIndex(item=>item?.kind==='material'),
        to:cells.findIndex(item=>item===null)};
    })()`);
    assert.ok(offlineMovePair.from>=0&&offlineMovePair.to>=0,
      'offline observer needs a material and empty slot for a legal move');
    await waitWithSnapshot(async()=>await evalOn(a,
      `document.getElementById('save-status').textContent.includes('已保存于此浏览器') &&
        document.querySelectorAll('#board .cell').length===56`),
      'offline observer verified fresh board before moving',a);
    await evalOn(a,`document.querySelector('#board .cell[data-slot="${offlineMovePair.from}"]').click();true`);
    await until(async()=>await evalOn(a,
      `document.querySelector('#board .cell.selected')?.dataset.slot==='${offlineMovePair.from}'`),
      'offline first tap selects a material');
    assert.equal(await evalOn(a,`localStorage.getItem(${JSON.stringify(key)})`),
      crossTabRaw,'offline selection must not write or roll back shared progress');
    await evalOn(a,`document.querySelector('#board .cell[data-slot="${offlineMovePair.to}"]').click();true`);
    await waitWithSnapshot(async()=>(await readSave(a)).revision===crossTabSave.revision+1,
      'offline observer move persisted exactly once',a);
    const offlineMoveRaw=await evalOn(a,`localStorage.getItem(${JSON.stringify(key)})`);
    const offlineMoveSave=JSON.parse(offlineMoveRaw);
    assert.deepEqual(offlineMoveSave.board[offlineMovePair.to],
      crossTabSave.board[offlineMovePair.from],'offline move must preserve item identity');
    assert.equal(offlineMoveSave.board[offlineMovePair.from],null,
      'offline move must clear the original cell');
    assert.equal(offlineMoveSave.energy,crossTabSave.energy,
      'offline movement must not consume energy');
    await sleep(180);
    assert.equal((await readSave(a)).revision,crossTabSave.revision+1,
      'offline move must not generate duplicate writes');
    assert.equal(await evalOn(a,
      `localStorage.getItem(${JSON.stringify(key+'.restore-backup-v3')})`),
      crossTabBackupBefore,'offline write must not replace recovery backup');
    await front(b);
    await waitWithSnapshot(async()=>await evalOn(b,
      `document.querySelector('#board .cell[data-slot="${offlineMovePair.to}"]')?.classList.contains('filled') &&
        !document.querySelector('#board .cell[data-slot="${offlineMovePair.from}"]')?.classList.contains('filled') &&
        document.getElementById('save-status').textContent.includes('已保存于此浏览器')`),
      'online tab rendered offline observer move',b);
    assert.equal(await evalOn(b,`localStorage.getItem(${JSON.stringify(key)})`),
      offlineMoveRaw,'online tab must retain exact offline write bytes');
    assert.equal(await evalOn(b,
      `localStorage.getItem(${JSON.stringify(key+'.restore-backup-v3')})`),
      crossTabBackupBefore,'online adoption must preserve restore backup');
    await front(a);
    assert.equal(await evalOn(a,'navigator.onLine'),false,
      'offline writer must remain offline after round-trip reconciliation');
    t.diagnostic('Chromium offline/online two-way save adoption and one legal offline move verified');
  } finally {
    await call('Network.emulateNetworkConditions',{
      offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1
    },a.sessionId);
  }
  await until(async()=>await evalOn(a,'navigator.onLine===true'),
    'observer network restored after cross-tab test');


  // P2.65bp: the actual two-tab UI must reject a confirmed reset while a
  // different tab holds the ordinary-mode Web Lock, without changing either
  // the current save or any recovery backup. A new confirmation after release
  // must be required and must commit a single, independently verified reset.
  await front(b);
  await waitWithSnapshot(async()=>await evalOn(b,
    "document.getElementById('save-status').textContent.includes('已保存于此浏览器')"),
    'reset contender verified current board',b);
  const resetLockBaseline=await evalOn(b,
    'localStorage.getItem('+JSON.stringify(key)+')');
  const resetLockBackup=await evalOn(b,
    'localStorage.getItem('+JSON.stringify(key+'.restore-backup-v3')+')');
  const resetLockStory=await evalOn(b,
    "localStorage.getItem('toolbox.merge-isle.story.local.v1')");
  assert.ok(JSON.parse(resetLockBaseline).revision>0,
    'lock contention needs a nonempty game progress to protect');
  await evalOn(a,
    'window.__p265bpHold=navigator.locks.request('+JSON.stringify(lock)+',()=>new Promise(resolve=>window.__p265bpUnlock=resolve));true');
  await until(async()=>await evalOn(a,
    "typeof window.__p265bpUnlock==='function'"),
    'other tab acquired ordinary save lock');
  await front(b);
  await evalOn(b, "window.__p265bpConfirmCount=0;window.confirm=()=>{window.__p265bpConfirmCount++;return true;};document.getElementById('reset').click();true");
  await waitWithSnapshot(async()=>await evalOn(b,
    "document.getElementById('notice').textContent.includes('占用存档')"),
    'locked reset safely rejected with visible busy feedback',b,5000);
  assert.equal(await evalOn(b,'window.__p265bpConfirmCount'),1,
    'the rejected reset must still require explicit confirmation');
  assert.equal(await evalOn(b,'localStorage.getItem('+JSON.stringify(key)+')'),
    resetLockBaseline,'busy reset must not change the save');
  assert.equal(await evalOn(b,
    'localStorage.getItem('+JSON.stringify(key+'.restore-backup-v3')+')'),
    resetLockBackup,'busy reset must not reserve or overwrite a backup');
  assert.equal(await evalOn(b,
    "localStorage.getItem('toolbox.merge-isle.story.local.v1')"),
    resetLockStory,'busy ordinary reset must not touch story progress');
  await evalOn(a,'window.__p265bpUnlock();true');
  await until(async()=>await evalOn(a,
    'navigator.locks.query().then(s=>!s.held.some(x=>x.name==='+JSON.stringify(lock)+'))'),
    'other tab released ordinary save lock');
  await front(b);
  assert.equal(await evalOn(b,
    'localStorage.getItem('+JSON.stringify(key)+')'),
    resetLockBaseline,'releasing the lock must not auto-replay old confirmation');
  await waitWithSnapshot(async()=>await evalOn(b,
    "document.getElementById('save-status').textContent.includes('已保存于此浏览器')"),
    'contender remained writable after rejected reset',b);
  await evalOn(b,"document.getElementById('reset').click();true");
  await waitWithSnapshot(async()=>{
    const raw=await evalOn(b,'localStorage.getItem('+JSON.stringify(key)+')');
    return raw!==resetLockBaseline&&JSON.parse(raw).revision===0;
  },'freshly confirmed reset after lock release',b);
  const resetAfterRelease=await evalOn(b,
    'localStorage.getItem('+JSON.stringify(key)+')');
  assert.equal(await evalOn(b,'window.__p265bpConfirmCount'),2,
    'successful reset must require a second independent confirmation');
  assert.equal(await evalOn(b,
    'localStorage.getItem('+JSON.stringify(key+'.restore-backup-v3')+')'),
    resetLockBackup,'normal reset must not overwrite the prior recovery backup');
  assert.equal(await evalOn(b,
    "localStorage.getItem('toolbox.merge-isle.story.local.v1')"),
    resetLockStory,'successful ordinary reset must preserve story progress');
  await front(a);
  await waitWithSnapshot(async()=>await evalOn(a,
    "document.getElementById('save-status').textContent.includes('已暂停')"),
    'old tab blocked after competing reset',a);
  await evalOn(a,"document.querySelector('#board .producer').click();true");
  assert.equal(await evalOn(a,'localStorage.getItem('+JSON.stringify(key)+')'),
    resetAfterRelease,'stale tab must not resurrect progress after reset');
  t.diagnostic('Chromium Web Lock contention rejected reset without backup write; new confirmation reset once and stale tab stayed blocked');

  // P2.65bq: a stale tab needs an explicit reload after another tab's reset.
  // Once revalidated, it can make a legal write and B must adopt those bytes.
  await call('Page.reload',{ignoreCache:true},a.sessionId);
  await waitWithSnapshot(async()=>await evalOn(a,
    "document.readyState==='complete'&&document.getElementById('save-status')?.textContent.includes('已保存于此浏览器')"),
    'stale tab explicitly reloaded after reset',a);
  assert.equal(await evalOn(a,'localStorage.getItem('+JSON.stringify(key)+')'),
    resetAfterRelease,'reloaded tab must adopt exact reset baseline');
  await front(a);
  await evalOn(a,"document.querySelector('#board .producer').click();true");
  await waitWithSnapshot(async()=>(await readSave(a)).revision===1,
    'one legal action after explicit reset reload',a);
  const importLockRaw=await evalOn(a,'localStorage.getItem('+JSON.stringify(key)+')');
  const importLockState=JSON.parse(importLockRaw);
  const importLockBackup=await evalOn(a,
    'localStorage.getItem('+JSON.stringify(key+'.restore-backup-v3')+')');
  const importLockStory=await evalOn(a,
    "localStorage.getItem('toolbox.merge-isle.story.local.v1')");
  await front(b);
  await waitWithSnapshot(async()=>await evalOn(b,
    "(document.getElementById('save-status').textContent.includes('已同步')||document.getElementById('save-status').textContent.includes('已保存于此浏览器'))&&document.querySelector('#energy').textContent.startsWith("+JSON.stringify(String(importLockState.energy)+' /')+")"),
    'other tab adopted legal post-reset write',b);
  assert.equal(await evalOn(b,'localStorage.getItem('+JSON.stringify(key)+')'),
    importLockRaw,'import contender must use latest save baseline');

  // Native Web Lock held by A must reject B's confirmed File.text import.
  // No backup reservation, deferred replay or stale success notice is allowed.
  await evalOn(a,'window.__p265bqHold=navigator.locks.request('+JSON.stringify(lock)+',()=>new Promise(resolve=>window.__p265bqUnlock=resolve));true');
  await until(async()=>await evalOn(a,"typeof window.__p265bqUnlock==='function'"),
    'other tab acquired save lock before import');
  await front(b);
  await evalOn(b,"(()=>{window.__p265bqConfirms=0;window.confirm=()=>{window.__p265bqConfirms++;return true;};const originalClick=HTMLInputElement.prototype.click;HTMLInputElement.prototype.click=function(){if(this.id==='import-normal-file')return;return originalClick.call(this);};try{document.getElementById('import-normal-save').click();}finally{HTMLInputElement.prototype.click=originalClick;}const input=document.getElementById('import-normal-file');const transfer=new DataTransfer();transfer.items.add(new File(["+JSON.stringify(downloaded)+"],'locked-import.json',{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
  await waitWithSnapshot(async()=>await evalOn(b,
    "(document.getElementById('notice').textContent.includes('其他标签正在保存')||document.getElementById('notice').textContent.includes('正在安全保存或其他标签页占用存档'))"),
    'confirmed import rejected under real competing Web Lock',b,6000);
  assert.equal(await evalOn(b,'window.__p265bqConfirms'),1,
    'busy import must require an explicit confirmation');
  assert.equal(await evalOn(b,'localStorage.getItem('+JSON.stringify(key)+')'),
    importLockRaw,'busy import must preserve current normal save bytes');
  assert.equal(await evalOn(b,
    'localStorage.getItem('+JSON.stringify(key+'.restore-backup-v3')+')'),
    importLockBackup,'busy import must not reserve or replace backup');
  assert.equal(await evalOn(b,
    "localStorage.getItem('toolbox.merge-isle.story.local.v1')"),
    importLockStory,'busy normal import must preserve story save');
  await waitWithSnapshot(async()=>await evalOn(b,
    "document.getElementById('cancel-normal-import').hidden&&!document.getElementById('import-normal-save').disabled"),
    'busy import released chooser and UI flight',b);
  await evalOn(a,'window.__p265bqUnlock();true');
  await until(async()=>await evalOn(a,
    'navigator.locks.query().then(s=>!s.held.some(x=>x.name==='+JSON.stringify(lock)+'))'),
    'competing import lock released');
  await sleep(120);
  assert.equal(await evalOn(b,'localStorage.getItem('+JSON.stringify(key)+')'),
    importLockRaw,'released lock must not replay old import confirmation');
  await front(b);
  await evalOn(b,"document.querySelector('#board .producer').click();true");
  await waitWithSnapshot(async()=>(await readSave(b)).revision===2,
    'fresh gameplay after rejected import',b);
  assert.equal((await readSave(b)).energy,importLockState.energy-1,
    'fresh action must consume exactly one energy');
  assert.equal(await evalOn(b,
    'localStorage.getItem('+JSON.stringify(key+'.restore-backup-v3')+')'),
    importLockBackup,'subsequent gameplay must preserve recovery backup');
  assert.equal(await evalOn(b,
    "localStorage.getItem('toolbox.merge-isle.story.local.v1')"),
    importLockStory,'subsequent gameplay must preserve story isolation');
  t.diagnostic('Chromium post-reset reload and confirmed native import lock contention verified without backup write or deferred replay');



  // P2.65br: genuine backgrounding aborts a pending File.text() read;
  // its late completion cannot restore over a newer cross-tab save.
  {
    await front(b);
    const before=await readSave(b);
    const beforeRaw=await evalOn(b,'localStorage.getItem('+JSON.stringify(key)+')');
    const backup=await evalOn(b,'localStorage.getItem('+JSON.stringify(key+'.restore-backup-v3')+')');
    const story=await evalOn(b,"localStorage.getItem('toolbox.merge-isle.story.local.v1')");
    await evalOn(b,`(()=>{
      window.__brConfirms=0;
      window.confirm=()=>{window.__brConfirms++;return true;};
      const original=File.prototype.text;
      window.__brOriginalText=original;
      File.prototype.text=function(){
        return new Promise(resolve=>{window.__brRelease=()=>resolve(original.call(this));});
      };
      const input=document.getElementById('import-normal-file');
      input.click=()=>{};
      document.getElementById('import-normal-save').click();
      const transfer=new DataTransfer();
      transfer.items.add(new File([${JSON.stringify(downloaded)}],'slow-import.json',{type:'application/json'}));
      input.files=transfer.files;
      input.dispatchEvent(new Event('change',{bubbles:true}));
      return true;
    })()`);
    await waitWithSnapshot(async()=>await evalOn(b,
      "typeof window.__brRelease==='function' && document.getElementById('import-normal-save').disabled"),
      'native import read pending',b);
    assert.equal(await evalOn(b,'window.__brConfirms'),0);
    assert.equal(await evalOn(b,'localStorage.getItem('+JSON.stringify(key)+')'),beforeRaw);
    await front(a);
    await until(async()=>await evalOn(b,'document.hidden===true'),'real import tab backgrounding');
    await waitWithSnapshot(async()=>await evalOn(a,
      "document.querySelector('#energy').textContent.startsWith("+
      JSON.stringify(String(before.energy)+' /')+") && "+
      "document.getElementById('save-status').textContent.includes('已同步')"),
      'foreground writer adopted latest baseline',a);
    await evalOn(a,"document.querySelector('#board .producer').click();true");
    await waitWithSnapshot(async()=>(await readSave(a)).revision===before.revision+1,
      'legal cross-tab action while import suspended',a);
    const newRaw=await evalOn(a,'localStorage.getItem('+JSON.stringify(key)+')');
    const updated=JSON.parse(newRaw);
    assert.equal(updated.energy,before.energy-1);
    await evalOn(b,'window.__brRelease();true');
    await front(b);
    await waitWithSnapshot(async()=>await evalOn(b,
      "!document.hidden && !document.getElementById('import-normal-save').disabled && "+
      "document.getElementById('cancel-normal-import').hidden"),
      'aborted import released UI',b);
    await waitWithSnapshot(async()=>await evalOn(b,
      "document.querySelector('#energy').textContent.startsWith("+
      JSON.stringify(String(updated.energy)+' /')+")"),
      'returned tab adopted latest save',b);
    assert.equal(await evalOn(b,'window.__brConfirms'),0,'late file cannot confirm');
    assert.equal(await evalOn(b,'localStorage.getItem('+JSON.stringify(key)+')'),newRaw);
    assert.equal(await evalOn(b,'localStorage.getItem('+JSON.stringify(key+'.restore-backup-v3')+')'),backup);
    assert.equal(await evalOn(b,"localStorage.getItem('toolbox.merge-isle.story.local.v1')"),story);
    await evalOn(b,'File.prototype.text=window.__brOriginalText;true');
    await evalOn(b,"document.querySelector('#board .producer').click();true");
    await waitWithSnapshot(async()=>(await readSave(b)).revision===updated.revision+1,
      'fresh gameplay after import abort',b);
    assert.equal((await readSave(b)).energy,updated.energy-1);
    assert.equal(await evalOn(b,'localStorage.getItem('+JSON.stringify(key+'.restore-backup-v3')+')'),backup);
    t.diagnostic('Chromium background native import abort, late file result and cross-tab recovery verified');
  }


  // P2.65bs: native file-picker cancellation and same-file re-selection.
  // iOS/WeChat can send a cancel event or choose the identical file again;
  // neither a canceled chooser nor a declined restore can mutate progress.
  {
    await front(b);
    await waitWithSnapshot(async()=>await evalOn(b,
      "document.getElementById('save-status').textContent.includes('已保存于此浏览器') && !document.getElementById('import-normal-save').disabled"),
      'import UI ready for native cancel and re-selection',b);
    const stableRaw=await evalOn(b,'localStorage.getItem('+JSON.stringify(key)+')');
    const stable=JSON.parse(stableRaw);
    const stableBackup=await evalOn(b,
      'localStorage.getItem('+JSON.stringify(key+'.restore-backup-v3')+')');
    const stableStory=await evalOn(b,
      "localStorage.getItem('toolbox.merge-isle.story.local.v1')");
    await evalOn(b,`(()=>{
      window.__bsConfirmCount=0;
      window.confirm=()=>{window.__bsConfirmCount++;return false;};
      const input=document.getElementById('import-normal-file');
      input.click=()=>{};
      document.getElementById('import-normal-save').click();
      input.dispatchEvent(new Event('cancel'));
      return true;
    })()`);
    await waitWithSnapshot(async()=>await evalOn(b,
      "document.getElementById('cancel-normal-import').hidden && !document.getElementById('import-normal-save').disabled"),
      'native chooser cancel event released UI',b);
    assert.equal(await evalOn(b,'window.__bsConfirmCount'),0,
      'native chooser cancel must never ask for destructive confirmation');
    assert.equal(await evalOn(b,'localStorage.getItem('+JSON.stringify(key)+')'),stableRaw,
      'native chooser cancellation must not mutate save bytes');

    // Two independent selections of the same named file must each reach a
    // fresh confirmation. Both are declined; no backup may be reserved.
    for(let attempt=1;attempt<=2;attempt++){
      await evalOn(b,`(()=>{
        const input=document.getElementById('import-normal-file');
        input.click=()=>{};
        document.getElementById('import-normal-save').click();
        const transfer=new DataTransfer();
        transfer.items.add(new File([${JSON.stringify(downloaded)}],
          'same-file-reselected.json',{type:'application/json'}));
        input.files=transfer.files;
        input.dispatchEvent(new Event('change',{bubbles:true}));
        return true;
      })()`);
      await waitWithSnapshot(async()=>await evalOn(b,
        "window.__bsConfirmCount==="+attempt+
        " && document.getElementById('cancel-normal-import').hidden && "+
        "!document.getElementById('import-normal-save').disabled"),
        'same file fresh declined confirmation '+attempt,b);
      assert.equal(await evalOn(b,'localStorage.getItem('+JSON.stringify(key)+')'),stableRaw,
        'declined same-file import must preserve exact normal save');
      assert.equal(await evalOn(b,
        'localStorage.getItem('+JSON.stringify(key+'.restore-backup-v3')+')'),
        stableBackup,'declined same-file import must preserve recovery backup');
      assert.equal(await evalOn(b,
        "localStorage.getItem('toolbox.merge-isle.story.local.v1')"),
        stableStory,'ordinary import cancellation must preserve story save');
    }
    await evalOn(b,"document.querySelector('#board .producer').click();true");
    await waitWithSnapshot(async()=>(await readSave(b)).revision===stable.revision+1,
      'fresh normal action after repeated native import cancellations',b);
    assert.equal((await readSave(b)).energy,stable.energy-1,
      'fresh action after canceled import consumes one energy');
    assert.equal(await evalOn(b,
      'localStorage.getItem('+JSON.stringify(key+'.restore-backup-v3')+')'),
      stableBackup,'normal action after canceled imports must preserve backup');
    t.diagnostic('Chromium native chooser cancel, same-file re-selection twice, declined restore and fresh gameplay verified');
  }


  // P2.65bt: persistent save controls survive DOM rerenders. A pointerdown
  // made on an older reviewed save must be invalidated when an external
  // Web-Locked engine write is adopted WHILE this tab remains foreground.
  // Pointer/click delivery is deterministic here; storage, engine, Web Locks,
  // lifecycle reconciliation and the actual page handlers are Chromium.
  {
    await front(b);
    assert.equal(await evalOn(b,'document.hidden'),false,'lease test requires foreground tab');
    const baselineRaw=await evalOn(b,'localStorage.getItem('+JSON.stringify(key)+')');
    const baseline=JSON.parse(baselineRaw);
    const backupRaw=await evalOn(b,'localStorage.getItem('+JSON.stringify(key+'.restore-backup-v3')+')');
    const storyRaw=await evalOn(b,"localStorage.getItem('toolbox.merge-isle.story.local.v1')");
    const produceExternally='(async()=>{const {produce}=await import("/merge/engine.mjs");'+
      'return navigator.locks.request('+JSON.stringify(lock)+',async()=>{'+
      'const before=JSON.parse(localStorage.getItem('+JSON.stringify(key)+'));'+
      'const slot=before.board.findIndex(item=>item?.kind==="producer");'+
      'const next=produce(before,slot);if(!next.ok)throw Error("external produce rejected");'+
      'localStorage.setItem('+JSON.stringify(key)+',JSON.stringify(next.state));'+
      'return {revision:next.state.revision,energy:next.state.energy};});})()';
    await evalOn(b,"(()=>{window.__btResetConfirms=0;window.confirm=()=>{window.__btResetConfirms++;return false;};"+
      "document.getElementById('reset').dispatchEvent(new PointerEvent('pointerdown',"+
      "{bubbles:true,pointerType:'touch',isPrimary:true}));return true;})()");
    const external=await evalOn(a,produceExternally);
    assert.equal(external.revision,baseline.revision+1,'external producer must advance one revision');
    assert.equal(external.energy,baseline.energy-1,'external producer must spend one energy');
    await waitWithSnapshot(async()=>await evalOn(b,
      "document.getElementById('save-status').textContent.includes('已同步其他标签页') && "+
      "document.querySelector('#energy').textContent.startsWith("+JSON.stringify(String(external.energy)+' /')+")"),
      'foreground tab adopted external save without backgrounding',b);
    assert.equal(await evalOn(b,'document.hidden'),false,'foreground lease must not be revoked by visibilitychange');
    const adoptedRaw=await evalOn(b,'localStorage.getItem('+JSON.stringify(key)+')');
    await evalOn(b,"document.getElementById('reset').dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));true");
    await sleep(90);
    assert.equal(await evalOn(b,'window.__btResetConfirms'),0,
      'stale persistent reset pointer must not ask for destructive confirmation');
    assert.equal(await evalOn(b,'localStorage.getItem('+JSON.stringify(key)+')'),adoptedRaw,
      'stale reset pointer must not overwrite newer save');
    assert.equal(await evalOn(b,'localStorage.getItem('+JSON.stringify(key+'.restore-backup-v3')+')'),backupRaw,
      'stale reset pointer must not replace backup');
    await evalOn(b,"(()=>{const button=document.getElementById('reset');"+
      "button.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch',isPrimary:true}));"+
      "button.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));return true;})()");
    assert.equal(await evalOn(b,'window.__btResetConfirms'),1,
      'a fresh reset pointer may reach confirmation (declined by the test)');
    assert.equal(await evalOn(b,'localStorage.getItem('+JSON.stringify(key)+')'),adoptedRaw);

    // The same lease must protect a non-destructive persistent export. Count
    // attempted anchor clicks without writing any file or assuming iOS download.
    await evalOn(b,"(()=>{window.__btDownloadClicks=0;"+
      "window.__btOriginalAnchorClick=HTMLAnchorElement.prototype.click;"+
      "HTMLAnchorElement.prototype.click=function(){window.__btDownloadClicks++;};"+
      "document.getElementById('export-local-save').dispatchEvent("+
      "new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch',isPrimary:true}));"+
      "return true;})()");
    const externalAgain=await evalOn(a,produceExternally);
    assert.equal(externalAgain.revision,external.revision+1);
    await waitWithSnapshot(async()=>await evalOn(b,
      "document.getElementById('save-status').textContent.includes('已同步其他标签页') && "+
      "document.querySelector('#energy').textContent.startsWith("+JSON.stringify(String(externalAgain.energy)+' /')+")"),
      'foreground tab adopted second external save',b);
    const latestRaw=await evalOn(b,'localStorage.getItem('+JSON.stringify(key)+')');
    await evalOn(b,"document.getElementById('export-local-save').dispatchEvent("+
      "new MouseEvent('click',{bubbles:true,detail:1}));true");
    assert.equal(await evalOn(b,'window.__btDownloadClicks'),0,
      'stale export pointer must not request a download for unseen progress');
    await evalOn(b,"(()=>{const button=document.getElementById('export-local-save');"+
      "button.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch',isPrimary:true}));"+
      "button.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));return true;})()");
    assert.equal(await evalOn(b,'window.__btDownloadClicks'),1,
      'fresh export pointer may request a download');
    await evalOn(b,'HTMLAnchorElement.prototype.click=window.__btOriginalAnchorClick;true');
    assert.equal(await evalOn(b,'localStorage.getItem('+JSON.stringify(key)+')'),latestRaw);
    assert.equal(await evalOn(b,'localStorage.getItem('+JSON.stringify(key+'.restore-backup-v3')+')'),backupRaw);
    assert.equal(await evalOn(b,"localStorage.getItem('toolbox.merge-isle.story.local.v1')"),storyRaw);
    t.diagnostic('Chromium foreground cross-tab adoption revoked stale persistent reset/export pointer leases');
  }

  // P2.65bu: mobile-width layout is a release gate, not a screenshot claim.
  // Exercise the actual page CSS in Chromium at narrow iPhone-sized widths.
  // No synthetic game state or write is needed for this read-only check.
  {
    await front(b);
    const beforeMobile=await evalOn(b,'localStorage.getItem('+JSON.stringify(key)+')');
    try{
      for(const width of [320,365,375,390]){
        await call('Emulation.setDeviceMetricsOverride',
          {width,height:812,deviceScaleFactor:3,mobile:true},b.sessionId);
        const m=await evalOn(b,`(()=>{
          const board=document.getElementById('board');
          const section=board.closest('.board-section');
          const cell=board.querySelector('.cell');
          const exportButton=document.getElementById('export-local-save');
          return {
            viewport:innerWidth,
            cellWidth:cell.getBoundingClientRect().width,
            documentWidth:document.documentElement.scrollWidth,
            sectionScroll:section.scrollWidth,
            sectionClient:section.clientWidth,
            touchAction:getComputedStyle(board).touchAction,
            exportHeight:exportButton.getBoundingClientRect().height
          };
        })()`);
        assert.equal(m.viewport,width,'emulated viewport must match requested width');
        assert.ok(m.cellWidth>=43.95,
          'seven-column touch cell must remain at least 44px at '+width+'px: '+JSON.stringify(m));
        assert.ok(m.documentWidth<=width+1,
          'ordinary page must not scroll horizontally at '+width+'px: '+JSON.stringify(m));
        assert.ok(m.exportHeight>=43.95,
          'manual save export must retain a 44px touch target at '+width+'px');
        if(width<=375){
          assert.equal(m.touchAction,'auto','narrow board must allow native panning');
          if(width<=365)assert.ok(m.sectionScroll>m.sectionClient,
            'narrow board should scroll inside its own section, not the page');
        }
      }
    }finally{
      await call('Emulation.clearDeviceMetricsOverride',{},b.sessionId);
    }
    assert.equal(await evalOn(b,'localStorage.getItem('+JSON.stringify(key)+')'),
      beforeMobile,'viewport changes must never write or reset the normal save');
    t.diagnostic('Chromium 320/365/375/390px mobile board hit targets, local overflow and save action verified');
  }


  // P2.65bw: a native chooser started before a genuine BFCache navigation
  // cannot publish a late file selection after pagehide revoked its epoch.
  // The picker is controlled, but navigation and pageshow.persisted are real.
  {
    await front(b);
    await waitWithSnapshot(async()=>await evalOn(b,
      "document.getElementById('save-status').textContent.includes('已保存于此浏览器') && !document.getElementById('import-normal-save').disabled"),
      'pre-BFCache import chooser ready',b);
    const raw=await evalOn(b,'localStorage.getItem('+JSON.stringify(key)+')');
    const backup=await evalOn(b,'localStorage.getItem('+JSON.stringify(key+'.restore-backup-v3')+')');
    const story=await evalOn(b,"localStorage.getItem('toolbox.merge-isle.story.local.v1')");
    await evalOn(b,"(()=>{"+
      "window.__bwConfirms=0;window.confirm=()=>{window.__bwConfirms++;return false;};"+
      "window.addEventListener('pageshow',e=>sessionStorage.setItem('merge-import-bfcache',String(e.persisted)));"+
      "const input=document.getElementById('import-normal-file');"+
      "window.__bwOldInput=input;input.click=()=>{};"+
      "document.getElementById('import-normal-save').click();return true;})()");
    assert.equal(await evalOn(b,"document.getElementById('cancel-normal-import').hidden"),false,
      'native chooser must be pending before pagehide');
    await call('Page.navigate',{url:base+'/merge/absent-test-page'},b.sessionId);
    await until(async()=>await evalOn(b,
      "document.readyState==='complete'&&location.pathname.includes('absent-test-page')"),
      'navigate away with pending import chooser');
    const history=await call('Page.getNavigationHistory',{},b.sessionId);
    await call('Page.navigateToHistoryEntry',
      {entryId:history.entries[history.currentIndex-1].id},b.sessionId);
    await until(async()=>await evalOn(b,
      "location.pathname==='/merge/index.html'&&!!document.getElementById('save-status')"),
      'restore original import page');
    await waitWithSnapshot(async()=>await evalOn(b,
      "document.getElementById('save-status').textContent.includes('已保存') || document.getElementById('save-status').textContent.includes('已同步')"),
      'post-BFCache import save reconciliation',b);
    assert.equal(await evalOn(b,"sessionStorage.getItem('merge-import-bfcache')"),'true',
      'import chooser regression requires genuine BFCache');
    assert.equal(await evalOn(b,
      "window.__bwOldInput===document.getElementById('import-normal-file')"),true,
      'late chooser event must target the actual BFCache-restored input');
    await evalOn(b,"(()=>{const transfer=new DataTransfer();"+
      "transfer.items.add(new File(["+JSON.stringify(downloaded)+
      "],'stale-bfcache.json',{type:'application/json'}));"+
      "window.__bwOldInput.files=transfer.files;"+
      "window.__bwOldInput.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
    await sleep(120);
    assert.equal(await evalOn(b,'window.__bwConfirms'),0,
      'a pre-pagehide file selection cannot request a new restore confirmation');
    assert.equal(await evalOn(b,'localStorage.getItem('+JSON.stringify(key)+')'),raw,
      'late chooser event cannot overwrite current ordinary progress');
    assert.equal(await evalOn(b,'localStorage.getItem('+JSON.stringify(key+'.restore-backup-v3')+')'),backup,
      'late chooser event cannot reserve or replace the restore backup');
    assert.equal(await evalOn(b,"localStorage.getItem('toolbox.merge-isle.story.local.v1')"),story,
      'late chooser event must not affect story progress');
    assert.equal(await evalOn(b,"document.getElementById('cancel-normal-import').hidden"),true,
      'BFCache must release the old chooser lease');
    await evalOn(b,"(()=>{const input=document.getElementById('import-normal-file');"+
      "input.click=()=>{};document.getElementById('import-normal-save').click();"+
      "input.dispatchEvent(new Event('cancel'));return true;})()");
    await waitWithSnapshot(async()=>await evalOn(b,
      "document.getElementById('cancel-normal-import').hidden && !document.getElementById('import-normal-save').disabled"),
      'fresh chooser cancellation after BFCache',b);
    assert.equal(await evalOn(b,'window.__bwConfirms'),0,
      'fresh picker cancellation must not ask for restore confirmation');
    assert.equal(await evalOn(b,'localStorage.getItem('+JSON.stringify(key)+')'),raw,
      'new chooser cancellation must not modify progress');
    t.diagnostic('Chromium genuine BFCache revoked pending import chooser, ignored late file and allowed fresh cancel');
  }


  // P2.65bx: unlike reset/export, the persistent store-selected button
  // targets an ephemeral selection. Selection changes rerender the board
  // without touching storage, so a delayed touch must not store a material
  // that was reselected after the original pointerdown.
  {
    await front(b);
    await waitWithSnapshot(async()=>await evalOn(b,
      "document.getElementById('save-status').textContent.includes('已保存') && !document.getElementById('reset').disabled"),
      'selection lease setup ready',b);
    const oldRaw=await evalOn(b,'localStorage.getItem('+JSON.stringify(key)+')');
    await evalOn(b,"(()=>{window.confirm=()=>true;document.getElementById('reset').click();return true;})()");
    await waitWithSnapshot(async()=>await evalOn(b,
      'localStorage.getItem('+JSON.stringify(key)+')!=='+JSON.stringify(oldRaw)+
      " && JSON.parse(localStorage.getItem("+JSON.stringify(key)+")).revision===0"),
      'selection lease isolated reset',b);
    await evalOn(b,"document.querySelector('#board .producer').click();true");
    await waitWithSnapshot(async()=> (await readSave(b)).revision===1,
      'selection lease material production',b);
    const slot=await evalOn(b,
      "document.querySelector('#board .cell.filled:not(.producer)')?.dataset.slot??null");
    assert.notEqual(slot,null,'producer must create a selectable material');
    const select=()=>evalOn(b,
      "document.querySelector('#board [data-slot="+JSON.stringify(slot)+"]').click();true");
    await select();
    assert.equal(await evalOn(b,"document.getElementById('store-selected').disabled"),false);
    const baseline=await evalOn(b,'localStorage.getItem('+JSON.stringify(key)+')');
    const backup=await evalOn(b,
      "localStorage.getItem("+JSON.stringify(key+'.restore-backup-v3')+")");
    const story=await evalOn(b,
      "localStorage.getItem('toolbox.merge-isle.story.local.v1')");
    await evalOn(b,"document.getElementById('store-selected').dispatchEvent("+
      "new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch',isPrimary:true}));true");
    await select(); // deselect: renderGeneration advances, no storage write
    await select(); // reselect: the old pointer is still unauthorized
    assert.equal(await evalOn(b,"document.getElementById('store-selected').disabled"),false);
    await evalOn(b,"document.getElementById('store-selected').dispatchEvent("+
      "new MouseEvent('click',{bubbles:true,detail:1}));true");
    await sleep(100);
    assert.equal(await evalOn(b,'localStorage.getItem('+JSON.stringify(key)+')'),baseline,
      'stale store-selected touch must not write a newly selected target');
    assert.equal((await readSave(b)).warehouse.slots.filter(Boolean).length,0);
    await evalOn(b,"(()=>{const button=document.getElementById('store-selected');"+
      "button.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch',isPrimary:true}));"+
      "button.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));return true;})()");
    await waitWithSnapshot(async()=> (await readSave(b)).revision===2,
      'fresh store-selected touch commits exactly once',b);
    assert.equal((await readSave(b)).warehouse.slots.filter(Boolean).length,1);
    assert.equal(await evalOn(b,
      "localStorage.getItem("+JSON.stringify(key+'.restore-backup-v3')+")"),backup);
    assert.equal(await evalOn(b,
      "localStorage.getItem('toolbox.merge-isle.story.local.v1')"),story);
    t.diagnostic('Chromium selection rerender revoked stale persistent store touch; fresh store succeeded once');
  }

  t.diagnostic(`Chromium two-tab lock, BFCache persisted=${bfcache}, download=${file}, reset/import/backup verified`);
});
