import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const html=readFileSync(new URL('../flappy/index.html',import.meta.url),'utf8');
// Read the one known inline script from this checked-in static fixture.
// Explicit markers avoid treating a regular expression as an HTML parser/sanitizer.
function extractGameScript(documentSource){
  const opening='<script>';
  const closing='</script>';
  const start=documentSource.indexOf(opening);
  if(start<0)throw new Error('Flappy inline script opening tag missing');
  if(documentSource.indexOf(opening,start+opening.length)!==-1)throw new Error('Multiple inline scripts need explicit review');
  const bodyStart=start+opening.length;
  const end=documentSource.indexOf(closing,bodyStart);
  if(end<0)throw new Error('Flappy inline script closing tag missing');
  return documentSource.slice(bodyStart,end).trimStart();
}
const source=extractGameScript(html);
new vm.Script(source); // Syntax check independent of the DOM harness.
function setup({auth=true,fetchImpl=async()=>{throw new Error('offline');},storage=new Map([['zhaoFlappyBest.v1','12']]),render=false,imageLoading=false,imageDecoding=false,deviceMemory=8,saveData=false,reduceMotion=false,audioConstructor=null}={}){
  const elements=new Map(),events={},rafQueue=[];let authChange,createdCanvases=0,drawImages=0;const paintedColors=[],drawnSources=[],imageObjects=[];
  const gradient={addColorStop(){}};
  const fakeCtx=new Proxy({createLinearGradient(){return gradient;},createRadialGradient(){return gradient;},drawImage(im){drawImages++;if(im&&im.src)drawnSources.push(im.src);}},
    {get(target,key){return target[key]??(()=>{});},set(target,key,value){if(key==='fillStyle'&&typeof value==='string')paintedColors.push(value);target[key]=value;return true;}});
  function element(id){
    if(elements.has(id))return elements.get(id);
    const classes=new Set(),listeners={};
    const node={id,textContent:'',innerHTML:'',value:'',hidden:false,disabled:false,listeners,
      classList:{add(...xs){xs.forEach(x=>classes.add(x));},remove(...xs){xs.forEach(x=>classes.delete(x));},contains(x){return classes.has(x);},toggle(x,on){if(on??!classes.has(x))classes.add(x);else classes.delete(x);}},
      addEventListener(t,fn){listeners[t]=fn;},setAttribute(){},focus(){},querySelector(){return element(id+'button');},querySelectorAll(){return [];},getBoundingClientRect(){return {width:360,height:600};},getContext(){return render?fakeCtx:{};},closest(){return null;}};
    elements.set(id,node);return node;
  }
  const session={user:{id:'u1'},access_token:'fake'};
  const toolbox={url:'https://example.test',key:'public',peekSession:()=>session,getSession:async()=>session,onAuthStateChange:fn=>{authChange=fn;},signIn:async()=>{},authMessage:e=>e.message};
  const window={matchMedia:()=>({matches:reduceMotion}),addEventListener(){},ToolboxAuth:auth?toolbox:undefined,AudioContext:audioConstructor||undefined};
  const localStorage={getItem(key){return storage.has(key)?storage.get(key):null;},setItem(key,value){storage.set(key,String(value));}};
  const document={getElementById:element,addEventListener(t,fn){events[t]=fn;},body:{setAttribute(){}},
    createElement(tag){if(tag!=='canvas')throw new Error('Unexpected element');createdCanvases++;return {getContext(){return fakeCtx;}};}};
  function FakeImage(){
    this.onload=null;this.onerror=null;this.naturalWidth=1600;this.naturalHeight=1000;this.src='';
    if(imageDecoding)this.decode=()=>new Promise((resolve,reject)=>{this.resolveDecode=resolve;this.rejectDecode=reject;});
    imageObjects.push(this);
  }
  const context={window,document,navigator:{deviceMemory,connection:{saveData}},localStorage,performance:{now:()=>1000},
    requestAnimationFrame(fn){if(render)rafQueue.push(fn);},setTimeout,clearTimeout,AbortController,fetch:fetchImpl,Intl,console};
  if(imageLoading)context.Image=FakeImage;
  // Test-only closure access, not shipped in the game.
  const instrumented=source.replace('  loadBest();loadPendingBest();restorePendingRuns();resetGame(true);',`  window.testApi={startGame,finishGame,openLeaderboard,closeLeaderboard,sendRun,submitOnlineRun,refreshLeaderboard,retryPendingSubmission,get active(){return activeRun;},get state(){return state;},get best(){return best;},get pendingBest(){return pendingBest;},set score(value){score=value;},drawBirdForSkin(value){birdSkin=value;drawBird(1000);},birdRadiusForTest(){return birdRadius();},skinName(value){return BIRD_SKINS[value].name;},flapForTest(){flap();},get wingPhase(){return bird.wingPhase;},get wingActive(){return bird.wingActive;},get wingQueued(){return bird.wingQueued;},get wingTempo(){return bird.wingTempo;},get vy(){return bird.vy;},forceWarmSample(){birdSkin='warm';preloadCinematicWorld('warm');resetGame(false);},forceSlateSample(){birdSkin='slate';preloadCinematicWorld('slate');resetGame(false);},selectVisualWorldForTest(skin){releaseInactiveCinematicWorld(skin);birdSkin=skin;preloadCinematicWorld(skin);resetGame(false);},worldStatusForTest(skin){return cinematicWorlds[skin].status;},worldLayerCountForTest(skin){return Object.keys(cinematicWorlds[skin].layers).length;},get cinematicStatus(){return cinematicWorlds[birdSkin].status;},get cinematicSession(){return cinematicSession;},resetSample(){resetGame(false);},drawSample(){draw(1000);},sampleFrameForTest(seconds){observeSceneryFrame(seconds);},get sceneryQuality(){return sceneryQuality;},get birdHitRadius(){return birdRadius();}};\n  loadBest();loadPendingBest();restorePendingRuns();resetGame(true);`);
  vm.runInNewContext(instrumented,context);
  return {api:window.testApi,e:element,events,authChange,session,storage,
    tick(t){const callback=rafQueue.shift();if(!callback)throw new Error('Missing RAF callback');callback(t);},
    createdCanvases(){return createdCanvases;},drawImages(){return drawImages;},drawnSources(){return [...drawnSources]},clearDrawnSources(){drawnSources.length=0;},imageObjects(){return [...imageObjects]},
    resetPaint(){paintedColors.length=0;},paintedColors(){return [...paintedColors]}};
}
const flush=()=>new Promise(r=>setImmediate(r));
test('guest still plays when shared auth and network are unavailable; local BEST remains',async()=>{
  const s=setup({auth:false});s.api.startGame();assert.equal(s.api.state,'running');s.api.finishGame();await flush();assert.equal(s.api.state,'over');assert.equal(s.api.best,12);assert.equal(s.e('resultBest').textContent,'12');
});
test('leaderboard pauses; typing W/P/space does not control the game',async()=>{
  const s=setup();s.api.startGame();s.api.openLeaderboard();assert.equal(s.api.state,'paused');
  for(const key of ['w','P',' '])s.events.keydown({key,target:{closest(){return true;}},preventDefault(){throw new Error('typing intercepted');}});
  assert.equal(s.api.state,'paused');s.api.closeLeaderboard();await flush();
});
test('late prior-game response cannot overwrite new game result status',async()=>{
  let resolveSubmit,starts=0;
  const s=setup({fetchImpl:async(url,options)=>{
    const b=JSON.parse(options.body);
    if(b.action==='start_run')return new Response(JSON.stringify({run_token:String(++starts).repeat(43)}));
    if(b.action==='submit_run')return new Promise(resolve=>{resolveSubmit=resolve;});
    return new Response(JSON.stringify({all_time:[],weekly:[],viewer:null}));
  }});
  s.api.startGame();s.api.finishGame();await flush();assert.ok(resolveSubmit);
  s.api.startGame();s.e('onlineResultStatus').textContent='new game';
  resolveSubmit(new Response(JSON.stringify({leaderboard:{all_time:[],weekly:[],viewer:null}})));await flush();assert.equal(s.e('onlineResultStatus').textContent,'new game');
});
test('rejected submission has no retry; network retry is bounded',async()=>{
  for(const status of [422,503]){
    let submissions=0;
    const s=setup({fetchImpl:async(url,options)=>{
      const b=JSON.parse(options.body);
      if(b.action==='start_run')return new Response(JSON.stringify({run_token:'a'.repeat(43)}));
      if(b.action==='submit_run'){submissions++;return new Response(JSON.stringify({error:'rejected',code:'SCORE_TOO_FAST'}),{status});}
      return new Response(JSON.stringify({all_time:[],weekly:[],viewer:null}));
    }});
    s.api.startGame();s.api.finishGame();await flush();s.api.retryPendingSubmission();await flush();s.api.retryPendingSubmission();await flush();
    assert.equal(submissions,status===422?1:2);
  }
});
test('network failure persists the best pending run and reload retries it',async()=>{
  const storage=new Map([['zhaoFlappyBest.v1','3']]);
  const offline=setup({storage,fetchImpl:async(url,options)=>{
    const body=JSON.parse(options.body);
    if(body.action==='start_run')return new Response(JSON.stringify({run_token:'p'.repeat(43),expires_at:new Date(Date.now()+600000).toISOString()}));
    if(body.action==='submit_run')return new Response(JSON.stringify({error:'offline'}),{status:503});
    return new Response(JSON.stringify({all_time:[],weekly:[],viewer:null}));
  }});
  offline.api.startGame();await flush();offline.api.score=7;offline.api.finishGame();await flush();await flush();
  assert.equal(offline.api.pendingBest,7);
  assert.equal(JSON.parse(storage.get('zhaoFlappyPendingRuns.v1'))[0].payload.score,7);
  assert.match(offline.e('onlineResultStatus').textContent,/^离线保存/);

  let submitted=0;
  const online=setup({storage,fetchImpl:async(url,options)=>{
    const body=JSON.parse(options.body);
    const leaderboard={all_time:[],weekly:[],viewer:{member_id:'m1',all_time:{score:7,rank:1},weekly:{score:7,rank:1}}};
    if(body.action==='submit_run'){submitted++;return new Response(JSON.stringify({accepted:true,score:7,leaderboard}));}
    return new Response(JSON.stringify(leaderboard));
  }});
  await flush();await flush();await flush();
  assert.equal(submitted,1);
  assert.equal(online.api.pendingBest,0);
  assert.deepEqual(JSON.parse(storage.get('zhaoFlappyPendingRuns.v1')),[]);
});


test('fixture script extraction rejects missing or unexpected extra inline blocks',()=>{
  assert.equal(extractGameScript('<script>let value=1;</script>'),'let value=1;');
  assert.throws(()=>extractGameScript('<div>missing</div>'),/missing/);
  assert.throws(()=>extractGameScript('<script>unterminated'),/closing/);
  assert.throws(()=>extractGameScript('<script>a</script><script>b</script>'),/Multiple/);
});

test('cinematic Canvas rendering reuses sky/cloud buffers and keeps flight functional',async()=>{
  const scene=setup({render:true});
  scene.tick(1000); // resize + first draw
  assert.equal(scene.createdCanvases(),2,'one cloud sprite and one cached sky');
  const firstDrawImages=scene.drawImages();
  scene.tick(1016);
  scene.tick(1032);
  assert.equal(scene.createdCanvases(),2,'do not rebuild static scenery every frame');
  assert.ok(scene.drawImages()>firstDrawImages,'canvas layers are actually painted');
  scene.api.startGame();
  scene.tick(1048);
  assert.equal(scene.api.state,'running');
  scene.api.score=13;
  scene.tick(1064); // airflow is now part of the draw pipeline
  assert.equal(scene.createdCanvases(),3,'score band updates only the cached sky');
  scene.api.finishGame();
  await flush();
  assert.equal(scene.api.state,'over');
});

test('warm traveler and slate night bird render from one geometric rig',()=>{
  const scene=setup({render:true});
  scene.tick(1000);
  const radius=scene.api.birdRadiusForTest();
  scene.resetPaint();
  scene.api.drawBirdForSkin('warm');
  const warm=scene.paintedColors();
  scene.resetPaint();
  scene.api.drawBirdForSkin('slate');
  const slate=scene.paintedColors();
  assert.equal(scene.api.skinName('warm'),'暖棕旅鸟');
  assert.equal(scene.api.skinName('slate'),'板岩夜鸟');
  assert.ok(warm.includes('#efd5b3'),'warm traveler cheek must be rendered');
  assert.ok(warm.includes('#fff0d9'),'warm traveler ivory throat must be rendered');
  assert.ok(slate.includes('#d8e0e6'),'slate night bird cheek must be rendered');
  assert.ok(slate.includes('#f4f5f4'),'slate night bird throat must be rendered');
  assert.equal(warm.length,slate.length,'both skins use the same drawing geometry');
  assert.equal(scene.api.birdRadiusForTest(),radius,'a different skin cannot change collision radius');
  assert.match(html,/每局随机遇见暖棕旅鸟或板岩夜鸟/);
});

test('V3.1 repeated taps keep wing angle phase continuous while physical lift is immediate',()=>{
  const scene=setup({render:true});
  scene.tick(1000);
  scene.api.startGame();
  assert.equal(scene.api.wingActive,true,'the start action begins the first stroke');
  scene.tick(1016);
  scene.tick(1032);
  const phaseBefore=scene.api.wingPhase;
  const vyBefore=scene.api.vy;
  assert.ok(phaseBefore>0 && phaseBefore<1);
  scene.api.flapForTest();
  assert.equal(scene.api.wingPhase,phaseBefore,'rapid input may not snap the wing back to pose zero');
  assert.equal(scene.api.wingQueued,true,'one further stroke is scheduled');
  assert.ok(scene.api.vy<vyBefore,'the upward physics impulse is applied immediately');
  scene.tick(1048);
  assert.ok(scene.api.wingPhase>phaseBefore,'wing motion continues forward from its existing pose');
});

test('V3.1 queued strokes settle to neutral without a restart or permanent flapping',()=>{
  const scene=setup({render:true});
  scene.tick(1000);
  scene.api.startGame();
  scene.tick(1016);
  scene.api.flapForTest();
  let t=1016;
  for(let n=0;n<51;n++){t+=16;scene.tick(t);}
  assert.equal(scene.api.wingQueued,false);
  assert.equal(scene.api.wingActive,false,'one queued stroke must settle to neutral');
  assert.equal(scene.api.wingPhase,0,'neutral matches the first/last visual pose');
});

test('V4 warm assets activate atomically only after all five images finish loading',()=>{
  const scene=setup({render:true,imageLoading:true});
  scene.api.forceWarmSample();
  const images=scene.imageObjects().filter(im=>im.src.includes('/v4/warm/'));
  assert.equal(images.length,5);
  assert.equal(scene.api.cinematicStatus,'loading');
  assert.equal(scene.api.cinematicSession,null);
  for(let i=0;i<4;i++)images[i].onload();
  assert.equal(scene.api.cinematicStatus,'loading');
  assert.equal(scene.api.cinematicSession,null);
  images[4].onload();
  assert.equal(scene.api.cinematicStatus,'ready');
  assert.equal(scene.api.cinematicSession,'warm');
  scene.api.drawSample();
  const rendered=scene.drawnSources();
  for(const id of ['sky','far','mid','mist','near'])
    assert.ok(rendered.some(src=>src.endsWith('/v4/warm/'+id+'.svg')),'render missing '+id);
});

test('V4 an unavailable background layer rejects the entire sample and retains V3 drawing',()=>{
  const scene=setup({render:true,imageLoading:true});
  scene.api.forceWarmSample();
  const images=scene.imageObjects().filter(im=>im.src.includes('/v4/warm/'));
  images[0].onload();images[1].onerror(new Error('404'));
  for(let i=2;i<images.length;i++)images[i].onload();
  assert.equal(scene.api.cinematicStatus,'failed');
  assert.equal(scene.api.cinematicSession,null);
  scene.resetPaint();scene.api.drawSample();
  assert.ok(scene.paintedColors().some(c=>c==='#9aaab5'||c==='#667991'||c==='#426c65'),
    'V3 ridges must still render if a new layer fails');
});

test('V4 late loading during an ongoing game cannot switch the background mid-run',()=>{
  const scene=setup({render:true,imageLoading:true});
  scene.api.forceWarmSample();
  scene.api.startGame();
  const images=scene.imageObjects().filter(im=>im.src.includes('/v4/warm/'));
  images.forEach(im=>im.onload());
  assert.equal(scene.api.cinematicStatus,'ready');
  assert.equal(scene.api.cinematicSession,null,'ongoing run retains chosen background mode');
  scene.api.resetSample();
  assert.equal(scene.api.cinematicSession,'warm','next round may use the completed sample');
});

test('V4 slate world is independently loaded, rendered and available without warm assets',()=>{
  const scene=setup({render:true,imageLoading:true});
  scene.api.forceSlateSample();
  const images=scene.imageObjects().filter(im=>im.src.includes('/v4/slate/'));
  assert.equal(images.length,5);
  images.forEach(im=>im.onload());
  assert.equal(scene.api.cinematicStatus,'ready');
  assert.equal(scene.api.cinematicSession,'slate');
  scene.api.drawSample();
  for(const id of ['sky','far','mid','mist','near'])
    assert.ok(scene.drawnSources().some(src=>src.endsWith('/v4/slate/'+id+'.svg')),'missing slate '+id);
  assert.ok(!scene.drawnSources().some(src=>src.includes('/v4/warm/')),'must not draw warm world');
});

test('V4 late completion of previous world does not overwrite newly selected world',()=>{
  const scene=setup({render:true,imageLoading:true});
  scene.api.forceWarmSample();
  const warm=scene.imageObjects().filter(im=>im.src.includes('/v4/warm/'));
  scene.api.forceSlateSample();
  const slate=scene.imageObjects().filter(im=>im.src.includes('/v4/slate/'));
  assert.equal(warm.length,5);
  assert.equal(slate.length,5);
  warm.forEach(im=>im.onload());
  assert.equal(scene.api.cinematicSession,null,'warm late completion cannot hijack slate selection');
  slate.forEach(im=>im.onload());
  assert.equal(scene.api.cinematicSession,'slate');
});

test('V4 slate asset failure independently retains procedural twilight fallback',()=>{
  const scene=setup({render:true,imageLoading:true});
  scene.api.forceSlateSample();
  const slate=scene.imageObjects().filter(im=>im.src.includes('/v4/slate/'));
  slate[0].onload();slate[2].onerror(new Error('bad sprite'));
  assert.equal(scene.api.cinematicStatus,'failed');
  assert.equal(scene.api.cinematicSession,null);
  scene.api.drawSample();
  assert.ok(scene.paintedColors().includes('#667991'),'procedural slate ridges still render');
});

test('V4 reduced-motion, data saving and weak-memory hints use low-cost background without animated fog',()=>{
  for(const opts of [{deviceMemory:2},{saveData:true},{reduceMotion:true}]){
    const scene=setup({render:true,imageLoading:true,...opts});
    scene.api.forceWarmSample();
    scene.imageObjects().filter(im=>im.src.includes('/v4/warm/')).forEach(im=>im.onload());
    assert.equal(scene.api.sceneryQuality,'low');
    scene.clearDrawnSources();
    scene.api.drawSample();
    assert.ok(scene.drawnSources().some(src=>src.includes('/v4/warm/sky.svg')));
    assert.ok(scene.drawnSources().some(src=>src.includes('/v4/warm/near.svg')));
    assert.equal(scene.drawnSources().filter(src=>src.includes('/v4/warm/mist.svg')).length,0);
  }
});

test('V4 high/medium fog layers use bounded image draws and preserve gameplay collision geometry',()=>{
  for(const [memory,expected] of [[8,2],[4,1]]){
    const scene=setup({render:true,imageLoading:true,deviceMemory:memory});
    scene.api.forceSlateSample();
    scene.imageObjects().filter(im=>im.src.includes('/v4/slate/')).forEach(im=>im.onload());
    assert.equal(scene.api.sceneryQuality,memory===8?'high':'medium');
    const radius=scene.api.birdHitRadius;
    scene.clearDrawnSources();scene.api.drawSample();
    // Rendering in the fixture uses one 1600:1000 wide tile per effect on the standard portrait canvas.
    assert.equal(scene.drawnSources().filter(src=>src.includes('/v4/slate/mist.svg')).length,expected);
    assert.equal(scene.api.birdHitRadius,radius);
  }
});

test('V4 a sustained slow frame sample reduces only scenery quality; tapping still applies immediate lift',()=>{
  const scene=setup({render:true,imageLoading:true,deviceMemory:8});
  scene.api.forceWarmSample();
  scene.imageObjects().filter(im=>im.src.includes('/v4/warm/')).forEach(im=>im.onload());
  scene.api.startGame();
  assert.equal(scene.api.sceneryQuality,'high');
  const radius=scene.api.birdHitRadius,vy=scene.api.vy;
  for(let i=0;i<210;i++)scene.api.sampleFrameForTest(.028);
  assert.equal(scene.api.sceneryQuality,'low');
  assert.equal(scene.api.birdHitRadius,radius);
  scene.api.flapForTest();
  assert.ok(scene.api.vy<=vy,'input retains its immediate upward response');
  scene.clearDrawnSources();scene.api.drawSample();
  assert.equal(scene.drawnSources().filter(src=>src.includes('/v4/warm/mist.svg')).length,0);
});

test('V4 image onload cannot activate the world before all SVGs complete decoding',async()=>{
  const scene=setup({render:true,imageLoading:true,imageDecoding:true});
  scene.api.selectVisualWorldForTest('warm');
  const images=scene.imageObjects().filter(img=>img.src.includes('/v4/warm/'));
  assert.equal(images.length,5);
  images.forEach(img=>img.onload());
  assert.equal(scene.api.cinematicStatus,'loading');
  assert.equal(scene.api.cinematicSession,null);
  images.slice(0,4).forEach(img=>img.resolveDecode());
  await flush();
  assert.equal(scene.api.cinematicStatus,'loading','partial decoding must not activate the scene');
  images[4].resolveDecode();await flush();
  assert.equal(scene.api.cinematicStatus,'ready');
  assert.equal(scene.api.cinematicSession,'warm');
});

test('V4 decode rejection retains the procedural fallback and does not partially render',async()=>{
  const scene=setup({render:true,imageLoading:true,imageDecoding:true});
  scene.api.selectVisualWorldForTest('slate');
  const images=scene.imageObjects().filter(img=>img.src.includes('/v4/slate/'));
  assert.equal(images.length,5);
  images.forEach(img=>img.onload());
  images[0].resolveDecode();
  images[1].rejectDecode(new Error('SVG decode unavailable'));
  images.slice(2).forEach(img=>img.resolveDecode());
  await flush();
  assert.equal(scene.api.cinematicStatus,'failed');
  assert.equal(scene.api.cinematicSession,null);
  scene.clearDrawnSources();scene.api.drawSample();
  assert.equal(scene.drawnSources().some(src=>src.includes('/v4/slate/')),false);
});

test('V4 choosing another theme releases the old decoded world; stale decode cannot revive it',async()=>{
  const scene=setup({render:true,imageLoading:true,imageDecoding:true});
  scene.api.selectVisualWorldForTest('warm');
  const warm=scene.imageObjects().filter(img=>img.src.includes('/v4/warm/'));
  assert.equal(warm.length,5);
  warm.forEach(img=>img.onload());
  warm.forEach(img=>img.resolveDecode());await flush();
  assert.equal(scene.api.worldStatusForTest('warm'),'ready');
  assert.equal(scene.api.worldLayerCountForTest('warm'),5);
  scene.api.selectVisualWorldForTest('slate');
  assert.equal(scene.api.worldStatusForTest('warm'),'idle','inactive world must be evicted');
  assert.equal(scene.api.worldLayerCountForTest('warm'),0);
  assert.equal(scene.api.cinematicSession,null);
  assert.ok(warm.every(img=>img.onload===null&&img.onerror===null),'old image handlers detached');
  // The fixture intentionally retains historical fake images; only the latest five belong to the active world.
  const slate=scene.imageObjects().filter(img=>img.src.includes('/v4/slate/')).slice(-5);
  assert.equal(scene.api.worldLayerCountForTest('slate'),5);
  assert.equal(slate.length,5);
  slate.forEach(img=>img.onload());
  slate.forEach(img=>img.resolveDecode());await flush();
  assert.equal(scene.api.cinematicSession,'slate');
  scene.api.selectVisualWorldForTest('warm');
  assert.equal(scene.api.worldLayerCountForTest('slate'),0);
  const reloaded=scene.imageObjects().filter(img=>img.src.includes('/v4/warm/'));
  assert.equal(reloaded.length,10,'returning to previously evicted theme reloads its 5 layers');
});

test('First pointer tap applies vertical lift before synchronous AudioContext construction',()=>{
  let scene,created=0,velocityAtAudioCreation=null,tones=0;
  const parameter=()=>({setValueAtTime(){},exponentialRampToValueAtTime(){},linearRampToValueAtTime(){}});
  function AudioContextStub(){
    created++;velocityAtAudioCreation=scene.api.vy;
    this.state='running';this.currentTime=1;this.sampleRate=44100;
    this.destination={};
    this.createOscillator=()=>{tones++;return {frequency:parameter(),connect(){},start(){},stop(){}};};
    this.createGain=()=>({gain:parameter(),connect(){}});
    this.createBuffer=()=>({getChannelData:()=>new Float32Array(8)});
    this.createBufferSource=()=>({connect(){},start(){},stop(){}});
    this.createBiquadFilter=()=>({frequency:{value:0},connect(){}});
  }
  scene=setup({audioConstructor:AudioContextStub});
  scene.e('stage').listeners.pointerdown({target:{closest:()=>null},preventDefault(){}});
  assert.equal(scene.api.state,'running');
  assert.ok(scene.api.vy<0,'first tap must apply impulse');
  assert.ok(velocityAtAudioCreation<0,'slow audio construction must follow the impulse');
  assert.equal(created,1,'a single audio context must be reused by tone and airy');
  assert.ok(tones>=1,'first flap still schedules sound in the same user gesture');
});

test('AudioContext permission/constructor failures cannot block the first flight',()=>{
  let attempts=0,scene;
  function BlockedAudioContext(){
    attempts++;
    assert.ok(scene.api.vy<0,'bird impulse precedes rejected audio initialization');
    throw new Error('Audio output unavailable');
  }
  scene=setup({audioConstructor:BlockedAudioContext});
  scene.e('stage').listeners.pointerdown({target:{closest:()=>null},preventDefault(){}});
  assert.equal(scene.api.state,'running');
  assert.ok(scene.api.vy<0);
  assert.equal(attempts,1);
  scene.api.flapForTest();
  assert.equal(attempts,1,'repeated flaps must not retry a throwing constructor');
  scene.e('soundBtn').listeners.click({stopPropagation(){}});
  scene.e('soundBtn').listeners.click({stopPropagation(){}});
  assert.equal(attempts,2,'explicit sound re-enable may retry audio initialization');
  assert.equal(scene.api.state,'running','failed sound retries must not crash game');
});
