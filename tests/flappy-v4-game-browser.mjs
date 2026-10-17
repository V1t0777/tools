#!/usr/bin/env node
// DRAFT-ONLY: real Flappy Canvas snapshots and browser timing using only localhost.
// The visual fixture is generated in RAM, never committed as a game page or deployed.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,createReadStream,existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve,join,extname,sep} from 'node:path';

const root=resolve(process.cwd());
const output=resolve(process.argv[2]||'v4-game-qa');
mkdirSync(output,{recursive:true});
const original=readFileSync(join(root,'flappy/index.html'),'utf8');
function once(s,before,after){
  assert.ok(s.includes(before),'Game QA hook not found: '+before.slice(0,80));
  return s.replace(before,after);
}
function visualFixture(){
  let s=original;
  s=once(s,'<script src="../shared/toolbox-auth.js?v=20261008-security"></script>','');
  s=once(s,"var nextSkin=Math.random()<.5?'warm':'slate';","var nextSkin=window.__v4GameQa.skin;");
  const frameHook=[
    '  function frame(t){',
    '    var qa=window.__v4GameQa;',
    '    if(qa){',
    '      qa.frames++;',
    '      if(qa.previousStamp>0){var interval=t-qa.previousStamp;',
    '        if(interval>0&&interval<1000)qa.frameIntervals.push(Math.round(interval*100)/100);}',
    '      qa.previousStamp=t;',
    "      if(qa.mode==='stabilized'&&!qa.started&&cinematicWorlds[birdSkin].status==='ready'){",
    "        resetGame(false);state='running';readyLayer.classList.add('hidden');",
    '        qa.started=true;qa.startedAt=t;qa.readyMs=performance.now()-qa.createdAt;',
    '      }',
    "      if(qa.mode==='stabilized'&&qa.started){bird.y=H*.45;bird.vy=0;",
    '        scroll=qa.scrollOffset+(t-qa.startedAt)*.21;',
    '        qa.drawState=state;qa.world=cinematicSession;',
    '        qa.observedScroll=scroll;qa.pipeCount=pipes.length;',
    '      }',
    "      if(qa.mode==='live'){",
    "        qa.state=state;qa.world=cinematicSession;qa.pipeCount=pipes.length;",
    "        qa.birdY=bird.y;qa.birdVy=bird.vy;qa.observedScroll=scroll;",
    "        qa.birdX=bird.x;qa.groundY=groundY;qa.birdWingPhase=bird.wingPhase;",
    "        qa.pipeData=pipes.map(function(p){return {x:p.x,gapY:p.gapY,gap:p.gap};});",
    "        if(state==='running'&&bird.wingActive){",
    "          if(qa.previousWingPhase>=0&&bird.wingPhase<qa.previousWingPhase-.4&&qa.previousWingPhase<.7)",
    "            qa.unexpectedWingResets++;",
    "          qa.previousWingPhase=bird.wingPhase;",
    "        }else qa.previousWingPhase=-1;",
    "        if(state==='running'){qa.runningFrames++;",
    "          qa.yMin=Math.min(qa.yMin,bird.y);qa.yMax=Math.max(qa.yMax,bird.y);",
    "          if(qa.previousState!=='running')qa.startCount++;",
    "        }",
    "        if(state==='falling')qa.collisionSeen=true;",
    "        if(state==='over')qa.gameOverSeen=true;",
    "        qa.previousState=state;",
    "      }",
    '    }'
  ].join('\n');
  s=once(s,'  function frame(t){',frameHook);
  s=once(s,'  function collides(){',
    '  function collides(){if(window.__v4GameQa?.mode===\'stabilized\')return false; // QA-only collision suppression');
  const head=[
    '<style id="v4-game-qa-only">',
    'html,body{margin:0!important;padding:0!important;overflow:hidden!important;min-height:0!important}',
    '.app{display:block!important;margin:0!important;padding:0!important;max-width:none!important}',
    '.stage-wrap{position:fixed!important;inset:0!important;margin:0!important;padding:0!important;',
    'width:100vw!important;height:100vh!important;display:block!important;z-index:99999!important}',
    '#stage{position:absolute!important;inset:0!important;margin:0!important;padding:0!important;',
    'border:0!important;border-radius:0!important;width:100%!important;height:100%!important;',
    'max-width:none!important;max-height:none!important;aspect-ratio:auto!important;box-shadow:none!important}',
    '#stage::after{display:none!important}',
    '#canvas{width:100%!important;height:100%!important;display:block!important;border-radius:0!important}',
    '#readyLayer,#pauseLayer,#resultLayer,#score,#newBest,#pauseBtn{display:none!important}',
    '</style>',
    '<script>',
    'const qaArgs=new URLSearchParams(location.search);',
    'window.__v4GameQa={skin:qaArgs.get("skin")==="slate"?"slate":"warm",',
    'mode:qaArgs.get("mode")==="live"?"live":"stabilized",pointerdowns:0,',
    'state:"ready",previousState:"ready",startCount:0,runningFrames:0,',
    'previousWingPhase:-1,unexpectedWingResets:0,pipeData:[],',
    'yMin:99999,yMax:-99999,collisionSeen:false,gameOverSeen:false,',
    'frames:0,frameIntervals:[],previousStamp:0,started:false,',
    'createdAt:performance.now(),readyMs:null,scrollOffset:0,',
    'drawState:"not-started",pipeCount:0,world:null};',
    'window.addEventListener("pointerdown",()=>window.__v4GameQa.pointerdowns++);',
    '</script>',
    '</head>'
  ].join('\n');
  return once(s,'</head>',head);
}
const qaHtml=visualFixture();
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
const server=createServer((req,res)=>{
  let url;try{url=new URL(req.url,'http://localhost');}catch{res.writeHead(400).end();return;}
  if(url.pathname==='/flappy/qa-game.html'){
    res.writeHead(200,{'Content-Type':mime['.html'],'Cache-Control':'no-store'}).end(qaHtml);return;
  }
  const file=resolve(root,'.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(root+sep)||!existsSync(file)){res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
  createReadStream(file).pipe(res);
});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
const port=server.address().port;
const profile=mkdtempSync(join(tmpdir(),'flappy-v4-cdp-'));
const browser=spawn(process.env.CHROME||'chromium',[
  '--headless=new','--no-sandbox','--disable-dev-shm-usage',
  '--disable-background-networking','--no-first-run',
  '--remote-debugging-port=0','--remote-allow-origins=*',
  '--user-data-dir='+profile,'about:blank'
],{stdio:['ignore','ignore','pipe']});
let stderr='';
browser.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-20000);});
let ws=null,id=0;
const requests=new Map();
function cdp(method,params={}){
  assert.ok(ws&&ws.readyState===WebSocket.OPEN,'Chrome CDP disconnected');
  const number=++id;
  return new Promise((ok,fail)=>{
    const timeout=setTimeout(()=>{requests.delete(number);fail(new Error('CDP timeout: '+method));},12000);
    requests.set(number,{ok,fail,timeout});
    ws.send(JSON.stringify({id:number,method,params}));
  });
}
async function read(expression){
  const response=await cdp('Runtime.evaluate',{expression,returnByValue:true});
  if(response.result.exceptionDetails)throw new Error('Browser JS exception');
  return response.result.result.value;
}
async function until(expr,timeout=18000){
  const end=Date.now()+timeout;
  while(Date.now()<end){
    try{if(await read(expr))return;}catch{}
    await sleep(160);
  }
  throw new Error('Timed out waiting for actual V4 game assets: '+expr);
}
const metricExpression=[
  'JSON.stringify((()=>{',
  'const q=window.__v4GameQa;if(!q)return null;',
  'const list=q.frameIntervals.filter(n=>n>0).slice(-240).sort((a,b)=>a-b);',
  'const assetEntries=performance.getEntriesByType("resource").filter(x=>x.name.includes("/assets/v4/"));',
  'const assets=assetEntries.map(x=>({file:x.name.split("/").slice(-2).join("/"),',
  'durationMs:Math.round(x.duration*100)/100,transferBytes:x.transferSize||0}));',
  'const rect=document.getElementById("canvas").getBoundingClientRect();',
  'return {skin:q.skin,mode:q.mode,scene:q.world,started:q.started,state:q.mode==="live"?q.state:q.drawState,',
  'pointerdowns:q.pointerdowns,startCount:q.startCount,collisionSeen:q.collisionSeen,',
  'gameOverSeen:q.gameOverSeen,runningFrames:q.runningFrames,',
  'unexpectedWingResets:q.unexpectedWingResets,birdY:q.birdY,birdVy:q.birdVy,',
  'birdX:q.birdX,groundY:q.groundY,pipeData:q.pipeData,',
  'birdYSpan:q.yMin===99999?null:Math.round((q.yMax-q.yMin)*10)/10,',
  'frames:q.frames,pipeCount:q.pipeCount,scroll:Math.round(q.observedScroll||0),',
  'imageDecodeReadyMs:q.readyMs===null?null:Math.round(q.readyMs),',
  'canvasCssSize:{width:Math.round(rect.width),height:Math.round(rect.height)},',
  'frameIntervalsMs:{samples:list.length,median:list[Math.floor((list.length-1)*.5)]||null,',
  'p95:list[Math.floor((list.length-1)*.95)]||null,max:list[list.length-1]||null},',
  'loadedLayers:assets.length,assets};',
  '})())'
].join('');
const evidence={kind:'Draft-only real Flappy browser renderer evidence',
  disclaimer:'Headless Chromium frame intervals are NOT iPhone/Android FPS or input latency measurements.',
  createdAt:new Date().toISOString(),samples:[]};
try{
  let debuggerPort;
  for(let n=0;n<100;n++){
    const file=join(profile,'DevToolsActivePort');
    if(existsSync(file)){debuggerPort=Number(readFileSync(file,'utf8').split('\n')[0]);break;}
    if(browser.exitCode!==null)throw new Error('Chrome failed: '+stderr.slice(-900));
    await sleep(100);
  }
  if(!debuggerPort)throw new Error('Chrome did not expose debugger: '+stderr.slice(-900));
  const pages=await(await fetch('http://127.0.0.1:'+debuggerPort+'/json/list')).json();
  const tab=pages.find(p=>p.type==='page');
  assert.ok(tab,'No browser target');
  ws=new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((ok,fail)=>{ws.onopen=ok;ws.onerror=()=>fail(new Error('Cannot connect to Chrome debugger'));});
  ws.onmessage=msg=>{
    let packet;try{packet=JSON.parse(msg.data);}catch{return;}
    if(!packet.id)return;
    const wait=requests.get(packet.id);if(!wait)return;
    requests.delete(packet.id);clearTimeout(wait.timeout);
    if(packet.error)wait.fail(new Error(packet.error.message));else wait.ok(packet);
  };
  await cdp('Page.enable');await cdp('Runtime.enable');
  for(const skin of ['warm','slate']){
    for(const [width,height] of [[390,844],[360,600]]){
      await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
      await cdp('Page.navigate',{url:'http://127.0.0.1:'+port+'/flappy/qa-game.html?skin='+skin});
      await until('Boolean(window.__v4GameQa&&window.__v4GameQa.started&&window.__v4GameQa.world===window.__v4GameQa.skin&&window.__v4GameQa.frames>45)');
      for(const offset of [0,960]){
        await read('window.__v4GameQa.scrollOffset='+offset);
        await sleep(420);
        const record=JSON.parse(await read(metricExpression));
        assert.equal(record.scene,skin,'Must show real V4 layers, not fallback');
        assert.ok(record.loadedLayers>=5,'All five art layers must load');
        assert.ok(record.pipeCount>=1,'Actual obstacle pipes must exist');
        assert.ok(record.canvasCssSize.width>=width-5,'Game Canvas did not fill viewport');
        assert.ok(record.frameIntervalsMs.samples>=20,'No usable frames recorded');
        const screenshot=await cdp('Page.captureScreenshot',
          {format:'png',captureBeyondViewport:false,fromSurface:true});
        const png=Buffer.from(screenshot.result.data,'base64');
        assert.ok(png.length>14000,'Real-game PNG suspiciously small');
        assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
        const filename='game-'+skin+'-'+width+'x'+height+'-scroll'+offset+'.png';
        writeFileSync(join(output,filename),png);
        evidence.samples.push({...record,offset,filename,pngBytes:png.length});
        console.log('Actual Canvas screenshot',filename,'frameP95Ms',record.frameIntervalsMs.p95,
          'decodedReadyMs',record.imageDecodeReadyMs);
      }
    }
  }
  assert.equal(evidence.samples.length,8);
  // A second, independent pass uses the unmodified physics, hit detection,
  // state transitions, and actual browser pointer events. No auto-flapping,
  // no camera freeze, no collision suppression and no gameplay internals called.
  const interactive={kind:'Actual pointer input + normal physics/collisions',
    disclaimer:'Emulated mobile viewport in desktop Chromium, NOT an iPhone or Android hardware test.',
    results:[]};
  for(const skin of ['warm','slate']){
    const width=360,height=600;
    await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
    await cdp('Page.navigate',{url:'http://127.0.0.1:'+port+'/flappy/qa-game.html?skin='+skin+'&mode=live'});
    await until('Boolean(window.__v4GameQa&&window.__v4GameQa.mode==="live"&&window.__v4GameQa.state==="ready"&&window.__v4GameQa.world===window.__v4GameQa.skin&&window.__v4GameQa.frames>20)');
    const tap=async()=>{
      const p={x:width*.28,y:height*.45,button:'left',clickCount:1};
      await cdp('Input.dispatchMouseEvent',{...p,type:'mousePressed'});
      await cdp('Input.dispatchMouseEvent',{...p,type:'mouseReleased'});
    };
    await tap();  // First real pointerdown -> startGame() + flap()
    await until('window.__v4GameQa.state==="running"&&window.__v4GameQa.pointerdowns>=1');
    await sleep(260);
    const inFlight=JSON.parse(await read(metricExpression));
    assert.equal(inFlight.mode,'live');
    assert.equal(inFlight.state,'running');
    assert.equal(inFlight.scene,skin);
    assert.ok(inFlight.pipeCount>=1,'Normal mode has real obstacles');
    assert.ok(inFlight.birdYSpan>5,'Bird motion must be driven by game physics');
    assert.ok(inFlight.scroll>0,'Gameplay parallax must actually move');
    const shot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
    const image=Buffer.from(shot.result.data,'base64');
    assert.equal(image.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    const screenshot='live-'+skin+'-normal-flight.png';
    writeFileSync(join(output,screenshot),image);
    await until('window.__v4GameQa.state==="over"&&window.__v4GameQa.collisionSeen&&window.__v4GameQa.gameOverSeen',7500);
    const afterDeath=JSON.parse(await read(metricExpression));
    assert.equal(afterDeath.scene,skin,'Background must stay unchanged through collision');
    assert.equal(afterDeath.state,'over');
    assert.ok(afterDeath.birdYSpan>25,'Real collision test must show trajectory variation');
    assert.ok(afterDeath.pointerdowns>=1);
    await tap(); // Second real pointerdown -> reset/another genuine game
    await until('window.__v4GameQa.state==="running"&&window.__v4GameQa.startCount>=2&&window.__v4GameQa.pointerdowns>=2');
    const afterRestart=JSON.parse(await read(metricExpression));
    assert.equal(afterRestart.scene,skin);
    interactive.results.push({skin,inFlight,afterDeath,afterRestart,flightScreenshot:screenshot});
    console.log('NORMAL GAMEPLAY',skin,'taps='+afterRestart.pointerdowns,
      'collision='+afterDeath.collisionSeen,'restarts='+afterRestart.startCount,
      'birdMotion='+afterDeath.birdYSpan);
  }
  assert.equal(interactive.results.length,2);
  // Closed-loop long run. The QA controller only READS bird/pipe state,
  // and acts through genuine CDP pointerdowns. It must never set bird physics,
  // disable collisions, change scrolling or skip the game state machine.
  const endurance={kind:'Continuous normal-physics input pacing',
    disclaimer:'Headless desktop Chromium with mobile viewport; this is NOT iPhone/Android latency, performance or manual gameplay.',
    results:[]};
  for(const skin of ['warm','slate']){
    const width=360,height=600;
    await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
    await cdp('Page.navigate',{url:'http://127.0.0.1:'+port+'/flappy/qa-game.html?skin='+skin+'&mode=live'});
    await until('Boolean(window.__v4GameQa&&window.__v4GameQa.mode==="live"&&window.__v4GameQa.state==="ready"&&window.__v4GameQa.world===window.__v4GameQa.skin&&window.__v4GameQa.frames>20)');
    const tap=async()=>{
      const pointer={x:width*.28,y:height*.45,button:'left',clickCount:1};
      await cdp('Input.dispatchMouseEvent',{...pointer,type:'mousePressed'});
      await cdp('Input.dispatchMouseEvent',{...pointer,type:'mouseReleased'});
    };
    await tap();
    await until('window.__v4GameQa.state==="running"&&window.__v4GameQa.pointerdowns>=1');
    let lastTap=Date.now(),turns=0,observed=[],final;
    const deadline=Date.now()+6200;
    while(Date.now()<deadline){
      const snap=JSON.parse(await read(metricExpression));
      observed.push({timeMs:Date.now(),state:snap.state,y:snap.birdY,
        vy:snap.birdVy,scroll:snap.scroll,wingResets:snap.unexpectedWingResets});
      if(snap.state!=='running'){final=snap;break;}
      const approaching=(snap.pipeData||[]).filter(p=>p.x+p.gap*.0>=snap.birdX-20)
        .sort((a,b)=>a.x-b.x)[0];
      const target=Math.min(height*.58,Math.max(height*.33,approaching?approaching.gapY+5:height*.45));
      if(snap.birdY>target+8&&snap.birdVy>0&&Date.now()-lastTap>280){
        await tap();lastTap=Date.now();turns++;
      }
      await sleep(75);
    }
    if(!final)final=JSON.parse(await read(metricExpression));
    const record={skin,realPointerFlaps:turns+1,durationMs:observed.length?
      observed.at(-1).timeMs-observed[0].timeMs:0,
      startScroll:observed[0]?.scroll,endScroll:final.scroll,
      state:final.state,unexpectedWingResets:final.unexpectedWingResets,
      intervalP95Ms:final.frameIntervalsMs.p95,
      samples:observed.length,birdYSpan:final.birdYSpan,
      collisionSeen:final.collisionSeen,scoreInferred:undefined};
    endurance.results.push(record);
    console.log('ENDURANCE',skin,'durationMs',record.durationMs,
      'clicks',record.realPointerFlaps,'scroll',record.endScroll,
      'state',record.state,'wingResets',record.unexpectedWingResets);
    assert.ok(record.durationMs>2500,'Too-short continuous flight in '+skin);
    assert.ok(record.realPointerFlaps>=4,'Need repeated real taps, '+skin);
    assert.equal(record.unexpectedWingResets,0,'Wing animation jumped backward mid-stroke');
    assert.ok(record.endScroll-record.startScroll>220,'Backdrop did not move during repeated gameplay');
    assert.equal(final.scene,skin,'Cinematic theme changed unexpectedly during continuous play');
  }
  writeFileSync(join(output,'headless-endurance-metrics.json'),JSON.stringify(endurance,null,2)+'\n');

  writeFileSync(join(output,'headless-live-input-metrics.json'),JSON.stringify(interactive,null,2)+'\n');

  writeFileSync(join(output,'headless-game-metrics.json'),JSON.stringify(evidence,null,2)+'\n');
  console.log('Completed eight actual-game captures; metrics are CI-headless only, not a mobile-device benchmark.');
}finally{
  if(ws)ws.close();
  browser.kill('SIGTERM');
  server.close();
  await sleep(200);
  rmSync(profile,{recursive:true,force:true,maxRetries:3});
}
