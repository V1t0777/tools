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
function setup({auth=true,fetchImpl=async()=>{throw new Error('offline');},storage=new Map([['zhaoFlappyBest.v1','12']]),render=false}={}){
  const elements=new Map(),events={},rafQueue=[];let authChange,createdCanvases=0,drawImages=0;const paintedColors=[];
  const gradient={addColorStop(){}};
  const fakeCtx=new Proxy({createLinearGradient(){return gradient;},createRadialGradient(){return gradient;},drawImage(){drawImages++;}},
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
  const window={matchMedia:()=>({matches:false}),addEventListener(){},ToolboxAuth:auth?toolbox:undefined};
  const localStorage={getItem(key){return storage.has(key)?storage.get(key):null;},setItem(key,value){storage.set(key,String(value));}};
  const document={getElementById:element,addEventListener(t,fn){events[t]=fn;},body:{setAttribute(){}},
    createElement(tag){if(tag!=='canvas')throw new Error('Unexpected element');createdCanvases++;return {getContext(){return fakeCtx;}};}};
  const context={window,document,navigator:{},localStorage,performance:{now:()=>1000},
    requestAnimationFrame(fn){if(render)rafQueue.push(fn);},setTimeout,clearTimeout,AbortController,fetch:fetchImpl,Intl,console};
  // Test-only closure access, not shipped in the game.
  const instrumented=source.replace('  loadBest();loadPendingBest();restorePendingRuns();resetGame(true);',`  window.testApi={startGame,finishGame,openLeaderboard,closeLeaderboard,sendRun,submitOnlineRun,refreshLeaderboard,retryPendingSubmission,get active(){return activeRun;},get state(){return state;},get best(){return best;},get pendingBest(){return pendingBest;},set score(value){score=value;},drawBirdForSkin(value){birdSkin=value;drawBird(1000);},birdRadiusForTest(){return birdRadius();},skinName(value){return BIRD_SKINS[value].name;}};\n  loadBest();loadPendingBest();restorePendingRuns();resetGame(true);`);
  vm.runInNewContext(instrumented,context);
  return {api:window.testApi,e:element,events,authChange,session,storage,
    tick(t){const callback=rafQueue.shift();if(!callback)throw new Error('Missing RAF callback');callback(t);},
    createdCanvases(){return createdCanvases;},drawImages(){return drawImages;},
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
