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
  await until(async()=>{
    const current=await readSave(b);
    return current.revision===savedSnapshot.revision&&current.energy===savedSnapshot.energy;
  },'downloaded save restored after reset');
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
  await evalOn(b,`document.querySelector('#board .producer').click();true`);
  await until(async()=>(await readSave(b)).revision===changedState.revision+1,'fresh gameplay after rejected chooser');
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
      const clipped=critical.filter(el=>{const r=bounds(el);return r.left < -1||r.right > width+1;}).map(el=>el.id||el.className).slice(0,12);
      const targets=[...document.querySelectorAll('.order-button,.small-action,.secondary-action,.guide-action,.save-actions button,#how-to,.back-link,.supply-select')].filter(visible);
      const tooShort=targets.filter(el=>bounds(el).height<43.5).map(el=>el.id||el.className).slice(0,12);
      const minSize=selector=>Math.min(...[...document.querySelectorAll(selector)].filter(visible).map(el=>bounds(el).width),999);
      return {width,scrollWidth:document.documentElement.scrollWidth,clipped,tooShort,
        boardMin:minSize('#board .cell'),warehouseMin:minSize('#warehouse .warehouse-slot'),
        warehouseColumns:getComputedStyle(document.querySelector('#warehouse')).gridTemplateColumns.split(' ').length,
        orderColumns:getComputedStyle(document.querySelector('#orders')).gridTemplateColumns.split(' ').length,
        reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches};
    })()`);
    assert.equal(layout.width,width,'mobile viewport width must match CDP device metrics');
    assert.ok(layout.scrollWidth<=width+1,`horizontal document overflow at ${width}px: ${JSON.stringify(layout)}`);
    assert.deepEqual(layout.clipped,[],`clipped controls at ${width}px`);
    assert.deepEqual(layout.tooShort,[],`undersized non-board touch targets at ${width}px`);
    assert.ok(layout.warehouseMin>=44,`warehouse slots below 44px at ${width}px`);
    assert.ok(layout.boardMin>=(width>=375?44:35),`board targets too narrow at ${width}px`);
    assert.equal(layout.warehouseColumns,width<=480?4:8,'warehouse responsive columns');
    assert.equal(layout.orderColumns,width<=480?2:3,'order responsive columns');
    assert.equal(layout.reducedMotion,true,'reduced-motion emulation must be active');
    t.diagnostic(`Chromium mobile viewport ${width}px: no overflow; board min ${layout.boardMin.toFixed(1)}px; warehouse min ${layout.warehouseMin.toFixed(1)}px`);
  }
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
    for(const type of ['touchstart','touchend','pointerdown','pointerup','click'])
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
  await until(async()=> (await readSave(b)).revision===beforeTouch.revision+1,'native touch producer persisted once');
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
    const el=document.querySelector('#board .producer');
    el.scrollIntoView({block:'center'});
    const r=el.getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2};
  })()`);
  await sleep(140);
  await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[
    {...newProducer,id:4,radiusX:2,radiusY:2,force:1}
  ]},b.sessionId);
  await sleep(65);
  await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]},b.sessionId);
  await until(async()=>(await readSave(b)).revision===afterCancel.revision+1,
    'fresh producer touch after cancellation');
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
  await sleep(140);
  await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[
    {...fresh,id:6,radiusX:2,radiusY:2,force:1}
  ]},b.sessionId);
  await sleep(65);
  await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]},b.sessionId);
  await until(async()=>(await readSave(b)).revision===newerState.revision+1,
    'fresh touch after background');
  await sleep(200);
  const recovered=await readSave(b);
  assert.equal(recovered.revision,newerState.revision+1,'fresh touch writes exactly once');
  assert.equal(recovered.energy,newerState.energy-1,'fresh touch spends one energy');
  t.diagnostic('Chromium background mid-drag, concurrent tab write and fresh touch recovery passed');

  t.diagnostic(`Chromium two-tab lock, BFCache persisted=${bfcache}, download=${file}, reset/import/backup verified`);
});
