import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const html=readFileSync(new URL('../flappy/index.html',import.meta.url),'utf8');
const source=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
new vm.Script(source); // Syntax check independent of the DOM harness.
function setup({auth=true,fetchImpl=async()=>{throw new Error('offline');},storage=new Map([['zhaoFlappyBest.v1','12']])}={}){
  const elements=new Map(),events={};let authChange;
  function element(id){
    if(elements.has(id))return elements.get(id);
    const classes=new Set(),listeners={};
    const node={id,textContent:'',innerHTML:'',value:'',hidden:false,disabled:false,listeners,
      classList:{add(...xs){xs.forEach(x=>classes.add(x));},remove(...xs){xs.forEach(x=>classes.delete(x));},contains(x){return classes.has(x);},toggle(x,on){if(on??!classes.has(x))classes.add(x);else classes.delete(x);}},
      addEventListener(t,fn){listeners[t]=fn;},setAttribute(){},focus(){},querySelector(){return element(id+'button');},querySelectorAll(){return [];},getBoundingClientRect(){return {width:360,height:600};},getContext(){return {};},closest(){return null;}};
    elements.set(id,node);return node;
  }
  const session={user:{id:'u1'},access_token:'fake'};
  const toolbox={url:'https://example.test',key:'public',peekSession:()=>session,getSession:async()=>session,onAuthStateChange:fn=>{authChange=fn;},signIn:async()=>{},authMessage:e=>e.message};
  const window={matchMedia:()=>({matches:false}),addEventListener(){},ToolboxAuth:auth?toolbox:undefined};
  const localStorage={getItem(key){return storage.has(key)?storage.get(key):null;},setItem(key,value){storage.set(key,String(value));}};
  const context={window,document:{getElementById:element,addEventListener(t,fn){events[t]=fn;}},navigator:{},localStorage,performance:{now:()=>1000},requestAnimationFrame(){},setTimeout,clearTimeout,AbortController,fetch:fetchImpl,Intl,console};
  // Test-only closure access, not shipped in the game.
  const instrumented=source.replace('  loadBest();loadPendingBest();restorePendingRuns();resetGame(true);',`  window.testApi={startGame,finishGame,openLeaderboard,closeLeaderboard,sendRun,submitOnlineRun,refreshLeaderboard,retryPendingSubmission,get active(){return activeRun;},get state(){return state;},get best(){return best;},get pendingBest(){return pendingBest;},set score(value){score=value;}};\n  loadBest();loadPendingBest();restorePendingRuns();resetGame(true);`);
  vm.runInNewContext(instrumented,context);
  return {api:window.testApi,e:element,events,authChange,session,storage};
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

