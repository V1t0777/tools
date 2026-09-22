// Run: node --test scripts/pictionary-sync.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../pictionary/app.js'),'utf8');
const fields=['state','me','currentRoundId','strokes','canvasRevision','canvasDirty','canvasNeedsSync','lastDrawerAt','lastPongAt','realtimeStatus','suspended','scoreRevision','roomEpoch','connectionEpoch','clockTimer','canvasSyncTimer','heartbeatTimer','pollTimer','refreshQueued','transitionBusy','guessRequests','liveGuesses','pendingPings','reconnectTimer','subscribedAt'];
const injected=source.replace('  boot();',`globalThis.audit={api,bind,enterRoom,connectRealtime,leaveRealtime,refreshState,requestState,exitToHome,adoptState,applyScores,receiveGuessResult,submitGuess,deliverGuess,hasGuessed,switchRound,receiveStroke,receiveCanvasControl,receiveSnapshot,applyCanvasSnapshot,pullCanvasFallback,persistCanvasFallback,sendSnapshot,sendPing,handlePong,isRealtimeHealthy,isCanvasHealthy,checkHealth,startRoomTimers,resumeRoom,
setApi(fn){api=fn;},set(v){${fields.map(f=>`if('${f}' in v)${f}=v.${f};`).join('')}} ,get(){return {${fields.join(',')}}}};`);
function setup(){
 const elements=new Map(),timeouts=new Map(),intervals=new Map(),events=new Map(),channels=[];
 let serial=0;const noop=()=>{};
 const ctx=new Proxy({},{get:()=>noop,set:()=>true});
 const element=id=>{if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',textContent:'',classList:{add:noop,remove:noop,toggle:noop},getContext:()=>ctx,querySelector:()=>element(id+'button'),addEventListener:(name,fn)=>events.set(id+':'+name,fn),getBoundingClientRect:()=>({width:800,height:500}),dataset:{}});return elements.get(id);};
 const client=()=>({realtime:{setAuth:async()=>{},disconnect:noop},channel(){const c={handlers:new Map(),on(type,filter,fn){c.handlers.set(type+':'+filter.event,fn);return c;},subscribe(fn){c.status=fn;return c;},track:async()=>{},send:async()=> 'ok',presenceState:()=>({})};channels.push(c);return c;},removeAllChannels:async()=>{}});
 const sandbox={ToolboxAuth:{url:'https://example.invalid',key:'public',getSession:async()=>({access_token:'test',user:{id:'user'}})},document:{getElementById:element,querySelector:element,querySelectorAll:()=>[],addEventListener:(name,fn)=>events.set('document:'+name,fn),hidden:false},window:{supabase:{createClient:client},addEventListener:(name,fn)=>events.set('window:'+name,fn)},console:{warn:noop},crypto:require('node:crypto').webcrypto,URL,AbortController,TypeError,Error,location:{href:'https://example.invalid/'},history:{replaceState:noop},sessionStorage:{getItem:()=>null,setItem:noop},fetch:async()=>new Promise(()=>{}),setTimeout:(fn,ms)=>{const id=++serial;timeouts.set(id,{fn,ms});return id;},clearTimeout:id=>timeouts.delete(id),setInterval:(fn,ms)=>{const id=++serial;intervals.set(id,{fn,ms});return id;},clearInterval:id=>intervals.delete(id),requestAnimationFrame:noop};
 vm.createContext(sandbox);vm.runInContext(injected,sandbox);const a=sandbox.audit;
 const state={room:{id:'room',code:'ABCDEF',status:'playing',current_drawer_member_id:'drawer',round_no:1,total_rounds:6},round:{id:'r1'},players:[{member_id:'me',score:0,nickname:'me',ready:true},{member_id:'other',score:150,nickname:'other',ready:true},{member_id:'drawer',score:50,nickname:'drawer',ready:true}],guesses:[]};
 a.set({me:{id:'me',nickname:'me'},currentRoundId:'r1',state});
 const runTimers=async ms=>{for(const [id,t] of [...timeouts])if(t.ms===ms){timeouts.delete(id);t.fn();}for(let i=0;i<8;i++)await Promise.resolve();};
 return {a,element,sandbox,events,channels,timeouts,intervals,runTimers};
}
const stroke=id=>({id,color:'#111827',size:7,points:[[0,0],[.5,.5]]});
const score=(revision,other=150,drawer=50)=>({revision,scores:[{member_id:'other',score:other},{member_id:'drawer',score:drawer}]});
const result={guess_id:'g',client_id:'c',round_id:'r1',member_id:'other',drawer_member_id:'drawer',correct:true,points:150};

test('authoritative score followed by delayed/duplicate broadcast never adds twice',()=>{
 const {a}=setup();a.applyScores(score(2));a.receiveGuessResult({...result,score_state:score(2)});a.receiveGuessResult({...result,score_state:score(2)});
 assert.equal(a.get().state.players[1].score,150);assert.equal(a.get().state.players[2].score,50);
 a.applyScores(score(3,300,100));a.adoptState({...a.get().state,players:a.get().state.players.map(p=>({...p,score:0})),score_state:score(1,0,0)});
 assert.equal(a.get().state.players[1].score,300);
});
test('clear fences late snapshots and partial strokes',()=>{
 const {a}=setup();a.set({canvasRevision:10,strokes:[stroke('old')]});
 a.receiveCanvasControl('clear',{round_id:'r1',base_revision:10,revision:11});
 a.receiveSnapshot({snapshot_id:'s',round_id:'r1',revision:10,total:1,index:0,part:JSON.stringify([stroke('old')])});
 a.receiveStroke({round_id:'r1',base_revision:9,revision:10,id:'old',points:[[.2,.2]]});
 assert.equal(a.get().strokes.length,0);assert.equal(a.get().canvasRevision,11);
});
test('HTTP canvas requested during outage cannot overwrite newer realtime state',async()=>{
 const {a}=setup();let resolve;a.setApi(()=>new Promise(r=>resolve=r));const pending=a.pullCanvasFallback(true);
 a.set({canvasRevision:12,strokes:[stroke('new')],realtimeStatus:'SUBSCRIBED',lastDrawerAt:Date.now()});
 resolve({version:11,strokes:[stroke('old')]});await pending;
 assert.equal(a.get().strokes[0].id,'new');
});
test('missing delta requests repair and complete snapshot converges',()=>{
 const {a}=setup();a.set({canvasRevision:10});
 a.receiveStroke({id:'x',round_id:'r1',base_revision:11,revision:12,points:[[0,0]]});
 assert.equal(a.get().canvasNeedsSync,true);assert.equal(a.get().canvasRevision,10);
 a.receiveSnapshot({snapshot_id:'s',round_id:'r1',revision:12,total:1,index:0,part:JSON.stringify([stroke('x')])});
 assert.equal(a.get().canvasNeedsSync,false);assert.equal(a.get().canvasRevision,12);
});
test('out of order snapshot chunks do not restore a pre-clear canvas',()=>{
 const {a}=setup();a.set({canvasRevision:9});const str=JSON.stringify([stroke('old')]),cut=20;
 a.receiveSnapshot({snapshot_id:'s',round_id:'r1',revision:10,total:2,index:1,part:str.slice(cut)});
 a.receiveCanvasControl('clear',{round_id:'r1',base_revision:9,revision:11});
 a.receiveSnapshot({snapshot_id:'s',round_id:'r1',revision:10,total:2,index:0,part:str.slice(0,cut)});
 assert.equal(a.get().strokes.length,0);
});
test('non-drawer pong does not suppress canvas fallback',()=>{
 const {a}=setup();a.set({realtimeStatus:'SUBSCRIBED',lastDrawerAt:0});a.get().pendingPings.set('p',Date.now()-20);
 a.handlePong({ping_id:'p',target_member_id:'me',responder_member_id:'other',round_id:'r1',canvas_revision:0});
 assert.equal(a.isRealtimeHealthy(),true);assert.equal(a.isCanvasHealthy(),false);
});
test('pong requires a locally outstanding ping id',()=>{
 const {a}=setup();a.set({realtimeStatus:'SUBSCRIBED'});
 a.handlePong({ping_id:'fake',target_member_id:'me',responder_member_id:'drawer',round_id:'r1'});
 assert.equal(a.isRealtimeHealthy(),false);
});
test('late state response cannot resurrect an exited room',async()=>{
 const {a}=setup();let resolve;const old=a.get().state;a.setApi(()=>new Promise(r=>resolve=r));const pending=a.refreshState();a.exitToHome();resolve({state:old});await pending;assert.equal(a.get().state,null);
});
test('state invalidation received during HTTP refresh schedules a follow-up',async()=>{
 const {a,timeouts}=setup();let resolve;a.setApi(()=>new Promise(r=>resolve=r));const pending=a.refreshState();a.requestState();assert.equal(a.get().refreshQueued,true);resolve({state:a.get().state});await pending;assert.ok([...timeouts.values()].some(t=>t.ms===80));
});
test('four hung guesses time out, release slots, and preserve retry controls',async()=>{
 const {a,element,runTimers}=setup();const pending=[];
 for(let i=0;i<4;i++){element('guessInput').value='cat';pending.push(a.submitGuess({preventDefault(){}}));}
 assert.equal(a.get().guessRequests.size,4);await runTimers(8000);await Promise.all(pending);
 assert.equal(a.get().guessRequests.size,0);assert.equal([...a.get().liveGuesses.values()].filter(g=>g.failed&&!g.pending).length,4);
 assert.match(element('guessFeed').innerHTML,/data-retry/);
});
test('authentication stall is bounded by the same request timeout',async()=>{
 const {a,sandbox,runTimers}=setup();sandbox.ToolboxAuth.getSession=()=>new Promise(()=>{});
 const pending=a.api('state').catch(e=>e);await runTimers(8000);assert.equal((await pending).retryable,true);
});
test('retry keeps original client id and round id',async()=>{
 const {a,element}=setup();const calls=[];a.setApi(async(action,payload)=>{calls.push(payload);throw Object.assign(new Error('timeout'),{retryable:true});});
 element('guessInput').value='cat';await a.submitGuess({preventDefault(){}});const item=[...a.get().liveGuesses.values()][0];await a.deliverGuess(item);
 assert.equal(calls.length,2);assert.equal(calls[0].client_id,calls[1].client_id);assert.equal(calls[1].round_id,'r1');
});
test('late guess HTTP response cannot leak into next round',async()=>{
 const {a,element}=setup();let resolve;a.setApi(()=>new Promise(r=>resolve=r));element('guessInput').value='cat';const pending=a.submitGuess({preventDefault(){}});
 a.set({currentRoundId:'r2'});a.get().liveGuesses.clear();resolve({...result,member_id:'me'});await pending;
 assert.equal(a.get().liveGuesses.size,0);assert.equal(element('toast').textContent,'');
});
test('broadcast confirmation survives later HTTP timeout',async()=>{
 const {a,element}=setup();let reject;a.setApi(()=>new Promise((_,r)=>reject=r));element('guessInput').value='cat';const pending=a.submitGuess({preventDefault(){}});const id=[...a.get().liveGuesses.keys()][0];
 a.receiveGuessResult({...result,member_id:'me',client_id:id,correct:false});reject(Object.assign(new Error('timeout'),{retryable:true}));await pending;
 assert.equal(a.get().liveGuesses.get(id).guess_id,'g');assert.equal(a.get().liveGuesses.get(id).failed,false);
});
test('old channel CLOSED and broadcast callbacks cannot corrupt replacement channel',async()=>{
 const {a,channels}=setup();await a.connectRealtime();const old=channels[0];await a.connectRealtime();const current=channels[1];await current.status('SUBSCRIBED');
 await old.status('CLOSED');assert.equal(a.get().realtimeStatus,'SUBSCRIBED');assert.equal(a.get().reconnectTimer,null);
 old.handlers.get('broadcast:guess_result')({payload:result});assert.equal(a.get().liveGuesses.size,0);
});
test('page cache restore restarts countdown, fallback, and health timers',()=>{
 const {a,events}=setup();a.bind();a.startRoomTimers();events.get('window:pagehide')();assert.equal(a.get().clockTimer,null);events.get('window:pageshow')();
 assert.ok(a.get().clockTimer);assert.ok(a.get().canvasSyncTimer);assert.ok(a.get().heartbeatTimer);
});
test('guessed status is independent of truncated chat history',()=>{
 const {a}=setup();a.get().state.solved_members=['me'];a.get().state.guesses=[];assert.equal(a.hasGuessed('me'),true);
});
