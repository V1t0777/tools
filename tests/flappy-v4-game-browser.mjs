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
  // Compare new idle priming against the exact same game with QA-only flag disabled.
  s=once(s,'var AUDIO_IDLE_PRIME=true;','var AUDIO_IDLE_PRIME=window.__v4GameQa.prewarm;');
  s=once(s,'    function primeOnIdle(deadline){',
    '    function primeOnIdle(deadline){'+
    'var qa=window.__v4GameQa;if(qa){qa.primeCallbackRan=true;qa.idleBudgetMs=deadline&&typeof deadline.timeRemaining==="function"?Math.round(deadline.timeRemaining()):null;}');
  s=once(s,'      try{audioCtx=new AC();}\n      catch(error){\n        // Idle-time creation',
    '      try{var qaStartedAt=performance.now();audioCtx=new AC();'+
    'var qa=window.__v4GameQa;if(qa){qa.primeSuccess=true;qa.primedAudioMs=Math.round((performance.now()-qaStartedAt)*100)/100;}}'+
    '\n      catch(error){\n        // Idle-time creation');
  // Time synchronous audio startup independently of first-game Canvas paint.
  // This is injected into the localhost QA response only, never shipped.
  s=once(s,'  function initAudio(){','  function originalInitAudio(){');
  s=once(s,'  function tone(',
    '  function initAudio(){var at=performance.now();'+
    'var result=originalInitAudio();var q=window.__v4GameQa;'+
    'if(q&&result)q.audioTimes.push(Math.round((performance.now()-at)*100)/100);'+
    'return result;}  function tone(');
  const frameHook=[
    '  function frame(t){',
    '    var qa=window.__v4GameQa;',
    '    if(qa){',
    '      qa.frames++;',
    '      var wall=performance.now();',
    '      if(qa.previousWall>0){var wallGap=wall-qa.previousWall;',
    '        if(wallGap>0&&wallGap<1000)qa.wallFrameIntervals.push(Math.round(wallGap*100)/100);}',
    '      qa.previousWall=wall;',
    '      if(qa.previousStamp>0){var interval=t-qa.previousStamp;',
    '        if(interval>0&&interval<1000)qa.frameIntervals.push(Math.round(interval*100)/100);}',
    '      qa.previousStamp=t;',
    "      if(qa.mode==='stabilized'&&!qa.started&&cinematicWorlds[birdSkin].status==='ready'){",
    "        resetGame(false);state='running';readyLayer.classList.add('hidden');",
    '        qa.started=true;qa.startedAt=t;qa.readyMs=performance.now()-qa.createdAt;',
    '      }',
    "      if(qa.mode==='stabilized'&&qa.started){bird.y=H*.45;bird.vy=0;",
    '        scroll=qa.scrollOffset+(qa.seamTarget?0:(t-qa.startedAt)*.21);',
    '        qa.drawState=state;qa.world=cinematicSession;',
    '        qa.observedScroll=scroll;qa.pipeCount=pipes.length;',
    '        qa.birdX=bird.x;qa.birdY=bird.y;',
    '        qa.atlasReady=!!(flightAtlases[birdSkin]&&flightAtlases[birdSkin].ready);',
    '        qa.birdRadius=birdRadius();',
    '        qa.pipeData=pipes.map(p=>({x:p.x,gapY:p.gapY,gap:p.gap}));',
    '      }',
    "      if(qa.mode==='live'){",
    "        qa.state=state;qa.world=cinematicSession;qa.pipeCount=pipes.length;",
    "        qa.birdY=bird.y;qa.birdVy=bird.vy;qa.observedScroll=scroll;",
    "        qa.birdX=bird.x;qa.groundY=groundY;qa.birdWingPhase=bird.wingPhase;",
    "        qa.score=score;qa.quality=sceneryQuality;",
    "        qa.worldStatus=cinematicWorlds[birdSkin].status;",
    "        qa.activeWorldLayers=Object.keys(cinematicWorlds[birdSkin].layers).length;",
    "        if(qa.lastWorld!==null&&qa.lastWorld!==cinematicSession)qa.worldTransitions++;",
    "        qa.lastWorld=cinematicSession;",
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
  // The physics timestamp belongs AFTER bird.vy is updated, not at flap() entry.
  s=once(s,'    bird.vy=Math.min(bird.vy,0)*.12-flapPower;',
    '    bird.vy=Math.min(bird.vy,0)*.12-flapPower;'+
    'if(window.__v4GameQa?.mode==="live"&&state==="running"){'+
    'var q=window.__v4GameQa;var at=performance.now();'+
    'q.pendingFlap={fromPointer:Math.max(0,at-(q.latestPointerAt??at)),at};}');
  // Snapshot when the original game draw() returned. This is an in-browser
  // timing proxy, not measured screen photon latency or device touch lag.
  s=once(s,'    update(dt,t);draw(t);raf=requestAnimationFrame(frame);',
    '    update(dt,t);draw(t);'+
    'if(window.__v4GameQa?.mode==="live"&&window.__v4GameQa.pendingFlap){'+
    'var qa=window.__v4GameQa,impulse=qa.pendingFlap;'+
    'var end=performance.now();qa.latencySamples.push({'+
    'pointerToPhysicsMs:Math.round(impulse.fromPointer*100)/100,'+
    'physicsToDrawMs:Math.round(Math.max(0,end-impulse.at)*100)/100,'+
    'pointerToDrawMs:Math.round((Math.max(0,end-impulse.at)+impulse.fromPointer)*100)/100});'+
    'qa.pendingFlap=null;}raf=requestAnimationFrame(frame);');
  s=once(s,'  function collides(){',
    '  function collides(){if(window.__v4GameQa?.mode===\'stabilized\')return false; // QA-only collision suppression');
  s=once(s,"    for(var x=-dx;x<W;x+=tileWidth)ctx.drawImage(image,x,0,tileWidth+overlap,H);","    for(var x=-dx;x<W;x+=tileWidth)ctx.drawImage(image,x,0,tileWidth+overlap,H);\n    // Draft QA only: sample the *actual* composited game Canvas immediately\n    // after this repeatable parallax layer, before bird, pipes and ground.\n    var seamQa=window.__v4GameQa;\n    if(seamQa&&seamQa.seamTarget===layer.id){\n      var joinPx=Math.round((tileWidth-dx)*dpr);\n      var row0=Math.floor(H*.60*dpr),row1=Math.floor(H*.85*dpr);\n      if(joinPx>11&&joinPx<ctx.canvas.width-11&&row1>row0){\n        var strip=ctx.getImageData(joinPx-9,row0,19,row1-row0);\n        var seamSum=0,controlSum=0,channelCount=0;\n        for(var row=0;row<strip.height;row+=3){\n          var line=row*19*4;\n          for(var channel=0;channel<3;channel++){\n            seamSum+=Math.abs(strip.data[line+8*4+channel]-strip.data[line+9*4+channel]);\n            controlSum+=(\n              Math.abs(strip.data[line+2*4+channel]-strip.data[line+3*4+channel])+\n              Math.abs(strip.data[line+15*4+channel]-strip.data[line+16*4+channel]))*.5;\n            channelCount++;\n          }\n        }\n        seamQa.seamResult={layer:layer.id,\n          seamX:Math.round(joinPx/dpr*10)/10,\n          seamMeanRgbDelta:Math.round(seamSum/channelCount*100)/100,\n          adjacentControlRgbDelta:Math.round(controlSum/channelCount*100)/100,\n          sampleChannels:channelCount,\n          sampledBeforeGameplayOverlays:true};\n      }\n    }");
  // Inject only into the localhost, in-memory QA game copy, never shipped.
  s=once(s,"    drawPipes();\n    drawGround();\n    drawAirflow();\n    drawBird(now);","    // Alpha 20: QA-only one-shot *matched-position* backdrop/bird readback.\n    // Single source-game frame; no synthetic background, CSS halos or game physics changes.\n    var contrastQa=window.__v4GameQa,contrastBefore=null,contrastRgb=null;\n    if(contrastQa&&contrastQa.mode==='stabilized'&&contrastQa.contrastProbe){\n      contrastQa.contrastProbe=false;\n      var r=birdRadius(),aX=bird.x,aY=bird.y;\n      contrastRgb=function(x,y){\n        var px=Math.round(x*dpr),py=Math.round(y*dpr);\n        if(px<1||py<1||px>=ctx.canvas.width-1||py>=ctx.canvas.height-1)return null;\n        var rgba=ctx.getImageData(px,py,1,1).data;\n        return [rgba[0],rgba[1],rgba[2]];\n      };\n      contrastBefore={radius:r,\n        backgroundCenter:contrastRgb(aX,aY),\n        backgroundBreast:contrastRgb(aX+r*.37,aY+r*.28)};\n    }\n    drawPipes();\n    drawGround();\n    drawAirflow();\n    drawBird(now);\n    if(contrastBefore){\n      var center=contrastRgb(bird.x,bird.y),\n        breast=contrastRgb(bird.x+contrastBefore.radius*.37,bird.y+contrastBefore.radius*.28);\n      function rgbDelta(a,b){\n        return a&&b?Math.round((Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])+Math.abs(a[2]-b[2]))/3*100)/100:null;\n      }\n      contrastQa.compositeReadability={\n        method:'one-shot matched-position composite before obstacles vs after full bird drawing',\n        birdAtlasReady:!!(flightAtlases[birdSkin]&&flightAtlases[birdSkin].ready),\n        centerRgb:center,underBirdCenterRgb:contrastBefore.backgroundCenter,\n        breastRgb:breast,underBreastRgb:contrastBefore.backgroundBreast,\n        centerRgbDelta:rgbDelta(center,contrastBefore.backgroundCenter),\n        breastRgbDelta:rgbDelta(breast,contrastBefore.backgroundBreast),\n        nominalBirdDiameterCssPx:Math.round(2*contrastBefore.radius*10)/10,\n        caveat:'not luminance/WCAG; collision-free stabilized QA, desktop Chromium'};\n    }");
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
    // QA-only sound preference, before the original game script reads localStorage.
    'try{localStorage.setItem("zhaoFlappySound.v1",qaArgs.get("sound")==="off"?"off":"on");}catch(e){}',
    'window.__v4GameQa={skin:qaArgs.get("skin")==="slate"?"slate":"warm",',
    'sound:qaArgs.get("sound")==="off"?"off":"on",',
    'prewarm:qaArgs.get("prime")!=="control",primeSuccess:false,primedAudioMs:null,',
    'primeCallbackRan:false,idleBudgetMs:null,',
    'mode:qaArgs.get("mode")==="live"?"live":"stabilized",pointerdowns:0,',
    'state:"ready",previousState:"ready",startCount:0,runningFrames:0,',
    'previousWingPhase:-1,unexpectedWingResets:0,pipeData:[],',
    'lastWorld:null,worldTransitions:0,activeWorldLayers:0,',
    'latestPointerAt:null,pendingFlap:null,latencySamples:[],audioTimes:[],',
    'yMin:99999,yMax:-99999,collisionSeen:false,gameOverSeen:false,',
    'frames:0,frameIntervals:[],previousStamp:0,started:false,',
    'wallFrameIntervals:[],previousWall:0,',
    'createdAt:performance.now(),readyMs:null,scrollOffset:0,',
    'drawState:"not-started",pipeCount:0,world:null,',
    'contrastProbe:false,compositeReadability:null,atlasReady:false};',
    'window.addEventListener("pointerdown",()=>{',
    'const q=window.__v4GameQa;q.pointerdowns++;q.latestPointerAt=performance.now();',
    '},true);',
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
let profile=mkdtempSync(join(tmpdir(),'flappy-v4-cdp-'));
let stderr='';
function launchChrome(){
  const child=spawn(process.env.CHROME||'chromium',[
    '--headless=new','--no-sandbox','--disable-dev-shm-usage',
    '--disable-background-networking','--no-first-run',
    '--remote-debugging-port=0','--remote-allow-origins=*',
    '--user-data-dir='+profile,'about:blank'
  ],{stdio:['ignore','ignore','pipe']});
  child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-20000);});
  return child;
}
let browser=launchChrome();
let ws=null,id=0;
const requests=new Map();
const browserExceptions=[];
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
  if(response.result.exceptionDetails){
    const detail=response.result.exceptionDetails;
    throw new Error('Browser JS exception: '+String(detail.exception?.description||detail.text).slice(0,500));
  }
  return response.result.result.value;
}
async function until(expr,timeout=18000){
  const end=Date.now()+timeout;
  while(Date.now()<end){
    try{if(await read(expr))return;}catch{}
    await sleep(160);
  }
  let diagnostics;
  try{
    diagnostics=await read('JSON.stringify({title:document.title,qa:window.__v4GameQa||null,canvas:!!document.querySelector("#canvas"),ready:document.readyState})');
  }catch(e){diagnostics=String(e);}
  throw new Error('Timed out waiting for actual V4 game assets: '+expr+
    ' | browser state: '+String(diagnostics).slice(0,900)+
    ' | JS exceptions: '+browserExceptions.slice(-3).join(' | '));
}
const metricExpression=[
  'JSON.stringify((()=>{',
  'const q=window.__v4GameQa;if(!q)return null;',
  'const list=q.frameIntervals.filter(n=>n>0).slice(-240).sort((a,b)=>a-b);',
  'const lag=q.latencySamples.slice(-120);',
  'const p2d=lag.map(x=>x.pointerToDrawMs).sort((a,b)=>a-b);',
  'const p2p=lag.map(x=>x.pointerToPhysicsMs).sort((a,b)=>a-b);',
  'const audio=q.audioTimes;',
  'const assetEntries=performance.getEntriesByType("resource").filter(x=>x.name.includes("/assets/v4/"));',
  'const assets=assetEntries.map(x=>({file:x.name.split("/").slice(-2).join("/"),',
  'durationMs:Math.round(x.duration*100)/100,transferBytes:x.transferSize||0}));',
  'const rect=document.getElementById("canvas").getBoundingClientRect();',
  'const cv=document.getElementById("canvas"),readable=cv.getContext("2d");',
  'const scaleX=cv.width/Math.max(1,rect.width),scaleY=cv.height/Math.max(1,rect.height);',
  'function colorAt(x,y){if(!Number.isFinite(x)||!Number.isFinite(y))return null;',
  'const px=Math.round(x*scaleX),py=Math.round(y*scaleY);',
  'if(px<1||py<1||px>=cv.width-1||py>=cv.height-1)return null;',
  'return [...readable.getImageData(px,py,1,1).data].slice(0,3);}',
  'function difference(a,b){return a&&b?Math.round(a.reduce((n,v,i)=>n+Math.abs(v-b[i]),0)/3*100)/100:null;}',
  'const birdFront=colorAt(q.birdX,q.birdY),birdNearby=colorAt(q.birdX-55,q.birdY);',
  'const shownPipe=(q.pipeData||[]).find(p=>p.x>=15&&p.x+57<rect.width-10&&p.gapY-p.gap/2>45);',
  'const pipeTop=shownPipe?shownPipe.gapY-shownPipe.gap/2:null;',
  'const pipeRow=shownPipe?Math.min(75,pipeTop-16):null;',
  'const pipeFront=shownPipe?colorAt(shownPipe.x+12,pipeRow):null,pipeNearby=shownPipe?colorAt(shownPipe.x-9,pipeRow):null;',
  'const visualSeparation={kind:"QA-only sampled RGB pixel difference, not perceptual contrast or WCAG",',
  'birdCenterVsNearby:difference(birdFront,birdNearby),birdCenterRgb:birdFront,',
  'pipeInnerVsNearby:difference(pipeFront,pipeNearby),pipeInnerRgb:pipeFront};',
  'return {skin:q.skin,mode:q.mode,scene:q.world,started:q.started,state:q.mode==="live"?q.state:q.drawState,',
  'pointerdowns:q.pointerdowns,startCount:q.startCount,collisionSeen:q.collisionSeen,',
  'gameOverSeen:q.gameOverSeen,runningFrames:q.runningFrames,',
  'unexpectedWingResets:q.unexpectedWingResets,birdY:q.birdY,birdVy:q.birdVy,',
  'birdX:q.birdX,groundY:q.groundY,pipeData:q.pipeData,',
  'score:q.score,quality:q.quality,worldStatus:q.worldStatus,',
  'worldTransitions:q.worldTransitions,activeWorldLayers:q.activeWorldLayers,',
  'birdYSpan:q.yMin===99999?null:Math.round((q.yMax-q.yMin)*10)/10,',
  'frames:q.frames,pipeCount:q.pipeCount,scroll:Math.round(q.observedScroll||0),',
  'imageDecodeReadyMs:q.readyMs===null?null:Math.round(q.readyMs),',
  'canvasCssSize:{width:Math.round(rect.width),height:Math.round(rect.height)},',
  'frameIntervalsMs:{samples:list.length,median:list[Math.floor((list.length-1)*.5)]||null,',
  'p95:list[Math.floor((list.length-1)*.95)]||null,max:list[list.length-1]||null},',
  'loadedLayers:assets.length,',
  'inputResponse:{samples:lag.length,',
  'pointerToPhysicsP95Ms:p2p[Math.floor(Math.max(0,p2p.length-1)*.95)]||null,',
  'pointerToDrawP50Ms:p2d[Math.floor(Math.max(0,p2d.length-1)*.5)]||null,',
  'pointerToDrawP95Ms:p2d[Math.floor(Math.max(0,p2d.length-1)*.95)]||null,',
  'worstMs:p2d[p2d.length-1]||null},',
  'audioInitialization:{calls:audio.length,firstMs:audio[0]??null,',
  'maxSynchronousMs:audio.length?Math.max(...audio):null},visualSeparation,',
  'compositeReadability:q.compositeReadability,atlasReady:q.atlasReady,assets};',
  '})())'
].join('');
// Every V4_COLD_CASE invocation creates a unique Chrome process and profile.
const coldCase=process.env.V4_COLD_CASE||'';
const coldCaseParts=/^(warm|slate):(on|off):([12]):(prime|control)$/.exec(coldCase);
if(coldCase&&!coldCaseParts)throw new Error('Invalid V4_COLD_CASE; expected theme:sound:repetition:prime|control');
const evidence={kind:'Draft-only real Flappy browser renderer evidence',
  disclaimer:'Headless Chromium frame intervals are NOT iPhone/Android FPS or input latency measurements.',
  createdAt:new Date().toISOString(),samples:[]};
try{
  let debuggerPort;
  // Hosted CI Chrome occasionally hangs before exposing a debugger port.
  // A single bounded retry gets a NEW browser process AND temporary profile.
  // No gameplay or audio assertion is retried after page navigation begins.
  for(let attempt=0;attempt<2&&!debuggerPort;attempt++){
    if(attempt){
      const closed=new Promise(resolve=>browser.once('close',resolve));
      if(browser.exitCode===null&&browser.signalCode===null)browser.kill('SIGTERM');
      await Promise.race([closed,sleep(1300)]);
      if(browser.exitCode===null&&browser.signalCode===null)browser.kill('SIGKILL');
      try{rmSync(profile,{recursive:true,force:true,maxRetries:4,retryDelay:100});}
      catch(error){console.warn('Stale Chrome profile after failed startup:',String(error));}
      profile=mkdtempSync(join(tmpdir(),'flappy-v4-cdp-'));
      stderr='';
      browser=launchChrome();
      console.warn('Retrying Chrome debugger startup once in a clean profile');
    }
    for(let n=0;n<110;n++){
      const file=join(profile,'DevToolsActivePort');
      if(existsSync(file)){
        debuggerPort=Number(readFileSync(file,'utf8').split('\n')[0]);
        if(debuggerPort>0)break;
      }
      if(browser.exitCode!==null||browser.signalCode!==null)break;
      await sleep(100);
    }
  }
  if(!debuggerPort)throw new Error('Chrome did not expose debugger after bounded startup retry: '+stderr.slice(-900));
  const pages=await(await fetch('http://127.0.0.1:'+debuggerPort+'/json/list')).json();
  const tab=pages.find(p=>p.type==='page');
  assert.ok(tab,'No browser target');
  ws=new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((ok,fail)=>{ws.onopen=ok;ws.onerror=()=>fail(new Error('Cannot connect to Chrome debugger'));});
  ws.onmessage=msg=>{
    let packet;try{packet=JSON.parse(msg.data);}catch{return;}
    if(packet.method==='Runtime.exceptionThrown'){
      browserExceptions.push(String(packet.params?.exceptionDetails?.text||'Script error')+
        ': '+String(packet.params?.exceptionDetails?.exception?.description||'').slice(0,300));
      if(browserExceptions.length>12)browserExceptions.shift();
    }
    if(!packet.id)return;
    const wait=requests.get(packet.id);if(!wait)return;
    requests.delete(packet.id);clearTimeout(wait.timeout);
    if(packet.error)wait.fail(new Error(packet.error.message));else wait.ok(packet);
  };
  await cdp('Page.enable');await cdp('Runtime.enable');
  if(coldCaseParts){
    // First page navigation in a completely fresh Chrome process/profile.
    // No earlier renderer screenshots or A/B cases run in this process.
    const [,skin,sound,repetition,variant]=coldCaseParts;
    const width=360,height=600;
    await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
    const navStart=Date.now();
    await cdp('Page.navigate',{url:'http://127.0.0.1:'+port+
      '/flappy/qa-game.html?skin='+skin+'&mode=live&sound='+sound+'&prime='+variant});
    await until('Boolean(window.__v4GameQa&&window.__v4GameQa.mode==="live"&&window.__v4GameQa.state==="ready"&&window.__v4GameQa.world===window.__v4GameQa.skin&&window.__v4GameQa.frames>20)');
    const readyElapsedMs=Date.now()-navStart;
    // Give rIC a chance to allocate audio, but keep control cases otherwise identical.
    await sleep(900);
    // Snapshot pre-interaction frames independently: shifting a long task into
    // the ready screen must be visible in the evidence, not reported as free.
    const preTapFrames=JSON.parse(await read(
      'JSON.stringify((()=>{const q=window.__v4GameQa;'+
      'const a=q.frameIntervals.slice(20).filter(v=>v>0);'+
      'const wall=q.wallFrameIntervals.slice(20).filter(v=>v>0);'+
      'const ordered=a.slice().sort((a,b)=>a-b);const w=wall.slice().sort((a,b)=>a-b);return {'+
      'samples:a.length,maxMs:a.length?Math.max(...a):null,'+
      'p95Ms:ordered[Math.floor(Math.max(0,ordered.length-1)*.95)]??null,'+
      'slow24ms:a.filter(v=>v>24).length,slow40ms:a.filter(v=>v>40).length,'+
      'wallSamples:wall.length,wallMaxMs:wall.length?Math.max(...wall):null,'+
      'wallP95Ms:w[Math.floor(Math.max(0,w.length-1)*.95)]??null,'+
      'wallSlow24ms:wall.filter(v=>v>24).length,wallSlow40ms:wall.filter(v=>v>40).length};})())'));
    assert.ok(preTapFrames.samples>=15,'Cannot assess pre-tap frame stability');
    const press={x:width*.28,y:height*.45,button:'left',clickCount:1};
    await cdp('Input.dispatchMouseEvent',{...press,type:'mousePressed'});
    await cdp('Input.dispatchMouseEvent',{...press,type:'mouseReleased'});
    await until('Boolean(window.__v4GameQa&&window.__v4GameQa.latencySamples.length>=1)');
    const qa=JSON.parse(await read('JSON.stringify((()=>{const q=window.__v4GameQa;return {'+
      'theme:q.skin,sound:q.sound,prewarm:q.prewarm,'+
      'primeSuccess:q.primeSuccess,primedAudioMs:q.primedAudioMs,'+
      'primeCallbackRan:q.primeCallbackRan,idleBudgetMs:q.idleBudgetMs,'+
      'ua:navigator.userAgent.slice(0,180),'+
      'chromiumBrands:navigator.userAgentData?.brands?.map(x=>x.brand)??null,'+
      'idleAPI:typeof window.requestIdleCallback==="function",'+
      'mode:q.mode,clicks:q.pointerdowns,starts:q.startCount,'+
      'firstInput:q.latencySamples[0],audioCalls:q.audioTimes.length,'+
      'firstAudioInitMs:q.audioTimes.length?q.audioTimes[0]:null,'+
      'background:q.world,loadedLayers:q.activeWorldLayers,'+
      'sceneStatus:q.worldStatus,frameCount:q.frames};})())'));
    assert.equal(qa.theme,skin);
    assert.equal(qa.sound,sound);
    assert.equal(qa.prewarm,variant==='prime');
    if(variant==='control')assert.equal(qa.primeSuccess,false);
    if(sound==='off')assert.equal(qa.primeSuccess,false,'Muted cannot prewarm');
    assert.equal(qa.mode,'live');
    assert.equal(qa.clicks,1);
    assert.ok(qa.starts>=1,'Actual game input did not start the bird');
    assert.equal(qa.background,skin);
    assert.equal(qa.sceneStatus,'ready');
    assert.equal(qa.loadedLayers,5);
    assert.ok(qa.firstInput?.pointerToPhysicsMs>=0);
    assert.ok(qa.firstInput.pointerToDrawMs>=qa.firstInput.pointerToPhysicsMs);
    if(sound==='on')assert.ok(qa.audioCalls>=1,'Audio-on case never initialized audio');
    else assert.equal(qa.audioCalls,0,'Audio-off case unexpectedly initialized audio');
    const screenshot=await cdp('Page.captureScreenshot',
      {format:'png',captureBeyondViewport:false,fromSurface:true});
    const png=Buffer.from(screenshot.result.data,'base64');
    assert.ok(png.length>12000&&png.subarray(0,8).toString('hex')==='89504e470d0a1a0a');
    writeFileSync(join(output,'first-tap-'+skin+'-'+sound+'-rep'+repetition+'-'+variant+'.png'),png);
    const result={kind:'Fresh Chrome process/profile first-click on/off comparison',
      disclaimer:'Runner OS/audio backend remains shared across separate processes; no iOS/Android touch-to-photon proof.',
      theme:skin,sound,variant,repetition:Number(repetition),readyElapsedMs,preTapFrames,
      browserProfile:'unique temporary profile',processId:browser.pid,
      screenshotBytes:png.length,...qa};
    writeFileSync(join(output,'cold-firsttap.json'),JSON.stringify(result,null,2)+'\n');
    console.log('COLD PROCESS',skin,sound,repetition,variant,'primed='+qa.primeSuccess,
      'idleRan='+qa.primeCallbackRan,'idleBudget='+qa.idleBudgetMs,
      'physicsMs='+qa.firstInput.pointerToPhysicsMs,
      'drawMs='+qa.firstInput.pointerToDrawMs,'audioMs='+qa.firstAudioInitMs,
      'preTapMaxMs='+preTapFrames.maxMs,'preTapSlowFrames='+preTapFrames.slow24ms,
      'wallMaxMs='+preTapFrames.wallMaxMs,'wallSlowFrames='+preTapFrames.wallSlow40ms,
      'readyMs='+readyElapsedMs);
  }else{
  const seamAudit={kind:'True game-canvas parallax join sampling before pipe/bird overlays',
    disclaimer:'QA-only stabilized scroll and Chromium pixel deltas; not a physical-device seam, FPS or gameplay benchmark.',
    results:[]};
  for(const skin of ['warm','slate']){
    for(const [width,height] of [[390,844],[360,600],[320,568]]){
      await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
      await cdp('Page.navigate',{url:'http://127.0.0.1:'+port+'/flappy/qa-game.html?skin='+skin});
      await until('Boolean(window.__v4GameQa&&window.__v4GameQa.started&&window.__v4GameQa.world===window.__v4GameQa.skin&&window.__v4GameQa.frames>45&&window.__v4GameQa.atlasReady)');
      for(const offset of [0,960]){
        await read('window.__v4GameQa.scrollOffset='+offset+
          ';window.__v4GameQa.contrastProbe=true;window.__v4GameQa.compositeReadability=null');
        await sleep(420);
        const record=JSON.parse(await read(metricExpression));
        assert.equal(record.scene,skin,'Must show real V4 layers, not fallback');
        assert.ok(record.loadedLayers>=5,'All five art layers must load');
        assert.ok(record.pipeCount>=1,'Actual obstacle pipes must exist');
        assert.ok(record.canvasCssSize.width>=width-5,'Game Canvas did not fill viewport');
        assert.ok(record.frameIntervalsMs.samples>=20,'No usable frames recorded');
        assert.equal(record.atlasReady,true,'24-frame bird atlas has not decoded');
        assert.ok(record.compositeReadability?.birdAtlasReady,'Missing matched-position bird probe');
        assert.ok(record.compositeReadability.nominalBirdDiameterCssPx>=26);
        for(const name of ['centerRgbDelta','breastRgbDelta']){
          assert.ok(Number.isFinite(record.compositeReadability[name])&&
            record.compositeReadability[name]>=0&&record.compositeReadability[name]<=255,
            'Invalid pixel readback '+skin+'/'+width+' '+name);
        }
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

      // Force the genuine renderer's far/mid/near tile joins into the flight
      // viewport: 0/960 scroll positions never reach the 1600-source tile edge.
      // In this TEST-ONLY stabilized capture, freeze automatic drift during each
      // seam probe; otherwise elapsed time moves near's join off-screen.
      // Real game parallax, gameplay physics and production code are unchanged.
      for(const [layer,speed] of [['far',.045],['mid',.12],['near',.28]]){
        const tileWidth=height*1.6,expectedX=width*.52;
        const targetScroll=(tileWidth-expectedX)/speed;
        await read('window.__v4GameQa.seamTarget='+JSON.stringify(layer)+
          ';window.__v4GameQa.seamResult=null;'+
          'window.__v4GameQa.scrollOffset='+targetScroll);
        await sleep(300);
        const sample=JSON.parse(await read('JSON.stringify(window.__v4GameQa.seamResult)'));
        assert.ok(sample&&sample.layer===layer,'Missing sampled game-canvas tile join: '+skin+'/'+layer);
        assert.ok(Math.abs(sample.seamX-expectedX)<3,'Seam probe failed to hold expected target (x='+sample.seamX+', desired='+expectedX+')');
        assert.ok(sample.sampleChannels>100&&sample.sampledBeforeGameplayOverlays);
        assert.ok(Number.isFinite(sample.seamMeanRgbDelta)&&Number.isFinite(sample.adjacentControlRgbDelta));
        // Loose regression guard for prominent gaps; subtle boundaries require
        // perceptual review of screenshots and must not be auto-approved.
        assert.ok(sample.seamMeanRgbDelta<12,
          'Visible-width discontinuity in actual game layer '+skin+'/'+layer+': '+sample.seamMeanRgbDelta);
        // Alpha 21 retained only the proven periodic crest fix.
        // Deliberately reject future near-edge art that reproduces the earlier
        // 320px warm seam (>3.42) even when the general <12 guard passes.
        // This is an environment-specific regression threshold, not an aesthetic grade.
        if(skin==='warm'&&width===320&&height===568&&layer==='near'){
          assert.ok(sample.seamMeanRgbDelta<=3.25,
            'Alpha 21 narrow warm-near seam regression: '+sample.seamMeanRgbDelta+
            ' exceeds source baseline 3.42 minus 0.17 safety margin');
        }
        const screenshot=await cdp('Page.captureScreenshot',
          {format:'png',captureBeyondViewport:false,fromSurface:true});
        const png=Buffer.from(screenshot.result.data,'base64');
        assert.ok(png.length>12000&&png.subarray(0,8).toString('hex')==='89504e470d0a1a0a');
        const filename='seam-game-'+skin+'-'+layer+'-'+width+'x'+height+'.png';
        writeFileSync(join(output,filename),png);
        seamAudit.results.push({theme:skin,layer,viewport:width+'x'+height,
          targetScroll:Math.round(targetScroll),...sample,filename,pngBytes:png.length});
        console.log('Real game layer seam',filename,'seamDelta',sample.seamMeanRgbDelta,
          'adjacentControl',sample.adjacentControlRgbDelta);
        await read('window.__v4GameQa.seamTarget=null');
      }
    }
  }
  assert.equal(evidence.samples.length,12);
  assert.equal(seamAudit.results.length,18);
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
  // 30+ seconds of NORMAL physics across multiple play/death/restart cycles.
  // Different natural/random pipe placements are observed, not injected; no
  // collision overrides, bird writes, score writes or scroll writes here.
  const multiRound={kind:'Multi-round Chrome input/obstacle/scene retention stress',
    disclaimer:'Two real 16s windows on headless desktop Chrome. NOT a single 30s surviving flight, nor a physical phone benchmark.',
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
    const began=Date.now(),untilTime=began+16000;
    let roundStartedAt=0,lastTap=0,starts=0,taps=0,collisions=0,lastState='ready';
    let cumulativeScroll=0,priorScroll=0,highestScroll=0,lowestLayers=Infinity;
    let maxWingResets=0,maxTransitions=0,samples=0,maxFrameGap=0,maxScore=0;
    const heights=new Set(),rounds=[];
    while(Date.now()<untilTime){
      const q=JSON.parse(await read(metricExpression));
      assert.equal(q.scene,skin,'V4 world changed/disappeared during stress run');
      assert.equal(q.worldStatus,'ready','Scene texture unexpectedly unavailable');
      lowestLayers=Math.min(lowestLayers,q.activeWorldLayers);
      maxWingResets=Math.max(maxWingResets,q.unexpectedWingResets);
      maxTransitions=Math.max(maxTransitions,q.worldTransitions);
      maxFrameGap=Math.max(maxFrameGap,q.frameIntervalsMs.max||0);
      maxScore=Math.max(maxScore,q.score||0);
      for(const p of q.pipeData||[])heights.add(Math.round(p.gapY/12)*12);
      if(q.state==='running'){
        const move=Math.max(0,q.scroll-priorScroll);
        if(lastState==='running')cumulativeScroll+=move;
        highestScroll=Math.max(highestScroll,q.scroll);
        const activeTime=Date.now()-roundStartedAt;
        // The first round actively attempts actual obstacle traversal.
        // Subsequent rounds emphasize real deaths/restarts for lifecycle QA.
        // No pipe teleporting, no forced score, no collision/physics bypass.
        const longest=starts===1?5700:1550;
        const nextPipe=(q.pipeData||[]).filter(p=>p.x+56>=q.birdX-20)
          .sort((a,b)=>a.x-b.x)[0];
        const target=Math.min(height*.59,Math.max(height*.32,
          nextPipe?nextPipe.gapY+5:height*.44));
        if(activeTime<longest&&q.birdY>target+8&&q.birdVy>0&&Date.now()-lastTap>250){
          await tap();taps++;lastTap=Date.now();
        }
      }else if(q.state==='ready'||q.state==='over'){
        if(lastState==='falling'||lastState==='over')collisions+=q.state==='over'&&lastState!=='over'?1:0;
        await tap();taps++;lastTap=Date.now();
        starts++;roundStartedAt=Date.now();priorScroll=0;
        rounds.push({index:starts,startedAtMs:roundStartedAt-began,sourceState:q.state});
      }
      if(q.state==='running')priorScroll=q.scroll;
      lastState=q.state;
      samples++;
      await sleep(90);
    }
    const last=JSON.parse(await read(metricExpression));
    const record={skin,durationMs:Date.now()-began,observations:samples,
      startedRounds:starts,physicalPointerInputs:taps,normalCollisions:collisions,
      observedObstacleHeightBands:heights.size,maxScore,
      cumulativeScroll:Math.round(cumulativeScroll),highestScroll:Math.round(highestScroll),
      activeWorldMinimumLayers:lowestLayers,sceneSwitches:maxTransitions,
      unexpectedWingResets:maxWingResets,maxObservedFrameIntervalMs:maxFrameGap,
      frameIntervalP95Ms:last.frameIntervalsMs.p95,
      inputResponse:last.inputResponse,audioInitialization:last.audioInitialization,
      endedState:last.state,
      rounds};
    multiRound.results.push(record);
    console.log('MULTIROUND',skin,'seconds',Math.round(record.durationMs/1000),
      'starts',starts,'inputs',taps,'gapBands',heights.size,'scroll',record.cumulativeScroll,
      'maxFrame',maxFrameGap);
    assert.ok(record.durationMs>=15500,'Multi-round browser ran less than 15.5s');
    assert.ok(starts>=3,'Expected at least 3 natural rounds in '+skin);
    assert.ok(taps>=5,'Insufficient genuine input events in '+skin);
    assert.ok(last.inputResponse.samples>=3,'Need a measurable click-to-draw sample');
    assert.ok(last.inputResponse.worstMs>=0&&last.inputResponse.worstMs<1500,
      'Invalid browser click-to-Canvas timing');
    assert.ok(record.cumulativeScroll>100,'Real multi-round gameplay did not scroll');
    assert.ok(record.observedObstacleHeightBands>=2,'Pipe gaps were not varied');
    assert.equal(record.activeWorldMinimumLayers,5,'Background textures evicted during gameplay');
    assert.equal(record.sceneSwitches,0,'Cinematic world replaced unexpectedly');
    assert.equal(record.unexpectedWingResets,0,'Unexpected jump in wing animation');
  }
  assert.ok(multiRound.results.reduce((sum,r)=>sum+r.durationMs,0)>=31000,
    'Need at least 31 aggregate seconds with unmodified physics');
  writeFileSync(join(output,'headless-multiround-metrics.json'),JSON.stringify(multiRound,null,2)+'\n');
  // Repeated first-gesture A/B diagnostics using unchanged production audio.
  // Browser process is reused: this is not an independent mobile cold boot.
  const audioAb={kind:'Counterbalanced first-tap sound-on vs sound-off Chrome diagnostic',
    disclaimer:'Eight navigations within one headless Chromium process. Cached system/browser audio state shared. Not iPhone/Android input/first-sound proof.',
    scenarios:[]};
  const order=[['warm','off'],['warm','on'],['slate','on'],['slate','off'],
    ['slate','off'],['slate','on'],['warm','on'],['warm','off']];
  const abExpression='JSON.stringify((()=>{'+
    'const q=window.__v4GameQa;'+
    'return {skin:q.skin,sound:q.sound,started:q.startCount>=1,'+
      'world:q.world,clicked:q.pointerdowns,actualInput:q.latencySamples[0],'+
      'firstAudioCallMs:q.audioTimes.length?q.audioTimes[0]:null,'+
      'totalAudioCalls:q.audioTimes.length,'+
      'frameCount:q.frames,worldTransitions:q.worldTransitions};'+
    '})())';
  for(let iteration=0;iteration<order.length;iteration++){
    const [skin,sound]=order[iteration];
    const width=360,height=600;
    await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
    await cdp('Page.navigate',{url:'http://127.0.0.1:'+port+
      '/flappy/qa-game.html?skin='+skin+'&mode=live&sound='+sound});
    await until('Boolean(window.__v4GameQa&&window.__v4GameQa.mode==="live"&&window.__v4GameQa.state==="ready"&&window.__v4GameQa.world===window.__v4GameQa.skin&&window.__v4GameQa.frames>20)');
    const press={x:width*.28,y:height*.45,button:'left',clickCount:1};
    await cdp('Input.dispatchMouseEvent',{...press,type:'mousePressed'});
    await cdp('Input.dispatchMouseEvent',{...press,type:'mouseReleased'});
    await until('Boolean(window.__v4GameQa&&window.__v4GameQa.latencySamples.length>=1)');
    const raw=JSON.parse(await read(abExpression));
    assert.equal(raw.skin,skin);
    assert.equal(raw.sound,sound);
    assert.equal(raw.world,skin,'A/B variants must use the real V4 cinematic assets');
    assert.ok(raw.started&&raw.clicked===1,'A/B must start from one real pointer event');
    assert.ok(raw.actualInput?.pointerToPhysicsMs>=0);
    assert.ok(raw.actualInput?.pointerToDrawMs>=raw.actualInput?.pointerToPhysicsMs);
    if(sound==='off'){
      assert.equal(raw.totalAudioCalls,0,'Sound off must not create or use an audio context');
    }else{
      assert.ok(raw.totalAudioCalls>=1,'Sound on first gesture must attempt audio');
    }
    audioAb.scenarios.push({iteration,...raw});
    console.log('AUDIO A/B',iteration,skin,sound,
      'physics='+raw.actualInput.pointerToPhysicsMs,
      'canvas='+raw.actualInput.pointerToDrawMs,
      'audioInit='+raw.firstAudioCallMs);
  }
  assert.equal(audioAb.scenarios.length,8);
  writeFileSync(join(output,'headless-audio-ab-metrics.json'),JSON.stringify(audioAb,null,2)+'\n');



  writeFileSync(join(output,'headless-seam-metrics.json'),JSON.stringify(seamAudit,null,2)+'\n');
  const narrowReadability={
    kind:'Alpha 20 actual source-game 320px and larger viewport atlas/backdrop sampling',
    disclaimer:'Rendered desktop Chromium mobile emulation, one-shot RGB only; NOT WCAG, visible edge detection, Android/iOS hardware proof, or human art approval.',
    captures:evidence.samples.map(sample=>({
      theme:sample.skin,viewport:sample.canvasCssSize.width+'x'+sample.canvasCssSize.height,
      scrollOffset:sample.offset,filename:sample.filename,
      originalAtlasDecoded:sample.atlasReady, ...sample.compositeReadability}))
  };
  assert.equal(narrowReadability.captures.length,12);
  assert.equal(narrowReadability.captures.filter(x=>x.viewport==='320x568').length,4);
  writeFileSync(join(output,'headless-narrow-readability.json'),JSON.stringify(narrowReadability,null,2)+'\n');

  writeFileSync(join(output,'headless-live-input-metrics.json'),JSON.stringify(interactive,null,2)+'\n');

  writeFileSync(join(output,'headless-game-metrics.json'),JSON.stringify(evidence,null,2)+'\n');
  console.log('Completed twelve actual-game captures including 320px; metrics are desktop Chromium QA only.');
  }
}finally{
  if(ws)ws.close();
  // Wait for Chrome to release its asynchronously written profile files.
  // A fixed 200ms delay races with Chrome shutdown in independent-process QA.
  if(browser.exitCode===null&&browser.signalCode===null){
    const closed=new Promise(resolve=>browser.once('close',resolve));
    browser.kill('SIGTERM');
    await Promise.race([closed,sleep(2500)]);
    if(browser.exitCode===null&&browser.signalCode===null){
      browser.kill('SIGKILL');
      await Promise.race([closed,sleep(1200)]);
    }
  }
  server.close();
  try{
    rmSync(profile,{recursive:true,force:true,maxRetries:12,retryDelay:250});
  }catch(error){
    // Test evidence is already complete; a runner-isolated temp cleanup race
    // should be visible but not be mistaken for gameplay failure.
    console.warn('Chrome temporary profile cleanup:',String(error));
  }
}
