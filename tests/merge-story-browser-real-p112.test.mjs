import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,readdir,mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve,extname,sep} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {BUILDINGS,getLevel,getMaxOrderTier} from '../merge/economy.mjs';
import {simulateStoryBoard} from '../merge/story/board-simulation.mjs';
import {validateSave} from '../merge/engine.mjs';

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
  {timeout:270000},async t=>{
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
    async function finishScene(id,p=a){
      await until(async()=>evalOn(p,"!document.getElementById('journey-read').hidden&&!document.getElementById('journey-read').disabled"),'readable '+id);
      await evalOn(p,"document.getElementById('journey-read').click();true");
      await until(async()=>evalOn(p,"document.getElementById('story-dialog').open"),'dialog '+id);
      assert.equal(await evalOn(p,"document.getElementById('story-dialog').open"),true);
      await evalOn(p,"document.querySelector('#dialog-choices button')?.click();true");
      await evalOn(p,"document.getElementById('complete-story').click();true");
      await until(async()=>{
        const data=await readJSON(p,storyKey);
        return data.packs.core.completed.main.includes(id);
      },'persist '+id);
      await until(async()=>evalOn(p,"!document.getElementById('story-dialog').open"),'dialog closed '+id);
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
    // P116: a REAL first order is fulfilled through the rendered workshop
    // button after independent damaged-save recovery, never by editing
    // localStorage or calling engine functions directly from the test.
    await navigate(b,'/merge/story.html','#journey-read');
    await until(async()=>evalOn(b,
      "document.getElementById('save-state')?.textContent.includes('已保存')"),
      'recovered narrative ready for real first order');
    await finishScene('arrival',b);
    await finishScene('signboard',b);
    await navigate(b,'/merge/story-workshop.html','#workshop-board');
    await until(async()=>evalOn(b,
      "document.querySelectorAll('#workshop-board button').length===56"),
      'recovered board ready for real order');
    const initialOrderState=await readJSON(b,workshopKey);
    assert.equal(initialOrderState.progress.orders,0,'recovery starts with zero orders');
    const readyOrderIndex=initialOrderState.orders.findIndex(order=>
      initialOrderState.board.some(item=>item?.kind==='material'&&
        item.chain===order.chain&&item.tier===order.tier));
    assert.ok(readyOrderIndex>=0,'starting board must contain a deliverable real order');
    assert.equal(await evalOn(b,
      "document.querySelectorAll('#workshop-orders .workshop-order button')["+
      readyOrderIndex+"].disabled"),false);
    await evalOn(b,
      "document.querySelectorAll('#workshop-orders .workshop-order button')["+
      readyOrderIndex+"].click();true");
    await until(async()=>{
      try{return (await readJSON(b,workshopKey)).progress.orders===1;}
      catch{return false;}
    },'real first-order delivery persisted');
    const delivered=await readJSON(b,workshopKey);
    assert.ok(delivered.coins>0,'real order grants story-only coins');
    assert.equal(delivered.revision,initialOrderState.revision+1,
      'first delivery is one transaction, not an auto-replayed order');
    const deliveredRaw=await readRaw(b,workshopKey);
    assert.equal(await readRaw(b,normalKey),'normal-mode-sentinel');
    await navigate(b,'/merge/story.html','#journey-read');
    await until(async()=>evalOn(b,
      "!document.getElementById('journey-read').hidden&&"+
      "document.getElementById('progress-count').textContent.includes('2 / 12')"),
      'real first-order unlock reflected in narrative UI');
    assert.equal(await evalOn(b,
      "document.getElementById('journey-workshop').hidden"),true,
      'after delivery, story should offer the next scene instead of another order');
    await finishScene('first-order',b);
    assert.deepEqual((await readJSON(b,storyKey)).packs.core.completed.main,
      ['arrival','signboard','first-order'],
      'real order must unlock exactly the next narrative scene');
    assert.equal(await readRaw(b,workshopKey),deliveredRaw,
      'reading the unlocked scene cannot replay the order or spend coins');
    assert.equal(await readRaw(b,normalKey),'normal-mode-sentinel');

    // P117: chapter-two causal order and garden economy gate through actual
    // rendered scene buttons, without injecting progress or granting coins.
    await finishScene('ledger',b);
    await finishScene('garden-path',b);
    await finishScene('seed',b);
    const chapterTwoProgress=await readJSON(b,storyKey);
    assert.deepEqual(chapterTwoProgress.packs.core.completed.main,
      ['arrival','signboard','first-order','ledger','garden-path','seed'],
      'six main scenes must persist in causal order before garden construction');
    await until(async()=>evalOn(b,
      "document.getElementById('progress-count').textContent.includes('6 / 12')&&"+
      "!document.getElementById('journey-workshop').hidden"),
      'chapter-two garden requirement displayed');
    assert.equal(await evalOn(b,"document.getElementById('journey-read').hidden"),true,
      'tea-table must not be readable before a real garden build');
    assert.equal(await evalOn(b,
      "document.getElementById('journey-workshop').getAttribute('href')"),
      './story-workshop.html#garden-goal',
      'chapter-two locked narrative must route to its real garden goal');
    assert.match(await evalOn(b,
      "document.getElementById('journey-guidance').textContent"),/花园/);
    const beforeGardenVisit=await readRaw(b,workshopKey);
    await navigate(b,'/merge/story-workshop.html','#workshop-board');
    await until(async()=>evalOn(b,
      "document.querySelectorAll('#workshop-board button').length===56"),
      'chapter-two real workshop board restored');
    assert.equal(await evalOn(b,"document.getElementById('build-garden').disabled"),true,
      'narrative permission alone must not bypass the garden level/coin cost');
    assert.match(await evalOn(b,"document.getElementById('garden-hint').textContent"),
      /需要.*级.*金币/,
      'garden hint must describe actual economy requirements after seed scene');
    for(const id of ['build-harbor','build-storefront']){
      assert.equal(await evalOn(b,
        "document.getElementById("+JSON.stringify(id)+").disabled"),true,
        'later buildings remain locked before their narrative prerequisites');
    }
    assert.equal(await readRaw(b,workshopKey),beforeGardenVisit,
      'viewing a chapter-two locked building must not spend or rewrite workshop');
    assert.equal(await readRaw(b,normalKey),'normal-mode-sentinel');
    await navigate(b,'/merge/story.html','#journey-read');
    await until(async()=>evalOn(b,
      "document.getElementById('progress-count').textContent.includes('6 / 12')"),
      'chapter-two narrative survives workshop return');
    assert.equal(await evalOn(b,"document.getElementById('journey-read').hidden"),true);
    assert.equal(await readRaw(b,workshopKey),beforeGardenVisit,
      'chapter-two round-trip must not auto-build the garden');
    assert.equal(await readRaw(b,normalKey),'normal-mode-sentinel');
    // P118: the next two real orders must come from the actual starting board.
    // A bakery tier-2 material is already present; floral tier-2 requires
    // merging the two genuine floral tier-1 materials through the 56-cell UI.
    // Neither order should bypass the garden's level/coin requirements.
    await navigate(b,'/merge/story-workshop.html','#workshop-board');
    await until(async()=>evalOn(b,
      "document.querySelectorAll('#workshop-board button').length===56"),
      'chapter-two workshop ready for subsequent real orders');
    const beforeSecondOrder=await readJSON(b,workshopKey);
    assert.equal(beforeSecondOrder.progress.orders,1);
    const bakeryOrderIndex=beforeSecondOrder.orders.findIndex(order=>
      order.chain==='bakery'&&order.tier===2);
    assert.ok(bakeryOrderIndex>=0,'a real bakery tier-2 order must exist');
    assert.ok(beforeSecondOrder.board.some(item=>item?.kind==='material'&&
      item.chain==='bakery'&&item.tier===2),
      'initial board must still contain an actual bakery tier-2 material');
    assert.equal(await evalOn(b,
      "document.querySelectorAll('#workshop-orders .workshop-order button')["+
      bakeryOrderIndex+"].disabled"),false);
    await evalOn(b,
      "document.querySelectorAll('#workshop-orders .workshop-order button')["+
      bakeryOrderIndex+"].click();true");
    await until(async()=>{
      try{return (await readJSON(b,workshopKey)).progress.orders===2;}
      catch{return false;}
    },'second real order persisted');
    const afterSecondOrder=await readJSON(b,workshopKey);
    assert.equal(afterSecondOrder.revision,beforeSecondOrder.revision+1,
      'second order must be one real transaction');
    assert.ok(afterSecondOrder.coins>beforeSecondOrder.coins);
    assert.ok(afterSecondOrder.xp>beforeSecondOrder.xp);
    assert.equal(afterSecondOrder.buildings.garden,0);

    const floralSlots=afterSecondOrder.board.flatMap((item,index)=>
      item?.kind==='material'&&item.chain==='floral'&&item.tier===1?[index]:[]);
    assert.ok(floralSlots.length>=2,'two real floral tier-1 materials must remain');
    await evalOn(b,
      "document.querySelectorAll('#workshop-board button')["+floralSlots[0]+"].click();true");
    await evalOn(b,
      "document.querySelectorAll('#workshop-board button')["+floralSlots[1]+"].click();true");
    await until(async()=>{
      try{return (await readJSON(b,workshopKey)).revision===afterSecondOrder.revision+1;}
      catch{return false;}
    },'real floral merge persisted');
    const afterMerge=await readJSON(b,workshopKey);
    assert.ok(afterMerge.board.some(item=>item?.kind==='material'&&
      item.chain==='floral'&&item.tier===2),
      'real UI merge must create a floral tier-2 material');
    assert.equal(afterMerge.progress.orders,2,'merging cannot grant an order reward');
    const floralOrderIndex=afterMerge.orders.findIndex(order=>
      order.chain==='floral'&&order.tier===2);
    assert.ok(floralOrderIndex>=0,'a real floral tier-2 order must exist');
    assert.equal(await evalOn(b,
      "document.querySelectorAll('#workshop-orders .workshop-order button')["+
      floralOrderIndex+"].disabled"),false);
    await evalOn(b,
      "document.querySelectorAll('#workshop-orders .workshop-order button')["+
      floralOrderIndex+"].click();true");
    await until(async()=>{
      try{return (await readJSON(b,workshopKey)).progress.orders===3;}
      catch{return false;}
    },'third real order persisted');
    const afterThirdOrder=await readJSON(b,workshopKey);
    assert.equal(afterThirdOrder.revision,afterMerge.revision+1,
      'third order must be exactly one transaction');
    assert.ok(afterThirdOrder.coins>afterMerge.coins);
    assert.ok(afterThirdOrder.xp>afterMerge.xp);
    assert.equal(afterThirdOrder.buildings.garden,0);
    assert.equal(await evalOn(b,"document.getElementById('build-garden').disabled"),true,
      'three real orders must not bypass garden level/coin requirements');
    assert.equal(await readRaw(b,normalKey),'normal-mode-sentinel');

    const threeOrdersRaw=await readRaw(b,workshopKey);
    await navigate(b,'/merge/story.html','#journey-read');
    await until(async()=>evalOn(b,
      "document.getElementById('progress-count').textContent.includes('6 / 12')"),
      'chapter-two story unchanged after two more real orders');
    assert.equal(await evalOn(b,"document.getElementById('journey-read').hidden"),true,
      'garden construction, not order count alone, unlocks the tea-table scene');
    assert.equal(await evalOn(b,"document.getElementById('journey-workshop').hidden"),false);
    assert.equal(await readRaw(b,workshopKey),threeOrdersRaw,
      'returning to narrative must not replay a delivered order');
    await call('Page.reload',{ignoreCache:true},b.sessionId);
    await until(async()=>evalOn(b,
      "document.getElementById('progress-count')?.textContent.includes('6 / 12')"),
      'chapter-two story reload after three real orders');
    assert.equal(await evalOn(b,"document.getElementById('journey-read').hidden"),true);
    assert.equal(await readRaw(b,workshopKey),threeOrdersRaw,
      'narrative reload must not rewrite the three-order workshop save');
    assert.equal(await readRaw(b,normalKey),'normal-mode-sentinel');

    // Return to the workshop after the P118 narrative reload. The order
    // buttons exist only on the workshop page; never inject engine actions.
    await navigate(b,'/merge/story-workshop.html','#workshop-board');
    await until(async()=>evalOn(b,
      "document.querySelectorAll('#workshop-board button').length===56"),
      'P119 real workshop ready after narrative reload');
    assert.equal((await readJSON(b,workshopKey)).progress.orders,3);
    // P119: the real order generator rotates back to tea and bakery after
    // three deliveries. Use only the existing tier-1 pieces and rendered
    // 56-cell buttons to complete two more genuine tier-2 requests.
    // Each merge and fulfillment must be exactly one persisted transaction.
    for(const chain of ['tea','bakery']){
      const beforeOrder=await readJSON(b,workshopKey);
      const targetOrderIndex=beforeOrder.orders.findIndex(order=>
        order.chain===chain&&order.tier===2);
      assert.ok(targetOrderIndex>=0,chain+' next real tier-2 order exists');
      const sourceSlots=beforeOrder.board.flatMap((item,index)=>
        item?.kind==='material'&&item.chain===chain&&item.tier===1?[index]:[]);
      assert.ok(sourceSlots.length>=2,chain+' has two genuine tier-1 pieces');
      await evalOn(b,
        "document.querySelectorAll('#workshop-board button')["+sourceSlots[0]+"].click();true");
      await evalOn(b,
        "document.querySelectorAll('#workshop-board button')["+sourceSlots[1]+"].click();true");
      await until(async()=>{
        try{return (await readJSON(b,workshopKey)).revision===beforeOrder.revision+1;}
        catch{return false;}
      },chain+' real tier-1 merge persisted');
      const merged=await readJSON(b,workshopKey);
      assert.equal(merged.progress.orders,beforeOrder.progress.orders,
        'merging '+chain+' cannot award a phantom order');
      assert.equal(merged.coins,beforeOrder.coins,'merge cannot award coins');
      assert.equal(merged.xp,beforeOrder.xp,'merge cannot award experience');
      assert.ok(merged.board.some(item=>item?.kind==='material'&&
        item.chain===chain&&item.tier===2),
        chain+' tier-2 must exist after actual UI merge');
      assert.equal(await evalOn(b,
        "document.querySelectorAll('#workshop-orders .workshop-order button')["+
        targetOrderIndex+"].disabled"),false);
      await evalOn(b,
        "document.querySelectorAll('#workshop-orders .workshop-order button')["+
        targetOrderIndex+"].click();true");
      await until(async()=>{
        try{return (await readJSON(b,workshopKey)).progress.orders===
          beforeOrder.progress.orders+1;}
        catch{return false;}
      },chain+' real tier-2 delivery persisted');
      const deliveredNext=await readJSON(b,workshopKey);
      assert.equal(deliveredNext.revision,merged.revision+1,
        chain+' delivery must commit exactly once');
      assert.ok(deliveredNext.coins>merged.coins,'real order earns coins');
      assert.ok(deliveredNext.xp>merged.xp,'real order earns experience');
      assert.equal(deliveredNext.buildings.garden,0,
        'orders cannot silently build the garden');
      assert.equal(await readRaw(b,normalKey),'normal-mode-sentinel');
    }
    const fiveOrders=await readJSON(b,workshopKey);
    assert.equal(fiveOrders.progress.orders,5,
      'two further real deliveries must persist after the initial three');
    assert.ok(fiveOrders.xp>=28&&fiveOrders.xp<190,
      'five real deliveries reach early progression but not garden level 4');
    assert.ok(fiveOrders.coins<160,
      'five real deliveries cannot bypass the 160-coin garden cost');
    assert.equal(await evalOn(b,"document.getElementById('build-garden').disabled"),true);
    // P120: read-only deficits from the actual five-order browser state.
    const hint=await evalOn(b,"document.getElementById('garden-hint').textContent");
    assert.ok(hint.includes('还差 '+(190-fiveOrders.xp)+' 经验'),
      'exact level-four XP deficit after five genuine deliveries');
    assert.ok(hint.includes('还差 '+(160-fiveOrders.coins)+' 金币'),
      'exact garden coin deficit after five genuine deliveries');
    assert.equal((await readJSON(b,workshopKey)).revision,fiveOrders.revision,
      'reading resource guidance cannot commit or grant rewards');
    const fiveOrdersRaw=await readRaw(b,workshopKey);
    await navigate(b,'/merge/story.html','#journey-read');
    await until(async()=>evalOn(b,
      "document.getElementById('progress-count').textContent.includes('6 / 12')"),
      'five real orders must not skip chapter-two garden construction');
    assert.equal(await evalOn(b,"document.getElementById('journey-read').hidden"),true);
    assert.equal(await readRaw(b,workshopKey),fiveOrdersRaw,
      'story re-entry cannot replay fourth or fifth order');
    assert.equal(await readRaw(b,normalKey),'normal-mode-sentinel');

    // P131: continue the SAME browser save through fifteen more genuine orders.
    // No snapshot injection, direct engine call, clock override or RNG stub:
    // every production, merge and delivery uses the rendered 56-cell UI.
    await navigate(b,'/merge/story-workshop.html','#workshop-board');
    await until(async()=>evalOn(b,
      "document.querySelectorAll('#workshop-board button').length===56"),
      'P125 continuous browser economy ready');
    for(let goal=6;goal<=20;goal++){
      const baseline=await readJSON(b,workshopKey);
      assert.equal(baseline.progress.orders,goal-1);
      for(let step=0;step<72;step++){
        const current=await readJSON(b,workshopKey);
        if(current.progress.orders===goal)break;
        const readyIndex=current.orders.findIndex(order=>
          current.board.some(item=>item?.kind==='material'&&
            item.chain===order.chain&&item.tier===order.tier));
        let click;
        if(readyIndex>=0){
          click="document.querySelectorAll('#workshop-orders .workshop-order button')["+
            readyIndex+"].click();true";
        }else{
          const tierLimit=getMaxOrderTier(current.xp);
          let pair=null;
          for(let i=0;i<current.board.length&&!pair;i++){
            const item=current.board[i];
            if(item?.kind!=='material'||item.tier>=tierLimit)continue;
            const j=current.board.findIndex((other,k)=>k>i&&
              other?.kind==='material'&&other.chain===item.chain&&other.tier===item.tier);
            if(j>=0)pair=[i,j];
          }
          if(pair){
            await evalOn(b,"document.querySelectorAll('#workshop-board button')["+
              pair[0]+"].click();true");
            click="document.querySelectorAll('#workshop-board button')["+
              pair[1]+"].click();true";
          }else{
            const target=current.orders.slice().sort((a,b)=>
              a.tier-b.tier||Number(a.id.slice(1))-Number(b.id.slice(1)))[0];
            if(current.energy===0){
              // Earned one-time items may recover energy; no injected resources.
              const supply=['soda','meal'].find(id=>current.bag[id]>0);
              assert.ok(supply,'P131 energy depleted without an earned recovery item');
              click="document.querySelector('#story-supply-bag [data-supply-use="+
                JSON.stringify(supply)+"]').click();true";
            }else{
              const slot=current.board.findIndex(item=>item?.kind==='producer'&&
                item.chain===target.chain);
              assert.ok(slot>=0,'P131 real producer exists for '+target.chain);
              const producer=current.board[slot];
              if(producer.charges===0&&producer.cooldownUntil>Date.now()+3000){
                const cooldownRaw=await readRaw(b,workshopKey);
                await evalOn(b,"document.querySelectorAll('#workshop-board button')["+
                  slot+"].click();true");
                assert.equal(await readRaw(b,workshopKey),cooldownRaw,
                  'cooling producer must not spend energy or commit a save');
                assert.match(await evalOn(b,
                  "document.getElementById('board-notice').textContent"),/冷却/);
              }
              if(producer.charges===0){
                const waitMs=Math.max(0,producer.cooldownUntil-Date.now()+150);
                assert.ok(waitMs<=46000,'P131 cooldown must be bounded by real rules');
                await sleep(waitMs); // genuine elapsed wall time, no clock override
              }
              click="document.querySelectorAll('#workshop-board button')["+
                slot+"].click();true";
            }
          }
        }
        await evalOn(b,click);
        await until(async()=>{
          try{return (await readJSON(b,workshopKey)).revision===current.revision+1;}
          catch{return false;}
        },'P125 persisted genuine UI action toward order '+goal);
        const updated=await readJSON(b,workshopKey);
        assert.equal(validateSave(updated),true,'every UI action retains strict save schema');
        assert.ok(updated.energy>=0&&updated.energy<=120,
          'each genuine UI action must preserve finite energy bounds');
        assert.ok(updated.progress.orders>=current.progress.orders&&
          updated.progress.orders<=current.progress.orders+1,
          'one UI action cannot silently grant multiple orders');
        assert.equal(await readRaw(b,normalKey),'normal-mode-sentinel');
      }
      const delivered=await readJSON(b,workshopKey);
      assert.equal(delivered.progress.orders,goal,
        'P125 must finish each genuine order without a test fixture');
      assert.ok(delivered.coins>baseline.coins&&delivered.xp>baseline.xp,
        'genuine UI delivery must earn coins and experience');
      assert.equal(delivered.buildings.garden,0,
        'orders cannot silently bypass garden construction');
      assert.ok(delivered.revision>baseline.revision,
        'each new delivered order must follow real persisted UI actions');
    }
    const twentyOrders=await readJSON(b,workshopKey);
    assert.equal(twentyOrders.progress.orders,20,'twenty consecutive orders must be genuinely delivered');
    assert.equal(validateSave(twentyOrders),true,'twenty-order UI save remains strictly valid');
    assert.ok(twentyOrders.energy>=0&&twentyOrders.energy<=120,
      'continuous UI production must not invent or underflow energy');
    assert.equal(twentyOrders.achievements.orders20,1,
      'twentieth real UI delivery must award the one-time milestone');
    assert.equal(twentyOrders.bag.reset,1,
      'one genuine reset card must be earned, not injected');
    const twentyOrdersRaw=await readRaw(b,workshopKey);
    await navigate(b,'/merge/story.html','#journey-read');
    await until(async()=>evalOn(b,
      "document.getElementById('progress-count').textContent.includes('6 / 12')"),
      'P131 narrative remains garden-gated after twenty real UI orders');
    assert.equal(await evalOn(b,"document.getElementById('journey-read').hidden"),true);
    assert.equal(await readRaw(b,workshopKey),twentyOrdersRaw,
      'narrative navigation cannot replay the sixth to twentieth UI deliveries');
    await navigate(b,'/merge/story-workshop.html','#workshop-board');
    await until(async()=>evalOn(b,
      "document.querySelectorAll('#workshop-board button').length===56"),
      'P131 workshop reload after twenty real UI orders');
    assert.equal(await readRaw(b,workshopKey),twentyOrdersRaw,
      'all twenty genuine orders survive a story/workshop round trip');
    assert.equal(await readRaw(b,normalKey),'normal-mode-sentinel');
    // P124: use ONE deterministic, engine-earned economic lineage for all
    // three PRE-build snapshots and their POST-build audit checkpoints.
    // The first twenty orders above are real UI actions; later progress is
    // loaded as test fixtures, NOT continuous UI grinding or device testing.
    const preBuild={},postBuild={};
    const economicReplay=simulateStoryBoard({seed:42,
      onConstructionReady:(id,snapshot)=>{preBuild[id]=snapshot;},
      onMilestone:(milestone,snapshot)=>{
        if(['garden','harbor','storefront'].includes(milestone.id))
          postBuild[milestone.id]=snapshot;
      }
    });
    assert.equal(economicReplay.complete,true,economicReplay.reason);
    for(const id of ['garden','harbor','storefront']){
      assert.equal(validateSave(preBuild[id]),true);
      assert.equal(validateSave(postBuild[id]),true);
      assert.equal(preBuild[id].buildings[id],0);
      assert.equal(postBuild[id].buildings[id],1);
      assert.ok(getLevel(preBuild[id].xp)>=BUILDINGS[id].minLevel);
      assert.ok(preBuild[id].coins>=BUILDINGS[id].coins);
      assert.equal(postBuild[id].coins,preBuild[id].coins-BUILDINGS[id].coins);
      assert.equal(postBuild[id].revision,preBuild[id].revision+1);
    }
    assert.equal(preBuild.harbor.buildings.garden,1);
    assert.equal(preBuild.storefront.buildings.harbor,1);
    const earnedFixture=preBuild.garden;
    assert.equal(await readRaw(b,normalKey),'normal-mode-sentinel');
    await evalOn(b,'localStorage.setItem('+
      JSON.stringify(workshopKey)+','+
      JSON.stringify(JSON.stringify(earnedFixture))+');true');
    await navigate(b,'/merge/story-workshop.html','#workshop-board');
    await until(async()=>evalOn(b,
      "document.querySelectorAll('#workshop-board button').length===56&&"+
      "document.getElementById('build-garden').disabled===false"),
      'P122 genuine earned garden resources enable browser construction');
    assert.match(await evalOn(b,
      "document.getElementById('garden-hint').textContent"),
      /等级与金币均已达标/);
    assert.equal(await evalOn(b,"document.getElementById('build-harbor').disabled"),true,
      'later harbor cannot unlock from garden resources alone');
    assert.equal(await evalOn(b,"document.getElementById('build-storefront').disabled"),true);
    const prebuildRaw=await readRaw(b,workshopKey);
    assert.deepEqual(JSON.parse(prebuildRaw),earnedFixture);
    // P125: a second real tab observes the same build-ready save BEFORE the
    // first tab spends 160 coins. It must never double-charge a stale view.
    const staleGardenTab=await page();await front(staleGardenTab);
    await navigate(staleGardenTab,'/merge/story-workshop.html','#workshop-board');
    await until(async()=>evalOn(staleGardenTab,
      "document.getElementById('build-garden')?.disabled===false"),
      'P125 peer tab sees garden build-ready state');
    await front(b);
    await evalOn(b,"document.getElementById('build-garden').click();true");
    await until(async()=>{
      try{return (await readJSON(b,workshopKey)).buildings.garden===1;}
      catch{return false;}
    },'P122 actual browser garden construction persisted');
    const builtGarden=await readJSON(b,workshopKey);
    assert.equal(builtGarden.revision,earnedFixture.revision+1,
      'real garden click must commit exactly one revision');
    assert.equal(builtGarden.coins,earnedFixture.coins-BUILDINGS.garden.coins,
      'real garden click must deduct the configured 160 coins once');
    assert.equal(builtGarden.xp,earnedFixture.xp,
      'building must not fabricate experience');
    assert.equal(validateSave(builtGarden),true);
    assert.equal(builtGarden.revision,postBuild.garden.revision,
      'browser garden transaction matches the same economic replay');
    assert.equal(builtGarden.coins,postBuild.garden.coins);
    assert.equal(builtGarden.xp,postBuild.garden.xp);
    assert.deepEqual(builtGarden.buildings,postBuild.garden.buildings);
    await until(async()=>evalOn(b,
      "document.getElementById('build-garden').disabled===true&&"+
      "document.getElementById('garden-status').textContent.includes('已修复')"),
      'P122 browser UI reflects completed garden');
    const builtGardenRaw=await readRaw(b,workshopKey);
    await front(staleGardenTab);
    await until(async()=>evalOn(staleGardenTab,
      "document.getElementById('build-garden')?.disabled===true"),
      'P125 stale garden tab cannot retain an enabled build action');
    await evalOn(staleGardenTab,"document.getElementById('build-garden').click();true");
    assert.equal(await readRaw(staleGardenTab,workshopKey),builtGardenRaw,
      'stale tab cannot spend garden cost a second time');
    await call('Target.closeTarget',{targetId:staleGardenTab.targetId});
    await front(b);
    await evalOn(b,"document.getElementById('build-garden').click();true");
    assert.equal(await readRaw(b,workshopKey),builtGardenRaw,
      'disabled garden button cannot double-charge');
    assert.equal(await readRaw(b,normalKey),'normal-mode-sentinel');
    await navigate(b,'/merge/story.html','#journey-read');
    await until(async()=>evalOn(b,
      "document.getElementById('progress-count').textContent.includes('6 / 12')&&"+
      "!document.getElementById('journey-read').hidden"),
      'P122 completed garden unlocks the next narrative scene');
    await finishScene('tea-table',b);
    assert.deepEqual((await readJSON(b,storyKey)).packs.core.completed.main,
      ['arrival','signboard','first-order','ledger','garden-path','seed','tea-table']);
    assert.equal(await readRaw(b,workshopKey),builtGardenRaw,
      'reading tea-table cannot replay the building payment');
    await navigate(b,'/merge/story-workshop.html','#workshop-board');
    await until(async()=>evalOn(b,
      "document.getElementById('garden-status').textContent.includes('已修复')"),
      'P122 garden remains built after page round-trip');
    assert.equal(await readRaw(b,workshopKey),builtGardenRaw,
      'returning to workshop cannot duplicate the garden transaction');
    assert.equal(await readRaw(b,normalKey),'normal-mode-sentinel');
    // P124: the harbor and storefront pre-build snapshots above came from
    // the SAME replay as garden, but each is loaded separately into Chromium.
    // Compare each real UI build to its corresponding post-build checkpoint.

    await navigate(b,'/merge/story.html','#journey-read');
    await finishScene('old-pier',b);
    await finishScene('apprentice',b);
    await until(async()=>evalOn(b,
      "document.getElementById('progress-count').textContent.includes('9 / 12')&&"+
      "document.getElementById('journey-read').hidden"),'P123 harbor narrative gate');
    assert.equal(await evalOn(b,
      "document.getElementById('journey-workshop').getAttribute('href')"),
      './story-workshop.html#harbor-goal');
    assert.equal(await readRaw(b,workshopKey),builtGardenRaw,
      'reading apprentice safety lesson cannot change garden economy');
    await evalOn(b,'localStorage.setItem('+
      JSON.stringify(workshopKey)+','+JSON.stringify(JSON.stringify(preBuild.harbor))+');true');
    await navigate(b,'/merge/story-workshop.html','#workshop-board');
    await until(async()=>evalOn(b,
      "document.querySelectorAll('#workshop-board button').length===56&&"+
      "document.getElementById('build-harbor').disabled===false"),
      'P123 real harbor button enabled by earned engine snapshot');
    assert.equal(await evalOn(b,"document.getElementById('build-storefront').disabled"),true,
      'storefront must remain story-gated before harbor-light');
    assert.deepEqual(await readJSON(b,workshopKey),preBuild.harbor);
    // P126: a peer tab loaded BEFORE payment must not keep an actionable
    // harbor button or charge the same 330 coins after the first tab builds.
    const staleHarborTab=await page();await front(staleHarborTab);
    await navigate(staleHarborTab,'/merge/story-workshop.html','#workshop-board');
    await until(async()=>evalOn(staleHarborTab,
      "document.getElementById('build-harbor')?.disabled===false"),
      'P126 peer tab sees harbor build-ready state');
    await front(b);
    await evalOn(b,"document.getElementById('build-harbor').click();true");
    await until(async()=>(await readJSON(b,workshopKey)).buildings.harbor===1,
      'P123 harbor click persisted');
    const builtHarbor=await readJSON(b,workshopKey);
    assert.equal(builtHarbor.revision,preBuild.harbor.revision+1);
    assert.equal(builtHarbor.coins,preBuild.harbor.coins-BUILDINGS.harbor.coins);
    assert.equal(builtHarbor.xp,preBuild.harbor.xp);
    assert.equal(validateSave(builtHarbor),true);
    assert.equal(builtHarbor.revision,postBuild.harbor.revision);
    assert.equal(builtHarbor.coins,postBuild.harbor.coins);
    assert.equal(builtHarbor.xp,postBuild.harbor.xp);
    assert.deepEqual(builtHarbor.buildings,postBuild.harbor.buildings);
    const builtHarborRaw=await readRaw(b,workshopKey);
    await front(staleHarborTab);
    await until(async()=>evalOn(staleHarborTab,
      "document.getElementById('build-harbor')?.disabled===true"),
      'P126 stale harbor tab must disable construction');
    await evalOn(staleHarborTab,"document.getElementById('build-harbor').click();true");
    assert.equal(await readRaw(staleHarborTab,workshopKey),builtHarborRaw,
      'P126 stale harbor tab cannot spend 330 coins twice');
    await call('Target.closeTarget',{targetId:staleHarborTab.targetId});
    await front(b);
    await evalOn(b,"document.getElementById('build-harbor').click();true");
    assert.equal(await readRaw(b,workshopKey),builtHarborRaw,
      'harbor cannot be double-charged');
    await navigate(b,'/merge/story.html','#journey-read');
    await finishScene('harbor-light',b);
    assert.equal(await readRaw(b,workshopKey),builtHarborRaw,
      'harbor-light narrative cannot repeat construction');
    await until(async()=>evalOn(b,
      "document.getElementById('progress-count').textContent.includes('10 / 12')&&"+
      "document.getElementById('journey-read').hidden"),
      'P123 storefront story gate');
    assert.equal(await evalOn(b,
      "document.getElementById('journey-workshop').getAttribute('href')"),
      './story-workshop.html#storefront-goal');
    await evalOn(b,'localStorage.setItem('+
      JSON.stringify(workshopKey)+','+JSON.stringify(JSON.stringify(preBuild.storefront))+');true');
    await navigate(b,'/merge/story-workshop.html','#workshop-board');
    await until(async()=>evalOn(b,
      "document.querySelectorAll('#workshop-board button').length===56&&"+
      "document.getElementById('build-storefront').disabled===false"),
      'P123 real storefront button enabled by earned engine snapshot');
    assert.equal(await evalOn(b,"document.getElementById('build-harbor').disabled"),true);
    assert.deepEqual(await readJSON(b,workshopKey),preBuild.storefront);
    // P126: repeat the stale-tab protection at the fourth-chapter finale.
    // This is an actual second Chromium page, not a storage mock.
    const staleStorefrontTab=await page();await front(staleStorefrontTab);
    await navigate(staleStorefrontTab,'/merge/story-workshop.html','#workshop-board');
    await until(async()=>evalOn(staleStorefrontTab,
      "document.getElementById('build-storefront')?.disabled===false"),
      'P126 peer tab sees storefront build-ready state');
    await front(b);
    await evalOn(b,"document.getElementById('build-storefront').click();true");
    await until(async()=>(await readJSON(b,workshopKey)).buildings.storefront===1,
      'P123 storefront click persisted');
    const builtStorefront=await readJSON(b,workshopKey);
    assert.equal(builtStorefront.revision,preBuild.storefront.revision+1);
    assert.equal(builtStorefront.coins,
      preBuild.storefront.coins-BUILDINGS.storefront.coins);
    assert.equal(builtStorefront.xp,preBuild.storefront.xp);
    assert.equal(validateSave(builtStorefront),true);
    assert.equal(builtStorefront.revision,postBuild.storefront.revision);
    assert.equal(builtStorefront.coins,postBuild.storefront.coins);
    assert.equal(builtStorefront.xp,postBuild.storefront.xp);
    assert.deepEqual(builtStorefront.buildings,postBuild.storefront.buildings);
    const builtStorefrontRaw=await readRaw(b,workshopKey);
    await front(staleStorefrontTab);
    await until(async()=>evalOn(staleStorefrontTab,
      "document.getElementById('build-storefront')?.disabled===true"),
      'P126 stale storefront tab must disable construction');
    await evalOn(staleStorefrontTab,"document.getElementById('build-storefront').click();true");
    assert.equal(await readRaw(staleStorefrontTab,workshopKey),builtStorefrontRaw,
      'P126 stale storefront tab cannot spend 60 coins twice');
    await call('Target.closeTarget',{targetId:staleStorefrontTab.targetId});
    await front(b);
    await evalOn(b,"document.getElementById('build-storefront').click();true");
    assert.equal(await readRaw(b,workshopKey),builtStorefrontRaw,
      'storefront cannot be double-charged');
    await navigate(b,'/merge/story.html','#journey-read');
    await finishScene('festival',b);
    await finishScene('letter-answer',b);
    assert.equal((await readJSON(b,storyKey)).packs.core.completed.main.length,12);
    assert.equal(await readRaw(b,workshopKey),builtStorefrontRaw,
      'festival finale must not grant extra money or rewrite workshop');
    assert.equal(await readRaw(b,normalKey),'normal-mode-sentinel');
    await call('Page.reload',{ignoreCache:true},b.sessionId);
    await until(async()=>evalOn(b,
      "document.getElementById('progress-count')?.textContent.includes('12 / 12')"),
      'P123 full first-volume finale persists after reload');
    assert.equal(await evalOn(b,"document.getElementById('journey-read').hidden"),true);
    assert.equal(await evalOn(b,"document.getElementById('journey-workshop').hidden"),true);
    assert.equal(await readRaw(b,workshopKey),builtStorefrontRaw);
    assert.equal(await readRaw(b,normalKey),'normal-mode-sentinel');
    t.diagnostic('P130 real Chromium: fourteen consecutive UI orders survive story/workshop navigation; each action preserves finite energy and at-most-one-order progress; later buildings still use detached engine-earned fixtures, not full UI completion');
    t.diagnostic('P126 real Chromium: stale peer tabs cannot double-charge garden, harbor or storefront; not iPhone/WeChat device testing');
    t.diagnostic('P123 real Chromium: harbor + storefront buttons charge once; chapters 3-4 reach 12/12; later economy uses detached real-engine pre-build fixtures, not continuous UI grinding');
    t.diagnostic('P122 Chromium: real garden button deducts once and unlocks tea-table; post-five-order economy uses an engine-earned fixture, not continuous UI grinding');
    t.diagnostic('P119 real Chromium: tea and bakery tier-1 UI merges → fourth and fifth real deliveries; garden remains locked, normal mode isolated');
    t.diagnostic('P118 real Chromium: second bakery order + floral UI merge + third order; garden remains gated, save survives narrative reload');
    t.diagnostic('P117 real Chromium: first six scenes → garden economic gate → round-trip, no premature build or normal-mode writes');
    t.diagnostic('P116 real Chromium: damaged-save recovery → real order button → first-order scene unlock, no normal-mode writes');
    t.diagnostic('P115 real Chromium: independent corrupt resets, two-stage refusals, stale-consent CAS and mode isolation; no mobile claim');
    t.diagnostic('Real Chromium: first-order gate, two-tab protection, two independent corrupt downloads and stale-consent refusal; no mobile claim');
  });