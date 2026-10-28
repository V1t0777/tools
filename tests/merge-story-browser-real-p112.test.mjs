import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,readdir,mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve,extname,sep} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';

// Actual Chromium + page modules; no DOM mocks, injected saves, or remote API.
const root=resolve(new URL('..',import.meta.url).pathname);
const storyKey='toolbox.merge-isle.story.local.v1';
const workshopKey='toolbox.merge-isle.story.workshop.local.v1';
const normalKey='toolbox.merge-isle.local.v1';
const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript',
  '.css':'text/css','.svg':'image/svg+xml','.json':'application/json'};
function chromePath(){
  for(const bin of [process.env.CHROME_BIN,'google-chrome','google-chrome-stable',
    'chromium','chromium-browser'].filter(Boolean)){
    if(spawnSync(bin,['--version'],{encoding:'utf8'}).status===0)return bin;
  }
  return null;
}
async function until(check,label,limit=15000){
  const end=Date.now()+limit;
  while(Date.now()<end){
    try{const value=await check();if(value)return value;}catch{}
    await sleep(70);
  }
  throw Error('TIMEOUT: '+label);
}
function connectCDP(url){
  const ws=new WebSocket(url),pending=new Map();let serial=0;
  ws.addEventListener('message',event=>{
    const data=JSON.parse(event.data),item=pending.get(data.id);
    if(!item)return;
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
test('P112 real Chromium: story first-order gate, two-tab workshop conflict and corrupt evidence download',
  {timeout:105000},async t=>{
    const chrome=chromePath();
    assert.ok(chrome,'A real Chrome/Chromium binary is required; no mock fallback');
    const temp=await mkdtemp(join(tmpdir(),'yunyu-story-real-'));
    const server=createServer(async(req,res)=>{
      try{
        const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
        const file=resolve(root,'.'+path);
        if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
        const bytes=await readFile(file);
        res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream',
          'Cache-Control':'no-store'}).end(bytes);
      }catch{res.writeHead(404).end('not found');}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+server.address().port;
    const browser=spawn(chrome,['--headless=new','--no-sandbox','--disable-gpu',
      '--disable-dev-shm-usage','--no-first-run','--no-default-browser-check',
      '--disable-background-networking','--no-proxy-server',
      '--remote-debugging-port=0','--user-data-dir='+temp,'about:blank'],{stdio:'ignore'});
    let cdp;
    t.after(async()=>{
      try{cdp?.close();}catch{}
      browser.kill('SIGKILL');
      await new Promise(resolve=>server.close(resolve));
      await rm(temp,{recursive:true,force:true,maxRetries:3});
    });
    const portFile=join(temp,'DevToolsActivePort');
    await until(()=>existsSync(portFile),'Chrome debugging port');
    const [port,wsPath]=(await readFile(portFile,'utf8')).trim().split('\n');
    cdp=connectCDP('ws://127.0.0.1:'+port+wsPath);
    await cdp.ready;
    const call=(method,params={},session)=>cdp.call(method,params,session);
    async function page(){
      const {targetId}=await call('Target.createTarget',{url:'about:blank'});
      const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
      await call('Page.enable',{},sessionId);
      await call('Runtime.enable',{},sessionId);
      return {targetId,sessionId};
    }
    async function evalOn(p,expression){
      const result=await call('Runtime.evaluate',{
        expression,returnByValue:true,awaitPromise:true,userGesture:true
      },p.sessionId);
      if(result.exceptionDetails)throw Error('Browser JS: '+JSON.stringify(result.exceptionDetails));
      return result.result.value;
    }
    const front=async p=>{
      await call('Target.activateTarget',{targetId:p.targetId});
      await call('Page.bringToFront',{},p.sessionId);
    };
    async function navigate(p,path,selector){
      await call('Page.navigate',{url:base+path},p.sessionId);
      await until(async()=>evalOn(p,"document.readyState==='complete'&&!!document.querySelector("+JSON.stringify(selector)+")"),'load '+path);
    }
    const readRaw=(p,key)=>evalOn(p,'localStorage.getItem('+JSON.stringify(key)+')');
    const readJSON=async(p,key)=>JSON.parse(await readRaw(p,key));
    const a=await page();await front(a);
    await navigate(a,'/merge/story.html','#journey-read');
    await until(async()=>evalOn(a,"document.getElementById('save-state').textContent.includes('已保存')"),'story initialized');
    await evalOn(a,'localStorage.setItem('+JSON.stringify(normalKey)+',"normal-mode-sentinel");true');
    async function finishScene(id){
      await until(async()=>evalOn(a,"!document.getElementById('journey-read').hidden&&!document.getElementById('journey-read').disabled"),'readable '+id);
      await evalOn(a,"document.getElementById('journey-read').click();true");
      await until(async()=>evalOn(a,"document.getElementById('story-dialog').open"),'dialog '+id);
      assert.equal(await evalOn(a,"document.getElementById('story-dialog').open"),true);
      await evalOn(a,"document.querySelector('#dialog-choices button')?.click();true");
      await evalOn(a,"document.getElementById('complete-story').click();true");
      await until(async()=>{
        const data=await readJSON(a,storyKey);
        return data.packs.core.completed.main.includes(id);
      },'persist '+id);
      await until(async()=>evalOn(a,"!document.getElementById('story-dialog').open"),'dialog closed '+id);
    }
    await finishScene('arrival');
    await finishScene('signboard');
    const storyRaw=await readRaw(a,storyKey);
    const story=JSON.parse(storyRaw);
    assert.deepEqual(story.packs.core.completed.main,['arrival','signboard']);
    assert.equal(await evalOn(a,"document.getElementById('journey-read').hidden"),true,
      'first-order scene must not be directly offered before a real order');
    assert.equal(await evalOn(a,"document.getElementById('journey-workshop').hidden"),false);
    assert.equal(await readRaw(a,normalKey),'normal-mode-sentinel');

    await navigate(a,'/merge/story-workshop.html','#workshop-board');
    await until(async()=>evalOn(a,"document.querySelectorAll('#workshop-board button').length===56"),'56 real cells');
    assert.match(await evalOn(a,"document.getElementById('workshop-next-guidance').textContent"),/委托|订单|第一单/);
    assert.equal(await evalOn(a,"document.getElementById('workshop-next-action').getAttribute('href')"),'#orders-goal');
    await evalOn(a,"document.querySelector('#workshop-board .producer').click();true");
    await until(async()=>{
      const raw=await readRaw(a,workshopKey);
      return raw!==null&&JSON.parse(raw).revision>=1;
    },'story workshop production persisted');
    const before=await readJSON(a,workshopKey);
    // P114: real story → workshop → story → reload → workshop round-trip.
    // A produced material is not a fulfilled order; re-entry must not unlock
    // chapter two or any later construction and must not rewrite either save.
    const workshopBeforeReturn=await readRaw(a,workshopKey);
    await navigate(a,'/merge/story.html','#journey-read');
    await until(async()=>evalOn(a,
      "document.getElementById('progress-count').textContent.includes('2 / 12')"),
      'first chapter progress restored after workshop');
    assert.equal(await evalOn(a,"document.getElementById('journey-read').hidden"),true,
      'production alone must not bypass the first delivered-order gate');
    assert.equal(await evalOn(a,"document.getElementById('journey-workshop').hidden"),false);
    await call('Page.reload',{ignoreCache:true},a.sessionId);
    await until(async()=>evalOn(a,
      "document.getElementById('save-state')?.textContent.includes('已保存')"),
      'narrative reloaded with durable progress');
    assert.equal(await evalOn(a,"document.getElementById('journey-read').hidden"),true);
    assert.equal(await evalOn(a,"document.getElementById('journey-workshop').hidden"),false);
    assert.deepEqual((await readJSON(a,storyKey)).packs.core.completed.main,
      ['arrival','signboard'],'no extra story scenes may be committed on return');
    assert.equal(await readRaw(a,workshopKey),workshopBeforeReturn,
      'story return/reload must not rewrite workshop production');
    assert.equal(await readRaw(a,normalKey),'normal-mode-sentinel');

    await navigate(a,'/merge/story-workshop.html','#workshop-board');
    await until(async()=>evalOn(a,
      "document.querySelectorAll('#workshop-board button').length===56"),
      'real workshop board restored after narrative reload');
    for(const id of ['build-garden','build-harbor','build-storefront']){
      assert.equal(await evalOn(a,
        "document.getElementById("+JSON.stringify(id)+").disabled"),true,
        id+' must stay gated until its real chapter and economy prerequisites');
    }
    assert.equal(await readRaw(a,workshopKey),workshopBeforeReturn,
      'returning to workshop must not replay production');
    assert.equal(await readRaw(a,normalKey),'normal-mode-sentinel');
    const b=await page();await front(b);
    await navigate(b,'/merge/story-workshop.html','#workshop-board');
    await until(async()=>evalOn(b,"document.querySelectorAll('#workshop-board button').length===56"),'second tab loaded');
    await evalOn(b,"document.querySelector('#workshop-board .producer').click();true");
    await until(async()=>(await readJSON(b,workshopKey)).revision===before.revision+1,
      'second tab persisted independent workshop');
    const peerRaw=await readRaw(b,workshopKey);
    await front(a);
    await until(async()=>evalOn(a,"document.getElementById('workshop-status').textContent.includes('已停止操作')"),
      'old workshop tab blocked by peer write');
    await evalOn(a,"document.querySelector('#workshop-board .producer').click();true");
    assert.equal(await readRaw(a,workshopKey),peerRaw,'stale tab must not overwrite peer save');
    assert.equal(await readRaw(a,storyKey),storyRaw,'workshop must not rewrite story progress');
    assert.equal(await readRaw(a,normalKey),'normal-mode-sentinel');

    // Corrupt only the workshop key; use the real UI to export exact raw bytes.
    const corrupt='{broken-workshop-save';
    await front(b);
    await evalOn(b,'localStorage.setItem('+JSON.stringify(workshopKey)+','+JSON.stringify(corrupt)+');true');
    await call('Page.reload',{ignoreCache:true},b.sessionId);
    await until(async()=>evalOn(b,"document.getElementById('workshop-status')?.textContent.includes('存档损坏')"),
      'corrupt workshop detected after reload');
    assert.equal(await evalOn(b,"document.getElementById('export-corrupt-workshop').disabled"),false);
    await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:temp});
    await evalOn(b,"window.confirm=()=>true;document.getElementById('export-corrupt-workshop').click();true");
    const filename=await until(async()=>{
      const names=await readdir(temp);
      return names.find(name=>name.startsWith('yunyu-story-workshop-corrupt-save')&&name.endsWith('.txt'));
    },'real Chromium corrupt evidence download');
    assert.equal(await readFile(join(temp,filename),'utf8'),corrupt,
      'downloaded evidence must preserve the exact damaged bytes');
    assert.equal(await readRaw(b,workshopKey),corrupt,'evidence must not repair or erase');
    assert.equal(await readRaw(b,storyKey),storyRaw,'story progress must survive corruption');
    assert.equal(await readRaw(b,normalKey),'normal-mode-sentinel',
      'normal mode must remain untouched');

    // P113: independent narrative evidence in a real browser; the damaged
    // workshop record must survive every narrative operation below.
    await navigate(b,'/merge/story.html','#journey-read');
    await until(async()=>evalOn(b,"document.getElementById('save-state').textContent.includes('已保存')"),
      'narrative loaded before deliberate corruption');
    const damagedStory='{broken-dialogue-save';
    await evalOn(b,'localStorage.setItem('+JSON.stringify(storyKey)+','+JSON.stringify(damagedStory)+');true');
    await call('Page.reload',{ignoreCache:true},b.sessionId);
    await until(async()=>evalOn(b,"document.getElementById('save-state')?.textContent.includes('异常剧情存档')"),
      'corrupt narrative detected');
    assert.equal(await evalOn(b,"document.getElementById('export-corrupt-story').disabled"),false);
    assert.equal(await evalOn(b,"document.getElementById('journey-read').hidden"),true,
      'corrupt narrative must not expose next-scene reading');

    await evalOn(b,"window.confirm=()=>false;document.getElementById('export-corrupt-story').click();true");
    assert.equal((await readdir(temp)).some(name=>name.startsWith('yunyu-story-dialogue-corrupt-save')),false,
      'declined export must not create a file');
    assert.equal(await readRaw(b,storyKey),damagedStory);

    // Mutation during native confirmation invalidates the previously shown
    // raw snapshot, even if a storage event has not arrived yet.
    const changedStory='{peer-replaced-broken-dialogue';
    await evalOn(b,'window.confirm=()=>{localStorage.setItem('+
      JSON.stringify(storyKey)+','+JSON.stringify(changedStory)+');return true;};'+
      "document.getElementById('export-corrupt-story').click();true");
    assert.equal(await readRaw(b,storyKey),changedStory);
    assert.equal((await readdir(temp)).some(name=>name.startsWith('yunyu-story-dialogue-corrupt-save')),false,
      'stale confirmation must not create a narrative evidence file');

    await call('Page.reload',{ignoreCache:true},b.sessionId);
    await until(async()=>evalOn(b,"document.getElementById('export-corrupt-story')?.disabled===false"),
      'fresh corrupt narrative export available');
    await evalOn(b,"window.confirm=()=>true;document.getElementById('export-corrupt-story').click();true");
    const narrativeFile=await until(async()=>(
      await readdir(temp)).find(name=>name.startsWith('yunyu-story-dialogue-corrupt-save')&&name.endsWith('.txt')),
      'real Chromium narrative evidence download');
    assert.equal(await readFile(join(temp,narrativeFile),'utf8'),changedStory,
      'narrative evidence must match the current damaged bytes');
    assert.equal(await readRaw(b,storyKey),changedStory,'export cannot repair the narrative');
    assert.equal(await readRaw(b,workshopKey),corrupt,'independent workshop damage must remain untouched');
    assert.equal(await readRaw(b,normalKey),'normal-mode-sentinel','normal-mode save must remain untouched');
    // P115: both damaged saves have been exported. Explicit reset must be
    // independently confirmed and may only replace its own damaged key.
    // Declining either confirmation must preserve every raw byte.
    await evalOn(b,"window.confirm=()=>false;document.getElementById('reset-story').click();true");
    assert.equal(await readRaw(b,storyKey),changedStory,'declined story reset preserves damage');
    await evalOn(b,"window.__confirmCount=0;window.confirm=()=>++window.__confirmCount===1;"+
      "document.getElementById('reset-story').click();true");
    assert.equal(await readRaw(b,storyKey),changedStory,'second-stage refusal preserves damage');

    // A same-tab replacement during native confirmation simulates a peer
    // changing the raw record before StorageEvent delivery.
    const newerDamagedStory='{peer-replaced-during-story-reset';
    await evalOn(b,'window.confirm=()=>{localStorage.setItem('+
      JSON.stringify(storyKey)+','+JSON.stringify(newerDamagedStory)+');return true;};'+
      "document.getElementById('reset-story').click();true");
    assert.equal(await readRaw(b,storyKey),newerDamagedStory,
      'stale consent cannot overwrite a newly changed narrative');
    assert.equal(await readRaw(b,workshopKey),corrupt);
    await call('Page.reload',{ignoreCache:true},b.sessionId);
    await until(async()=>evalOn(b,
      "document.getElementById('save-state')?.textContent.includes('异常剧情存档')&&"+
      "document.getElementById('reset-story')?.disabled===false"),
      'fresh damaged story reset handler initialized');
    await evalOn(b,"window.confirm=()=>true;document.getElementById('reset-story').click();true");
    await until(async()=>{
      try{return (await readJSON(b,storyKey)).packs.core.completed.main.length===0;}
      catch{return false;}
    },'confirmed narrative reset persisted');
    const resetStoryRaw=await readRaw(b,storyKey);
    assert.notEqual(resetStoryRaw,newerDamagedStory);
    assert.equal(await readRaw(b,workshopKey),corrupt,
      'narrative reset must not repair independent workshop corruption');
    assert.equal(await readRaw(b,normalKey),'normal-mode-sentinel');

    // Workshop reset has a separate double confirmation, Web Lock and CAS.
    // A replacement during confirmation must not be silently overwritten.
    await navigate(b,'/merge/story-workshop.html','#workshop-board');
    await until(async()=>evalOn(b,
      "document.getElementById('workshop-status')?.textContent.includes('存档损坏')"),
      'damaged workshop remains blocked after narrative recovery');
    await evalOn(b,"window.confirm=()=>false;document.getElementById('reset-workshop').click();true");
    assert.equal(await readRaw(b,workshopKey),corrupt,'declined workshop reset preserves damage');
    const newerDamagedWorkshop='{peer-replaced-during-workshop-reset';
    await evalOn(b,'window.confirm=()=>{localStorage.setItem('+
      JSON.stringify(workshopKey)+','+JSON.stringify(newerDamagedWorkshop)+');return true;};'+
      "document.getElementById('reset-workshop').click();true");
    assert.equal(await readRaw(b,workshopKey),newerDamagedWorkshop,
      'stale workshop consent cannot overwrite changed evidence');
    await call('Page.reload',{ignoreCache:true},b.sessionId);
    await until(async()=>evalOn(b,
      "document.getElementById('workshop-status')?.textContent.includes('存档损坏')"),
      'fresh damaged workshop reset available');
    await evalOn(b,"window.confirm=()=>true;document.getElementById('reset-workshop').click();true");
    await until(async()=>{
      try{return (await readJSON(b,workshopKey)).board.length===56;}
      catch{return false;}
    },'confirmed workshop reset persisted');
    assert.equal(await readRaw(b,storyKey),resetStoryRaw,
      'workshop reset cannot rewind recovered narrative');
    assert.equal(await readRaw(b,normalKey),'normal-mode-sentinel');
    assert.equal(await evalOn(b,
      "document.querySelectorAll('#workshop-board button').length"),56);
    t.diagnostic('P115 real Chromium: independent corrupt resets, two-stage refusals, stale-consent CAS and mode isolation; no mobile claim');
    t.diagnostic('Real Chromium: first-order gate, two-tab protection, two independent corrupt downloads and stale-consent refusal; no mobile claim');
  });