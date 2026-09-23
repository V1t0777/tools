const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../shared/toolbox-auth.js'),'utf8');
const STORE='toolboxSupabaseAuth.v1';
const response=(status,body)=>({ok:status<400,status,text:async()=>JSON.stringify(body)});
function setup(seconds=30){
  const saved={access_token:'old',refresh_token:'refresh-old',expires_at:Date.now()/1000+seconds};
  const storage=new Map([[STORE,JSON.stringify(saved)]]),timers=new Map(),intervals=new Map(),events=new Map();let serial=0;
  const sandbox={localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},fetch:async()=>response(503,{message:'offline'}),AbortController,console:{warn(){}},navigator:{},document:{hidden:false,addEventListener:(k,v)=>events.set('document:'+k,v)},addEventListener:(k,v)=>events.set(k,v),setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),setInterval:fn=>{const id=++serial;intervals.set(id,fn);return id;},clearInterval:id=>intervals.delete(id)};
  sandbox.window=sandbox;vm.createContext(sandbox);vm.runInContext(source,sandbox);
  return {a:sandbox.ToolboxAuth,sandbox,storage,timers,intervals,events,saved};
}
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
for(const status of [429,503])test(`refresh HTTP ${status} retains credentials and usable JWT`,async()=>{
  const {a,sandbox}=setup();sandbox.fetch=async()=>response(status,{message:'temporary'});
  assert.equal((await a.getSession()).access_token,'old');assert.equal(a.peekSession().refresh_token,'refresh-old');
});
test('network error with expired JWT preserves refresh token but refuses authorization',async()=>{
  const {a,sandbox}=setup(-1);sandbox.fetch=async()=>{throw new TypeError('offline');};
  await assert.rejects(a.getSession(),e=>e.code==='NETWORK_ERROR');assert.ok(a.peekSession());
});
test('explicitly revoked refresh token clears the session',async()=>{
  const {a,sandbox}=setup();sandbox.fetch=async()=>response(400,{code:'refresh_token_not_found'});
  await assert.rejects(a.getSession(),e=>e.code==='AUTH_REQUIRED');assert.equal(a.peekSession(),null);
});
test('malformed refresh response does not destroy credentials',async()=>{
  const {a,sandbox}=setup(-1);sandbox.fetch=async()=>response(200,{});
  await assert.rejects(a.getSession(),e=>e.code==='INVALID_REFRESH_RESPONSE');assert.ok(a.peekSession());
});
test('hung refresh is bounded even if fetch ignores cancellation',async()=>{
  const {a,sandbox,timers}=setup(-1);sandbox.fetch=()=>new Promise(()=>{});
  const pending=a.getSession();await flush();[...timers.values()].find(t=>t.ms===10000).fn();
  await assert.rejects(pending,e=>e.code==='NETWORK_TIMEOUT');assert.ok(a.peekSession());
});
test('cross-tab lock wait is bounded',async()=>{
  const {a,sandbox,timers}=setup(-1);sandbox.navigator.locks={request:()=>new Promise(()=>{})};
  const pending=a.getSession();await flush();[...timers.values()].find(t=>t.ms===12000).fn();
  await assert.rejects(pending,e=>e.code==='NETWORK_TIMEOUT');assert.ok(a.peekSession());
});
test('double login sends one password request and logout prevents resurrection',async()=>{
  const {a,sandbox}=setup();let resolve,calls=0;
  sandbox.fetch=()=>{calls++;return new Promise(r=>resolve=r);};
  const first=a.signIn('email','password'),second=a.signIn('email','password');assert.equal(first,second);
  await flush();assert.equal(calls,1);const loginResolve=resolve;await a.signOut();
  loginResolve(response(200,{access_token:'new',refresh_token:'new-refresh'}));
  await assert.rejects(first,e=>e.code==='AUTH_CANCELLED');assert.equal(a.peekSession(),null);
});
test('late refresh does not restore a signed-out session',async()=>{
  const {a,sandbox}=setup();let resolve;
  sandbox.fetch=()=>new Promise(r=>resolve=r);const pending=a.refresh();await flush();const refreshResolve=resolve;
  await a.signOut();refreshResolve(response(200,{access_token:'new',refresh_token:'new-refresh'}));await pending;
  assert.equal(a.peekSession(),null);
});
test('probe coalesces requests and rest still uses the shared facade',async()=>{
  const {a,sandbox}=setup(3600);let calls=0;
  sandbox.fetch=async()=>{calls++;return response(200,{active:true});};
  await Promise.all([a.probe(true),a.probe(true),a.probe(true)]);assert.equal(calls,1);
  const result=await a.createClient().from('example').select('*');assert.equal(result.error,null);assert.equal(calls,2);
});
test('bfcache restore restarts exactly one probe timer',()=>{
  const {events,intervals}=setup();assert.equal(intervals.size,1);events.get('pagehide')();assert.equal(intervals.size,0);
  events.get('pageshow')();events.get('pageshow')();assert.equal(intervals.size,1);
});
test('401 REST retries share the refresh operation',async()=>{
  const {a,sandbox}=setup(3600);let refreshCalls=0;
  sandbox.fetch=async(url,opts)=>{
    if(url.includes('grant_type=refresh_token')){refreshCalls++;return response(200,{access_token:'new',refresh_token:'new-refresh',expires_at:Date.now()/1000+3600});}
    if(url.includes('toolbox_session_status'))return response(200,{active:true});
    return opts.headers.Authorization==='Bearer old'?response(401,{}):response(200,[]);
  };
  await Promise.all([a.rest('x'),a.rest('x')]);assert.equal(refreshCalls,1);
});
