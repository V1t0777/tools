import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve,extname,sep} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {createEmptyStoryProgress,STORY_SAVE_KEY,GAME_MODES,getModeSaveKey} from '../merge/mode-boundaries.mjs';
import {CORE_STORY_PACK} from '../merge/story/core-pack.mjs';
import {startCoreStory,completeStoryEntry,dailyStoryIncident,pinDailyStoryIncident} from '../merge/story/runtime.mjs';

// P155: two real same-origin Chromium tabs, real StorageEvent and real story UI.
// The initial narrative fixture is injected; this is NOT a full four-chapter
// playthrough, BFCache certification, or an iPhone/WeChat device test.
const root=resolve(new URL('..',import.meta.url).pathname);
const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript',
  '.css':'text/css','.svg':'image/svg+xml','.json':'application/json'};
const normalKey=getModeSaveKey(GAME_MODES.NORMAL);
const workshopKey='toolbox.merge-isle.story.workshop.local.v1';
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
  const ready=new Promise((resolve,reject)=>{
    ws.addEventListener('open',resolve,{once:true});
    ws.addEventListener('error',reject,{once:true});
  });
  ws.addEventListener('message',event=>{
    const data=JSON.parse(event.data),item=pending.get(data.id);
    if(!item)return;
    pending.delete(data.id);clearTimeout(item.timer);
    if(data.error)item.reject(Error(JSON.stringify(data.error)));
    else item.resolve(data.result);
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
function pinnedCrateFixture(){
  const pack=CORE_STORY_PACK;
  const crate=pack.entries.find(entry=>entry.id==='old-crate');
  assert.ok(crate);
  let progress=startCoreStory(createEmptyStoryProgress(),pack);
  for(const entry of pack.entries.filter(item=>item.kind==='main')){
    progress=completeStoryEntry(progress,pack,entry.id,entry.choices[0]?.id??null);
    if(entry.id==='harbor-light')break;
  }
  const day=Array.from({length:31},(_,i)=>'2026-10-'+String(i+1).padStart(2,'0'))
    .find(key=>dailyStoryIncident(progress,pack,key)===crate);
  assert.ok(day,'October fixture must select old-crate');
  const pinned=pinDailyStoryIncident(progress,pack,day);
  return {day,crate,pinned,raw:JSON.stringify(pinned)};
}

test('P155 real Chromium tabs: a peer completes a pinned one-off; stale UI blocks, reload replays read-only',
  {timeout:180000},async t=>{
    const chrome=chromePath();
    assert.ok(chrome,'A real Chrome/Chromium binary is required; no mock fallback');
    const fixture=pinnedCrateFixture();
    const temp=await mkdtemp(join(tmpdir(),'yunyu-oneoff-tabs-'));
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
    const timestamp=Date.parse(fixture.day+'T04:00:00Z'); // 12:00 in Asia/Shanghai
    async function page(){
      const {targetId}=await call('Target.createTarget',{url:'about:blank'});
      const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
      await call('Page.enable',{},sessionId);
      await call('Runtime.enable',{},sessionId);
      await call('Emulation.setTimezoneOverride',{timezoneId:'Asia/Shanghai'},sessionId);
      await call('Page.addScriptToEvaluateOnNewDocument',{source:
        '(()=>{const NativeDate=Date;const fixed='+timestamp+';'+
        'window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[fixed]));}'+
        'static now(){return fixed;}};})();'
      },sessionId);
      return {targetId,sessionId};
    }
    async function evalOn(p,expression){
      const result=await call('Runtime.evaluate',{
        expression,returnByValue:true,awaitPromise:true,userGesture:true
      },p.sessionId);
      if(result.exceptionDetails)throw Error('Browser JS: '+JSON.stringify(result.exceptionDetails));
      return result.result.value;
    }
    async function front(p){
      await call('Target.activateTarget',{targetId:p.targetId});
      await call('Page.bringToFront',{},p.sessionId);
    }
    async function navigate(p){
      await call('Page.navigate',{url:base+'/merge/story.html'},p.sessionId);
      await until(async()=>evalOn(p,
        "document.readyState==='complete'&&!!document.getElementById('journey-daily-read')"),
      'story document loaded');
    }
    const readRaw=(p,key)=>evalOn(p,'localStorage.getItem('+JSON.stringify(key)+')');
    const a=await page();await front(a);await navigate(a);
    await until(async()=>readRaw(a,STORY_SAVE_KEY),'initial story save');
    await evalOn(a,'localStorage.setItem('+JSON.stringify(STORY_SAVE_KEY)+','+
      JSON.stringify(fixture.raw)+');localStorage.setItem('+JSON.stringify(normalKey)+
      ',"normal-mode-sentinel");true');
    await call('Page.reload',{ignoreCache:true},a.sessionId);
    await until(async()=>evalOn(a,
      "document.getElementById('journey-daily-read')?.hidden===false&&"+
      "document.getElementById('journey-daily-read')?.disabled===false"),
    'pinned crate visible in first tab');
    assert.equal(await readRaw(a,STORY_SAVE_KEY),fixture.raw);
    const b=await page();await front(b);await navigate(b);
    await until(async()=>evalOn(b,
      "document.getElementById('journey-daily-read')?.hidden===false&&"+
      "document.getElementById('journey-daily-read')?.disabled===false"),
    'pinned crate visible in second tab');
    await front(a);
    await evalOn(a,"document.getElementById('journey-daily-read').click();true");
    await until(async()=>evalOn(a,"document.getElementById('story-dialog').open"),
      'stale first-tab incident dialogue opened');
    await evalOn(a,"document.querySelector('#dialog-choices button')?.click();true");
    await front(b);
    await evalOn(b,"document.getElementById('journey-daily-read').click();true");
    await until(async()=>evalOn(b,"document.getElementById('story-dialog').open"),
      'second-tab incident dialogue opened');
    await evalOn(b,"document.querySelector('#dialog-choices button')?.click();true");
    await until(async()=>evalOn(b,"!document.getElementById('complete-story').disabled"),
      'second-tab choice selected');
    await evalOn(b,"document.getElementById('complete-story').click();true");
    await until(async()=>{
      const raw=await readRaw(b,STORY_SAVE_KEY);
      return raw&&JSON.parse(raw).packs.core.completed.incident.includes('old-crate');
    },'second-tab one-off completion persisted');
    const committed=await readRaw(b,STORY_SAVE_KEY);
    assert.equal(JSON.parse(committed).revision,fixture.pinned.revision+1,
      'peer completion must be exactly one story revision');
    await front(a);
    await until(async()=>evalOn(a,
      "document.getElementById('save-state').textContent.includes('其他标签页')"),
    'stale tab blocked by real StorageEvent or resume snapshot');
    assert.equal(await evalOn(a,"document.getElementById('story-dialog').open"),false);
    await evalOn(a,"document.getElementById('complete-story').click();true");
    assert.equal(await readRaw(a,STORY_SAVE_KEY),committed,
      'stale tab must not replay its selected choice');
    await call('Page.reload',{ignoreCache:true},a.sessionId);
    await until(async()=>evalOn(a,
      "document.getElementById('journey-daily-read')?.hidden===false&&"+
      "document.getElementById('journey-daily-read').textContent.includes('回看')"),
    'completed pinned incident available for read-only replay');
    await evalOn(a,"document.getElementById('journey-daily-read').click();true");
    await until(async()=>evalOn(a,"document.getElementById('story-dialog').open"),
      'completed one-off dialogue reopened');
    assert.equal(await evalOn(a,
      "document.getElementById('complete-story').textContent.includes('已阅读')"),true);
    await evalOn(a,"document.getElementById('complete-story').click();true");
    assert.equal(await readRaw(a,STORY_SAVE_KEY),committed,
      'replaying a completed one-off cannot rewrite its save');
    assert.equal(await readRaw(a,normalKey),'normal-mode-sentinel');
    assert.equal(await readRaw(a,workshopKey),null,
      'the incident cannot initialize or change story workshop economy');
    // P156: exercise real Chromium DOM/localStorage with simulated BFCache
    // lifecycle events. These synthetic events are NOT a Safari BFCache test.
    await evalOn(a,"window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));true");
    assert.equal(await evalOn(a,"document.getElementById('story-dialog').open"),false);
    await evalOn(a,"window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));true");
    await until(async()=>evalOn(a,
      "document.getElementById('journey-daily-read')?.hidden===false&&"+
      "document.getElementById('journey-daily-read')?.disabled===false"),
    'unchanged suspended snapshot resumes without a write');
    assert.equal(await readRaw(a,STORY_SAVE_KEY),committed,
      'a clean simulated BFCache return must not increment story revision');

    // A same-document storage mutation emits no StorageEvent to itself.
    // Emulate a peer write missed during suspension, preserving revision but
    // changing valid choice bytes. The resumed page must fail closed.
    await evalOn(a,"document.getElementById('journey-daily-read').click();true");
    await until(async()=>evalOn(a,"document.getElementById('story-dialog').open"),
      'read-only dialogue reopened before suspension');
    await evalOn(a,"window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));true");
    const keyExpr=JSON.stringify(STORY_SAVE_KEY);
    const replacement=await evalOn(a,`(()=>{
      const save=JSON.parse(localStorage.getItem(${keyExpr}));
      save.packs.core.choices['old-crate']=
        save.packs.core.choices['old-crate']==='register'?'ask':'register';
      const raw=JSON.stringify(save);
      localStorage.setItem(${keyExpr},raw);
      return raw;
    })()`);
    assert.notEqual(replacement,committed);
    assert.equal(JSON.parse(replacement).revision,JSON.parse(committed).revision,
      'same-revision byte changes must not be treated as an identical pin');
    await evalOn(a,"window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));true");
    await until(async()=>evalOn(a,
      "document.getElementById('save-state').textContent.includes('其他标签页')"),
    'resume refuses a changed same-revision raw snapshot');
    assert.equal(await evalOn(a,"document.getElementById('story-dialog').open"),false);
    assert.equal(await evalOn(a,"document.getElementById('journey-daily-read').hidden"),true);
    await evalOn(a,"document.getElementById('complete-story').click();true");
    assert.equal(await readRaw(a,STORY_SAVE_KEY),replacement,
      'blocked resume must never overwrite the changed save');

    // Missing original bytes must also block a resumed tab, rather than
    // silently initializing a new story over a deleted save.
    await call('Page.reload',{ignoreCache:true},a.sessionId);
    await until(async()=>evalOn(a,
      "document.getElementById('journey-daily-read')?.hidden===false"),
    'valid replacement loads before deletion');
    await evalOn(a,"window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));true");
    await evalOn(a,'localStorage.removeItem('+keyExpr+');true');
    await evalOn(a,"window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));true");
    await until(async()=>evalOn(a,
      "document.getElementById('save-state').textContent.includes('其他标签页')"),
    'missing original snapshot blocks resume');
    assert.equal(await readRaw(a,STORY_SAVE_KEY),null,
      'a suspended page must not recreate a deleted story save');
    assert.equal(await readRaw(a,normalKey),'normal-mode-sentinel',
      'none of the lifecycle checks may touch normal-mode storage');
    assert.equal(await readRaw(a,workshopKey),null,
      'none of the lifecycle checks may initialize story economy');
    t.diagnostic('P156 Chromium: clean lifecycle, same-revision changed bytes, deleted snapshot all guarded');
  });
