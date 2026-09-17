(function(global){
  'use strict';
  const URL='https://tmxpueakxibsaakdyusn.supabase.co';
  const KEY='sb_publishable_8sCgnOXk3XuRE28Qmk_ekg_9VSS4ASZ';
  const STORE='toolboxSupabaseAuth.v1';
  const LEGACY=['dinnerSupabaseAuth.v1','sb-tmxpueakxibsaakdyusn-auth-token'];
  const GUARD='toolboxLoginGuard.v1';
  const CHANNEL='toolbox-auth-v1';
  const PROBE_MS=60000;
  let session=null,refreshPromise=null,lastProbe=0;
  const listeners=new Set();
  const tabId=(global.crypto&&global.crypto.randomUUID)?global.crypto.randomUUID():Math.random().toString(36).slice(2);
  const bc=('BroadcastChannel' in global)?new BroadcastChannel(CHANNEL):null;

  class ToolboxAuthError extends Error{
    constructor(message,code='AUTH_ERROR',status=0){super(message);this.name='ToolboxAuthError';this.code=code;this.status=status;}
  }
  const safeParse=v=>{try{return JSON.parse(v)}catch{return null}};
  function findSession(v,depth=0){
    if(!v||depth>3)return null;
    if(v.access_token&&v.refresh_token)return v;
    for(const k of ['currentSession','session','data']){const s=findSession(v[k],depth+1);if(s)return s;}
    if(Array.isArray(v)){for(const x of v){const s=findSession(x,depth+1);if(s)return s;}}
    return null;
  }
  function readStored(){
    try{
      const primary=findSession(safeParse(localStorage.getItem(STORE)));
      if(primary)return primary;
      for(const key of LEGACY){
        const found=findSession(safeParse(localStorage.getItem(key)));
        if(found){writeStored(found,false);return found;}
      }
    }catch{}
    return null;
  }
  function writeStored(value,notify=true){
    session=value||null;
    try{
      if(session)localStorage.setItem(STORE,JSON.stringify(session));else localStorage.removeItem(STORE);
      for(const key of LEGACY)localStorage.removeItem(key);
    }catch{}
    if(notify){
      const event=session?'SIGNED_IN':'SIGNED_OUT';
      listeners.forEach(fn=>{try{fn(event,session)}catch{}});
      try{bc?.postMessage({source:tabId,event,session})}catch{}
    }
  }
  function current(){session=readStored();return session;}
  function headers(extra={}){const s=current();return {'apikey':KEY,'Authorization':`Bearer ${s?.access_token||KEY}`,...extra};}
  async function parseResponse(r){
    const text=await r.text();let data=null;
    if(text){try{data=JSON.parse(text)}catch{data=text}}
    if(!r.ok){
      const message=data?.msg||data?.message||data?.error_description||data?.error||`HTTP ${r.status}`;
      const code=data?.code||data?.error_code||(r.status===429?'OVER_RATE_LIMIT':'HTTP_'+r.status);
      throw new ToolboxAuthError(message,code,r.status);
    }
    return data;
  }
  async function authRequest(path,{method='POST',body,authorization}={}){
    const h={'apikey':KEY,'Content-Type':'application/json'};
    if(authorization)h.Authorization=`Bearer ${authorization}`;
    let r;
    try{r=await fetch(URL+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});}
    catch{throw new ToolboxAuthError('无法连接登录服务，请检查网络。','NETWORK_ERROR',0)}
    return parseResponse(r);
  }
  function readGuard(){try{return safeParse(localStorage.getItem(GUARD))||{fails:0,lockUntil:0}}catch{return {fails:0,lockUntil:0}}}
  function writeGuard(v){try{localStorage.setItem(GUARD,JSON.stringify(v))}catch{}}
  function resetGuard(){try{localStorage.removeItem(GUARD)}catch{}}
  function lockRemaining(){return Math.max(0,Math.ceil((Number(readGuard().lockUntil||0)-Date.now())/1000));}
  function noteFailure(err){
    const g=readGuard();
    if(err?.status===429){g.lockUntil=Math.max(g.lockUntil||0,Date.now()+60000);writeGuard(g);return;}
    if(![400,401,403,422].includes(Number(err?.status)))return;
    g.fails=Number(g.fails||0)+1;
    if(g.fails>=5){const seconds=Math.min(600,30*Math.pow(2,g.fails-5));g.lockUntil=Date.now()+seconds*1000;}
    writeGuard(g);
  }
  async function signIn(email,password){
    const remain=lockRemaining();
    if(remain>0)throw new ToolboxAuthError(`尝试过于频繁，请 ${remain} 秒后再试。`,'LOCAL_LOGIN_COOLDOWN',429);
    try{
      const data=await authRequest('/auth/v1/token?grant_type=password',{body:{email,password}});
      if(!data?.access_token||!data?.refresh_token)throw new ToolboxAuthError('登录响应无效。','INVALID_AUTH_RESPONSE',500);
      resetGuard();writeStored(data);lastProbe=0;return data;
    }catch(err){noteFailure(err);throw err;}
  }
  async function doRefresh(){
    const s=current();if(!s?.refresh_token)return null;
    try{
      const data=await authRequest('/auth/v1/token?grant_type=refresh_token',{body:{refresh_token:s.refresh_token}});
      if(!data?.access_token)throw new ToolboxAuthError('登录状态刷新失败。','INVALID_REFRESH_RESPONSE',401);
      writeStored(data);lastProbe=0;return data;
    }catch(err){writeStored(null);throw new ToolboxAuthError('登录已失效，请重新登录。','AUTH_REQUIRED',401);}
  }
  async function refresh(){
    if(refreshPromise)return refreshPromise;
    const run=async()=>{
      const latest=current();
      if(latest?.expires_at&&Number(latest.expires_at)-Date.now()/1000>120)return latest;
      return doRefresh();
    };
    refreshPromise=(global.navigator?.locks?.request
      ? global.navigator.locks.request('toolbox-auth-refresh',{mode:'exclusive'},run)
      : run()).finally(()=>{refreshPromise=null});
    return refreshPromise;
  }
  async function ensure(){
    let s=current();if(!s)return null;
    const exp=Number(s.expires_at||0);
    if(exp&&exp-Date.now()/1000<120)s=await refresh();
    return s;
  }
  async function rawRest(path,{method='GET',body=null,prefer='',retry=true,skipEnsure=false}={}){
    if(!skipEnsure&&!(await ensure()))throw new ToolboxAuthError('请先登录。','AUTH_REQUIRED',401);
    const h=headers({'Content-Type':'application/json'});if(prefer)h.Prefer=prefer;
    let r;
    try{r=await fetch(URL+'/rest/v1/'+path,{method,headers:h,body:body==null?undefined:JSON.stringify(body),cache:'no-store'});}
    catch{throw new ToolboxAuthError('网络连接失败，请稍后重试。','NETWORK_ERROR',0)}
    if(r.status===401&&retry){try{await doRefresh();return rawRest(path,{method,body,prefer,retry:false,skipEnsure:true});}catch{}}
    return parseResponse(r);
  }
  async function probe(force=false){
    const s=await ensure();if(!s)return null;
    if(!force&&Date.now()-lastProbe<PROBE_MS)return {active:true};
    const data=await rawRest('rpc/toolbox_session_status',{method:'POST',body:{},skipEnsure:true,retry:true});
    lastProbe=Date.now();
    if(!data?.active){writeStored(null);throw new ToolboxAuthError('登录会话已被撤销，请重新登录。','SESSION_REVOKED',401);}
    return data;
  }
  async function rest(path,opts={}){await probe(false);return rawRest(path,{...opts,skipEnsure:true});}
  async function rpc(name,args={}){return rest('rpc/'+encodeURIComponent(name),{method:'POST',body:args});}
  async function signOut(){
    const s=current();
    try{if(s?.access_token)await fetch(URL+'/auth/v1/logout?scope=local',{method:'POST',headers:headers({'Content-Type':'application/json'}),cache:'no-store'});}catch{}
    writeStored(null);lastProbe=0;return true;
  }
  function onAuthStateChange(callback){listeners.add(callback);return {data:{subscription:{unsubscribe:()=>listeners.delete(callback)}}};}

  class QueryBuilder{
    constructor(table){this.table=table;this.method='GET';this.body=null;this.params=[];this.prefer='';}
    select(cols='*'){this.params=this.params.filter(([k])=>k!=='select');this.params.push(['select',cols]);return this;}
    eq(col,val){this.params.push([col,'eq.'+String(val)]);return this;}
    gte(col,val){this.params.push([col,'gte.'+String(val)]);return this;}
    lte(col,val){this.params.push([col,'lte.'+String(val)]);return this;}
    order(col,opt={}){this.params.push(['order',`${col}.${opt.ascending===false?'desc':'asc'}`]);return this;}
    limit(n){this.params.push(['limit',String(n)]);return this;}
    insert(body){this.method='POST';this.body=body;this.prefer='return=minimal';return this;}
    update(body){this.method='PATCH';this.body=body;this.prefer='return=minimal';return this;}
    delete(){this.method='DELETE';this.body=null;this.prefer='return=minimal';return this;}
    async execute(){
      const qs=this.params.length?'?'+this.params.map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&'):'';
      try{return {data:await rest(encodeURIComponent(this.table)+qs,{method:this.method,body:this.body,prefer:this.prefer}),error:null};}
      catch(error){return {data:null,error};}
    }
    then(resolve,reject){return this.execute().then(resolve,reject);}
  }
  function createClient(){
    return {
      auth:{
        signInWithPassword:async({email,password})=>{try{const s=await signIn(email,password);return {data:{user:s.user,session:s},error:null};}catch(error){return {data:{user:null,session:null},error};}},
        getSession:async()=>{try{return {data:{session:await ensure()},error:null};}catch(error){return {data:{session:null},error};}},
        signOut:async()=>{try{await signOut();return {error:null};}catch(error){return {error};}},
        onAuthStateChange
      },
      rpc:async(name,args={})=>{try{return {data:await rpc(name,args),error:null};}catch(error){return {data:null,error};}},
      from:table=>new QueryBuilder(table)
    };
  }
  function authMessage(err){
    if(!err)return '登录失败，请稍后再试。';
    if(err.code==='LOCAL_LOGIN_COOLDOWN'||err.status===429)return err.message||'尝试过于频繁，请稍后再试。';
    if(err.code==='NETWORK_ERROR')return '无法连接登录服务，请检查网络。';
    if(['invalid_credentials','email_not_confirmed'].includes(err.code)||[400,401].includes(err.status))return '邮箱或密码错误。';
    return err.message||'登录失败，请稍后再试。';
  }

  global.addEventListener?.('storage',e=>{
    if(e.key!==STORE)return;session=readStored();const event=session?'SIGNED_IN':'SIGNED_OUT';listeners.forEach(fn=>{try{fn(event,session)}catch{}});
  });
  bc?.addEventListener('message',e=>{
    if(e.data?.source===tabId)return;session=readStored();const event=session?'SIGNED_IN':'SIGNED_OUT';listeners.forEach(fn=>{try{fn(event,session)}catch{}});
  });

  async function foregroundProbe(){
    if(global.document?.hidden||!current())return;
    try{await probe(true)}catch(err){
      if(!['SESSION_REVOKED','AUTH_REQUIRED'].includes(err?.code))console.warn('toolbox session probe failed',err);
    }
  }
  const probeTimer=global.setInterval?.(foregroundProbe,PROBE_MS);
  global.addEventListener?.('focus',foregroundProbe);
  global.document?.addEventListener?.('visibilitychange',()=>{if(!global.document.hidden)foregroundProbe()});
  global.addEventListener?.('pagehide',()=>{if(probeTimer)global.clearInterval?.(probeTimer)},{once:true});

  session=readStored();
  global.ToolboxAuth={url:URL,key:KEY,storeKey:STORE,createClient,signIn,signOut,refresh,getSession:ensure,peekSession:current,rest,rpc,probe,authMessage,lockRemaining,ToolboxAuthError};
})(window);
