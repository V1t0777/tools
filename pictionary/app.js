(() => {
  'use strict';
  const FUNCTION_URL = `${ToolboxAuth.url}/functions/v1/pictionary-game?forceFunctionRegion=ap-southeast-1`;
  const telemetry=globalThis.PictionaryPerf||{begin:()=>()=>{},sample:()=>{},setPeerRtt:()=>{},readServerTiming:()=>{},sendStart:()=>()=>{},noteRealtimeFailure:()=>{},snapshot:()=>({}),profile:()=>({strokeMs:14,maxPoints:48,recoveryMs:5000,snapshotMs:2500,chunkGapMs:8})};
  const COLORS = ['#111827','#ef4444','#f59e0b','#22c55e','#3b82f6','#8b5cf6','#ec4899','#ffffff'];
  const $ = id => document.getElementById(id);
  const screens = ['authScreen','homeScreen','roomScreen','gameScreen','finishScreen','recoveryScreen'];
  let session=null, me=null, state=null, stateGeneration=0, channel=null, realtime=null, pollTimer=null, clockTimer=null, statePollMs=0;
  let currentRoundId=null, strokes=[], activeStroke=null, sendPoints=[], sendTimer=null, selectedColor=COLORS[0], brushSize=7, erasing=false;
  let canvas=$('canvas'), ctx=canvas.getContext('2d'), logical={w:1,h:1}, busy=false, transitionBusy=false, presenceMembers=new Set();
  let realtimeStatus='CLOSED', reconnectTimer=null, snapshotTimer=null, snapshotAssemblies=new Map();
  let canvasSyncTimer=null, serverSaveTimer=null, canvasFetchBusy=false, canvasSaveBusy=false, canvasSaveQueued=false, lastCanvasVersion=0;
  let pingTimer=null, lastPongAt=0, realtimeRtt=null, subscribedAt=0, realtimeToken=null;
  let liveGuesses=new Map(), appliedGuessResults=new Set(), guessRequests=new Map();
  let roomEpoch=0, connectionEpoch=0, requests=new Set(), refreshQueued=false, refreshTimer=null;
  let heartbeatTimer=null, lastDrawerAt=0, pendingPings=new Map(), reconnectAttempt=0;
  let canvasRevision=0, canvasDirty=false, lastCanvasCheck=0, lastSnapshotRequest=0, canvasNeedsSync=false;
  let sdkPromise=null,initializing=null,startupEpoch=0,loginBusy=false,connectPromise=null,connectDeadline=null,serverHeartbeatAt=0,transportFailed=false;
  let scoreRevision=-1, scoreTotals=new Map(), hintRequested=false, suspended=false;
  let transitionRetryAt=0;
  let pendingCanvasDeltas=new Map(),canvasGapTimer=null,snapshotBroadcastTimer=null,lastSnapshotBroadcastAt=0;
  let drawChannel=null,drawStatus='CLOSED',drawTopic=null,drawChannelEpoch=0,drawRetryTimer=null,drawRetryAttempt=0;
  let lastPeerCanvasAckAt=0,drawInFlight=0;
  const CANVAS_REORDER_WAIT_MS=140, SNAPSHOT_COALESCE_MS=850;

  function updatePerfDiagnostics(){
    const panel=$('networkDiagnostics');
    if(!panel?.open)return;
    const box=$('perfDetails'),summary=telemetry.snapshot();
    if(!box||!summary?.latency)return;
    const fmt=key=>{
      const m=summary.latency[key];
      return m?`${Math.round(m.p50)}/${Math.round(m.p95)} ms (n=${m.count})`:'样本不足';
    };
    box.textContent=[
      `Edge 固定路由：新加坡 (${summary.route})`,
      `实际观测区域：${summary.observedRegion}`,
      `网络自适应：${summary.tier}（自动）`,
      `Realtime 对端 RTT：${summary.peerRtt===null?'样本不足':summary.peerRtt+' ms'}`,
      `HTTP API P50/P95：${fmt('api.total')}`,
      `Edge 执行 P50/P95：${fmt('edge.total')}`,
      `Edge 身份/限流/业务：${fmt('edge.auth')} | ${fmt('edge.limit')} | ${fmt('edge.business')}`,
      `Realtime SDK 发送等待：${fmt('realtime.send_wait')}`,
      `发送进行中/峰值：${summary.send.pending}/${summary.send.maxPending}；失败：${summary.send.errors}`,
      `画布全量重绘：${fmt('canvas.redraw')}`,
      `主线程长任务：${fmt('main.longtask')}`,
      '说明：RTT 含对端回声耗时；SDK 等待不等于远端确认；仅本地保存匿名指标。'
    ].join('\n');
  }

  function show(id){ screens.forEach(x => $(x).classList.toggle('active',x===id)); }
  function toast(message){ const el=$('toast'); el.textContent=message; el.classList.add('show'); clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove('show'),2300); }
  function escapeHTML(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
  function makeClientId(){
    if(crypto.randomUUID)return crypto.randomUUID();
    const b=new Uint8Array(16);crypto.getRandomValues(b);b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
    const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  }
  function codeFromURL(){ return (new URLSearchParams(location.search).get('room')||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6); }
  function setURL(code){ const u=new URL(location.href); code?u.searchParams.set('room',code):u.searchParams.delete('room'); history.replaceState({},'',u); }

  async function api(action,payload={},options={}){
    if(window.navigator?.onLine===false)throw Object.assign(new Error("网络已断开，恢复后请重试"),{retryable:true});
    const stopTotal=telemetry.begin('api.total');
    const controller=new AbortController(), epoch=roomEpoch;
    requests.add(controller);
    let timer;
    const cancelled=new Promise((_,reject)=>{
      controller.signal.addEventListener('abort',()=>reject(controller.signal.reason),{once:true});
      timer=setTimeout(()=>controller.abort(Object.assign(new Error('网络较慢，尚未确认，请重试'),{retryable:true})),options.timeout||8000);
    });
    const work=(async()=>{
      const stopAuth=telemetry.begin('api.auth');
      let auth;try{auth=await ToolboxAuth.getSession();}finally{stopAuth();}
      if(controller.signal.aborted)throw controller.signal.reason;
      if(!auth)throw Object.assign(new Error('请先登录'),{code:'AUTH_REQUIRED',status:401});
      session=auth;
      if(realtime&&realtimeToken!==auth.access_token){realtimeToken=auth.access_token;Promise.resolve(realtime.realtime.setAuth(auth.access_token)).catch(()=>scheduleReconnect());}
      const stopFetch=telemetry.begin('api.fetch');
      let r;try{
        r=await fetch(FUNCTION_URL,{method:'POST',cache:'no-store',signal:controller.signal,
          headers:{'Content-Type':'application/json','apikey':ToolboxAuth.key,'Authorization':`Bearer ${auth.access_token}`},
          body:JSON.stringify({action,...payload})});
      }finally{stopFetch();}
      telemetry.readServerTiming(action,r.headers);
      const stopParse=telemetry.begin('api.parse');
      let data;try{data=await r.json().catch(()=>({}));}finally{stopParse();}
      if(!r.ok||data.error)throw Object.assign(new Error(data.error||`请求失败（${r.status}）`),{status:r.status,code:data.code,retryable:r.status>=500||r.status===429});
      if(epoch!==roomEpoch)throw Object.assign(new Error('会话已切换'),{cancelled:true});
      return data;
    })();
    try{return await Promise.race([work,cancelled]);}
    catch(err){if(err instanceof TypeError)err.retryable=true;throw err;}
    finally{clearTimeout(timer);requests.delete(controller);stopTotal();}
  }
  function invalidateRoom(){
    roomEpoch++;stateGeneration++;
    for(const c of requests)c.abort(Object.assign(new Error('会话已切换'),{cancelled:true}));
    requests.clear();guessRequests.clear();liveGuesses.clear();appliedGuessResults.clear();
    busy=false;transitionBusy=false;refreshQueued=false;transitionRetryAt=0;
    clearTimeout(refreshTimer);refreshTimer=null;
    scoreRevision=-1;scoreTotals.clear();
    clearTimeout(canvasGapTimer);canvasGapTimer=null;pendingCanvasDeltas.clear();
    clearTimeout(snapshotBroadcastTimer);snapshotBroadcastTimer=null;lastSnapshotBroadcastAt=0;
    stopDrawingChannel();drawRetryAttempt=0;lastPeerCanvasAckAt=0;
  }
  function applyScores(data){
    if(!data||!Number.isSafeInteger(Number(data.revision))||Number(data.revision)<scoreRevision||!Array.isArray(data.scores))return;
    scoreRevision=Number(data.revision);
    scoreTotals=new Map(data.scores.map(x=>[x.member_id,Number(x.score)||0]));
    for(const p of state?.players||[])if(scoreTotals.has(p.member_id))p.score=scoreTotals.get(p.member_id);
  }
  function adoptState(next){
    const previousStatus=state?.room?.status,previousRound=state?.round?.id||null;
    const previousRoom=state?.room;
    if(previousRoom?.id===next?.room?.id &&
       (Number(next.room.realtime_generation||0)<Number(previousRoom.realtime_generation||0) ||
        Number(next.room.state_revision||0)<Number(previousRoom.state_revision||0)))return;
    state=next;
    if(previousRoom?.id===next?.room?.id && previousRoom.realtime_token!==next.room.realtime_token && !suspended){
      leaveRealtime(false);
      connectRealtime().catch(()=>scheduleReconnect());
    }
    if(previousStatus!==next?.room?.status||previousRound!==(next?.round?.id||null))transitionRetryAt=0;
    applyScores(next.score_state);
    for(const p of state?.players||[])if(scoreTotals.has(p.member_id))p.score=scoreTotals.get(p.member_id);
    renderState();
    syncDrawingChannel();
  }
  function requestState(delay=80){
    if(!state||suspended||window.navigator?.onLine===false)return;
    if(transitionBusy||busy){refreshQueued=true;return;}
    if(refreshTimer)return;
    refreshTimer=setTimeout(()=>{refreshTimer=null;refreshState();},delay);
  }
  function startRoomTimers(){
    if(!state||suspended||window.navigator?.onLine===false)return;
    setStatePoll(isRealtimeHealthy()?18000:1800);
    clearInterval(clockTimer);clockTimer=setInterval(tick,250);
    clearInterval(canvasSyncTimer);canvasSyncTimer=setInterval(pullCanvasFallback,650);
    clearInterval(heartbeatTimer);heartbeatTimer=setInterval(checkHealth,1000);
  }
  function resumeRoom(){
    if(!state||document.hidden||window.navigator?.onLine===false)return;
    suspended=false;startRoomTimers();requestState(0);
    if(!isRealtimeHealthy()&&realtimeStatus!=='CONNECTING')scheduleReconnect(0);
    else {sendPing();syncDrawingChannel();requestCanvas();}
  }

  function ensureRealtimeSDK(){
    if(window.supabase?.createClient)return Promise.resolve();
    if(sdkPromise)return sdkPromise;
    sdkPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      const finish=err=>{clearTimeout(timer);script.onload=script.onerror=null;if(err){script.remove();reject(err);}else resolve();};
      const timer=setTimeout(()=>finish(new Error('实时连接组件加载超时')),8000);
      script.src='../shared/vendor/supabase-2.57.4.min.js';
      script.integrity='sha384-AkNSQdptcXlJ0/NBZc4qGk86cDVXcCevwoWgEKIpHOEfbvlXGLlIkimQtONt8KNf';
      script.onload=()=>finish(window.supabase?.createClient?null:new Error('实时连接组件加载失败'));
      script.onerror=()=>finish(new Error('实时连接组件加载失败'));document.head.appendChild(script);
    }).catch(err=>{sdkPromise=null;throw err;});return sdkPromise;
  }
  function initializeSession(){
    if(initializing)return initializing;
    const epoch=++startupEpoch;
    initializing=(async()=>{
      show('recoveryScreen');$('recoveryMessage').textContent='正在恢复登录和房间…';$('retrySessionBtn').disabled=true;
      try{
        session=await ToolboxAuth.getSession();
        if(epoch!==startupEpoch)return;
        if(!session){show('authScreen');return;}
        const code=codeFromURL();let data;
        try{data=await api('bootstrap',{code});}
        catch(err){
          if(code&&[400,404,410].includes(err.status)){setURL('');toast(err.message);data=await api('bootstrap');}
          else throw err;
        }
        if(epoch!==startupEpoch)return;
        me=data.member;$('welcomeName').textContent=me.nickname;show('homeScreen');
        if(data.state)await enterRoom(data.state);
      }catch(err){
        if(epoch!==startupEpoch)return;
        if(['AUTH_REQUIRED','SESSION_REVOKED'].includes(err.code)){
          await ToolboxAuth.signOut();session=null;show('authScreen');$('loginError').textContent=ToolboxAuth.authMessage(err);
        }else{show('recoveryScreen');$('recoveryMessage').textContent=err.message||'网络暂时不可用，请重试。';}
      }finally{$('retrySessionBtn').disabled=false;}
    })().finally(()=>{if(epoch===startupEpoch)initializing=null;});return initializing;
  }
  async function boot(){
    buildTools();bind();resizeCanvas();
    ensureRealtimeSDK().catch(()=>{});
    await initializeSession();
  }

  function clearLocalSession(){
    startupEpoch++;initializing=null;
    invalidateRoom();leaveRealtime();
    session=me=state=null;currentRoundId=null;
    strokes=[];activeStroke=null;sendPoints=[];snapshotAssemblies.clear();
    ctx.clearRect(0,0,canvas.width,canvas.height);
    setURL('');$('shareBtn').classList.add('hidden');$('leaveBtn').classList.add('hidden');
    $('wordModal').classList.add('hidden');show('authScreen');
  }
  function bind(){
    ToolboxAuth.onAuthStateChange((event,next)=>{
      if(event==='SIGNED_OUT'||(session?.user?.id&&next?.user?.id&&session.user.id!==next.user.id))clearLocalSession();
    });
    $('loginForm').addEventListener('submit',async e=>{
      e.preventDefault();if(loginBusy)return;loginBusy=true;
      const button=$('loginForm').querySelector('button');button.disabled=true;button.textContent='正在登录…';$('loginError').textContent='';
      try{session=await ToolboxAuth.signIn($('emailInput').value.trim(),$('passwordInput').value);$('passwordInput').value='';await initializeSession();}
      catch(err){$('loginError').textContent=ToolboxAuth.authMessage(err);}
      finally{loginBusy=false;button.disabled=false;button.textContent='登录';}
    });
    $('retrySessionBtn').onclick=initializeSession;
    $('resetSessionBtn').onclick=async()=>{startupEpoch++;initializing=null;await ToolboxAuth.signOut();session=null;show('authScreen');};
    $('signOutBtn').onclick=async()=>{invalidateRoom();leaveRealtime();await ToolboxAuth.signOut();session=me=state=null;setURL('');$('shareBtn').classList.add('hidden');$('leaveBtn').classList.add('hidden');show('authScreen');};
    $('createBtn').onclick=async()=>{try{const data=await api('create_room');await enterRoom(data.state);}catch(err){toast(err.message);}};
    $('joinForm').addEventListener('submit',async e=>{e.preventDefault();await joinRoom($('roomCodeInput').value);});
    $('shareBtn').onclick=shareRoom;
    $('leaveBtn').onclick=leaveRoom;
    $('readyBtn').onclick=async()=>mutate('toggle_ready');
    $('startBtn').onclick=async()=>mutate('start_game');
    $('guessForm').addEventListener('submit',submitGuess);
    $('guessFeed').addEventListener('click',e=>{
      const id=e.target.closest('[data-retry]')?.dataset.retry;
      const item=liveGuesses.get(id);if(item&&!item.pending)deliverGuess(item);
    });
    $('againBtn').onclick=async()=>mutate('play_again');
    $('wordOptions').addEventListener('click',async e=>{const b=e.target.closest('[data-option]');if(!b||busy)return;const modal=$('wordModal');b.disabled=true;modal.classList.add('hidden');$('canvasCover').classList.remove('hidden');$('coverText').textContent='正在开始本轮…';try{await mutate('choose_word',{option_id:b.dataset.option});}catch(err){b.disabled=false;modal.classList.remove('hidden');toast(err.message);}});
    $('colors').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;selectedColor=b.dataset.color;erasing=false;document.querySelectorAll('#colors button').forEach(x=>x.classList.toggle('active',x===b));$('eraserBtn').classList.remove('active');});
    document.querySelector('.brushes').addEventListener('click',e=>{const b=e.target.closest('[data-size]');if(!b)return;brushSize=Number(b.dataset.size);document.querySelectorAll('[data-size]').forEach(x=>x.classList.toggle('active',x===b));});
    $('eraserBtn').onclick=()=>{erasing=!erasing;$('eraserBtn').classList.toggle('active',erasing);};
    $('undoBtn').onclick=undoStroke; bindHoldClear();
    canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointermove',pointerMove);canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('pointercancel',pointerUp);
    window.addEventListener('resize',resizeCanvas);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)resumeRoom();else if(activeStroke)pointerUp({preventDefault(){}});});
    window.addEventListener('pagehide',()=>{if(activeStroke)pointerUp({preventDefault(){}});suspended=true;invalidateRoom();leaveRealtime();});
    window.addEventListener('pageshow',resumeRoom);
    window.addEventListener('online',()=>{if(state)resumeRoom();else if(ToolboxAuth.peekSession?.())initializeSession();});
    window.addEventListener('offline',()=>{lastPongAt=lastDrawerAt=0;transportFailed=true;clearTimeout(reconnectTimer);reconnectTimer=null;updateRealtimeStatus();});
  }

  function buildTools(){
    $('colors').innerHTML=COLORS.map((c,i)=>`<button aria-label="颜色" data-color="${c}" class="${i===0?'active':''}" style="background:${c}"></button>`).join('');
  }

  async function joinRoom(raw,silent=false){
    const code=String(raw||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);
    if(code.length!==6){if(!silent)toast('请输入 6 位房间码');return;}
    try{const data=await api('join_room',{code});await enterRoom(data.state);}catch(err){toast(err.message);if(silent&&!err.retryable)setURL('');}
  }
  async function enterRoom(next){
    invalidateRoom();state=next;suspended=false;currentRoundId=null;canvasRevision=0;
    setURL(state.room.code);$('shareBtn').classList.remove('hidden');$('leaveBtn').classList.remove('hidden');
    adoptState(next);startRoomTimers();connectRealtime().catch(()=>scheduleReconnect());
  }
  function setStatePoll(ms){
    if(pollTimer&&statePollMs===ms)return;
    clearInterval(pollTimer);statePollMs=ms;pollTimer=setInterval(refreshState,ms);
  }
  async function mutate(action,payload={}){
    if(busy||!state)return;
    busy=true;const generation=++stateGeneration,epoch=roomEpoch;
    try{
      const data=await api(action,{room_id:state.room.id,round_id:currentRoundId,...payload});
      if(data.state&&epoch===roomEpoch&&generation===stateGeneration){adoptState(data.state);sendEvent('state_changed',{at:Date.now(),sync:true});}
      return data;
    }finally{if(epoch===roomEpoch){busy=false;if(refreshQueued){refreshQueued=false;requestState();}}}
  }

  function exitToHome(message=''){
    invalidateRoom();leaveRealtime();state=null;currentRoundId=null;strokes=[];activeStroke=null;setURL('');
    $('shareBtn').classList.add('hidden');$('leaveBtn').classList.add('hidden');$('wordModal').classList.add('hidden');
    show('homeScreen');if(message)toast(message);
  }
  async function leaveRoom(){
    if(!state||busy)return;
    const host=state.room.host_member_id===me?.id;
    const active=!['lobby','finished'].includes(state.room.status);
    const message=host
      ? '你是房主，退出将结束这个房间。确定退出吗？'
      : active
        ? '对局正在进行，主动退出会结束本局。确定退出吗？'
        : '确定退出这个房间吗？';
    if(!window.confirm(message))return;
    busy=true;
    try{
      await api(host?'close_room':'leave_room',{room_id:state.room.id});
      exitToHome(host?'房间已结束':'已退出房间');
    }catch(err){toast(err.message);}
    finally{busy=false;}
  }
  async function refreshState(){
    if(!state||suspended||window.navigator?.onLine===false)return;
    if(busy||transitionBusy){refreshQueued=true;return;}
    const generation=stateGeneration,epoch=roomEpoch,roomId=state.room.id;transitionBusy=true;
    try{
      const data=await api('state',{room_id:roomId});
      if(epoch!==roomEpoch||generation!==stateGeneration||state?.room.id!==roomId)return;
      adoptState(data.state);
    }catch(err){
      if(epoch!==roomEpoch||err.cancelled)return;
      if(/不在.*房间|房间不存在|房间已由房主结束|房间因长时间无人活动已过期|房间已过期|房间已结束/.test(err.message))exitToHome(err.message);
      else console.warn(err?.code||'ACTION_FAILED');
    }finally{
      if(epoch===roomEpoch){transitionBusy=false;if(refreshQueued){refreshQueued=false;requestState();}}
    }
  }
  function connectRealtime(){
    if(connectPromise)return connectPromise;
    const task=openRealtime();connectPromise=task;
    task.finally(()=>{if(connectPromise===task)connectPromise=null;}).catch(()=>{});return task;
  }
  async function openRealtime(){
    leaveRealtime(false);
    const generation=connectionEpoch,epoch=roomEpoch,roomId=state?.room.id;
    const current=()=>generation===connectionEpoch&&epoch===roomEpoch&&roomId===state?.room.id&&!suspended;
    if(!roomId||window.navigator?.onLine===false)return;
    realtimeStatus='CONNECTING';
    // Includes SDK loading, auth and subscription. Epoch fences late completion.
    connectDeadline=setTimeout(()=>{if(current()){leaveRealtime(false);connectPromise=null;scheduleReconnect();}},12000);
    await ensureRealtimeSDK();if(!current())return;
    const auth=await ToolboxAuth.getSession();if(!current()||!auth?.access_token)return;
    const client=window.supabase.createClient(ToolboxAuth.url,ToolboxAuth.key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},realtime:{heartbeatCallback:status=>{
      if(!current())return;
      if(status==='ok'){serverHeartbeatAt=Date.now();transportFailed=false;if(realtimeStatus==='SUBSCRIBED'){clearTimeout(reconnectTimer);reconnectTimer=null;}}
      else if(['timeout','error','disconnected'].includes(status)){telemetry.noteRealtimeFailure();transportFailed=true;scheduleReconnect(750);}
    }}});
    realtime=client;realtimeToken=auth.access_token;await client.realtime.setAuth(auth.access_token);if(!current()){client.realtime.disconnect();return;}
    const nonce=state?.room?.realtime_token;
    const topic=nonce?`pictionary:${roomId}:${nonce}`:`pictionary:${roomId}`;
    const ch=client.channel(topic,{config:{private:true,presence:{key:auth.user.id},broadcast:{ack:false,self:false}}});
    channel=ch;
    const on=(event,fn)=>ch.on('broadcast',{event},({payload})=>{if(current())fn(payload);});
    // Room channel carries only control events; stroke authorization is per-round.
    on('sync_request',p=>{if(isDrawer()&&p?.round_id===currentRoundId)queueSnapshotBroadcast();});
    // A provisional guess stays local: broadcasting raw text before scoring can reveal an answer.
    on('guess_result',receiveGuessResult);on('state_sync',receiveStateSync);on('room_transition',receiveRoomTransition);on('state_changed',p=>{if(!p?.sync)requestState();});
    on('ping',handlePing);on('pong',handlePong);
    // The old channel never carries the replacement token; fetch authorized state.
    on('channel_rotated',()=>{leaveRealtime(false);requestState(0);});
    ch.on('presence',{event:'sync'},()=>{if(!current())return;presenceMembers=new Set(Object.values(ch.presenceState()).flat().map(x=>x.member_id));renderPlayers();});
    ch.subscribe(async status=>{
      if(!current())return;
      realtimeStatus=status;updateRealtimeStatus();
      if(status==='SUBSCRIBED'){
        clearTimeout(reconnectTimer);reconnectTimer=null;clearTimeout(connectDeadline);connectDeadline=null;serverHeartbeatAt=Date.now();transportFailed=false;
        lastPongAt=lastDrawerAt=0;subscribedAt=Date.now();requestState(0);syncDrawingChannel();requestCanvas();startPing();
        try{await ch.track({member_id:me.id,nickname:me.nickname,online_at:new Date().toISOString()});}catch{}
        if(!current())return;
        clearInterval(snapshotTimer);snapshotTimer=setInterval(()=>{if(isDrawer()&&canvasDirty)persistCanvasFallback();},2000);
      }else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)){
        telemetry.noteRealtimeFailure();lastPongAt=lastDrawerAt=0;transportFailed=true;checkHealth();scheduleReconnect(350);
      }
    });
  }
  // A different private topic is joined in every playing round; Supabase caches
  // authorization on subscription, so lobby/choosing permissions are not reused.
  function desiredDrawTopic(){
    if(!state||state.room.status!=='playing'||!state.round?.id||!state.room.realtime_token)return null;
    return `pictionary-draw:${state.room.id}:${state.round.id}:${state.room.realtime_token}`;
  }
  function stopDrawingChannel(){
    drawChannelEpoch++;
    clearTimeout(drawRetryTimer);drawRetryTimer=null;
    const old=drawChannel,client=realtime;
    drawChannel=null;drawTopic=null;drawStatus='CLOSED';drawInFlight=0;
    if(old&&client?.removeChannel)Promise.resolve(client.removeChannel(old)).catch(()=>{});
  }
  function scheduleDrawRetry(){
    if(drawRetryTimer||!state||suspended||document.hidden||window.navigator?.onLine===false)return;
    const epoch=roomEpoch,delay=300+Math.random()*Math.min(7000,350*2**Math.min(5,drawRetryAttempt++));
    drawRetryTimer=setTimeout(()=>{
      drawRetryTimer=null;
      if(epoch!==roomEpoch||!state)return;
      stopDrawingChannel();syncDrawingChannel();
    },delay);
  }
  function syncDrawingChannel(){
    const topic=desiredDrawTopic();
    if(!topic||!realtime||realtimeStatus!=='SUBSCRIBED'||suspended){
      if(drawChannel)stopDrawingChannel();
      return;
    }
    if(drawChannel&&drawTopic===topic&&['CONNECTING','SUBSCRIBED'].includes(drawStatus))return;
    stopDrawingChannel();
    const epoch=drawChannelEpoch,room=roomEpoch,round=currentRoundId;
    const client=realtime;
    const ch=client.channel(topic,{config:{private:true,broadcast:{ack:true,self:false}}});
    drawChannel=ch;drawTopic=topic;drawStatus='CONNECTING';
    const current=()=>epoch===drawChannelEpoch&&room===roomEpoch&&round===currentRoundId&&drawChannel===ch&&desiredDrawTopic()===topic&&!suspended;
    const on=(event,fn)=>ch.on('broadcast',{event},({payload})=>{if(current())fn(payload);});
    on('stroke',receiveStroke);on('snapshot',receiveSnapshot);
    on('clear',p=>receiveCanvasControl('clear',p));
    on('undo',p=>receiveCanvasControl('undo',p));
    ch.subscribe(status=>{
      if(!current())return;
      drawStatus=status;updateRealtimeStatus();
      if(status==='SUBSCRIBED'){
        drawRetryAttempt=0;
        clearTimeout(drawRetryTimer);drawRetryTimer=null;
        if(isDrawer()){
          if(canvasDirty)persistCanvasFallback();
        }else{
          canvasNeedsSync=true;
          requestCanvas(true);
          pullCanvasFallback(true);
        }
      }else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)){
        telemetry.noteRealtimeFailure();
        if(isDrawer())scheduleServerCanvasSave();
        else canvasNeedsSync=true;
        scheduleDrawRetry();
      }
    });
  }
  function sendDrawEvent(event,payload){
    if(!drawChannel||drawStatus!=='SUBSCRIBED'){
      if(isDrawer())scheduleServerCanvasSave();
      return Promise.resolve('not_connected');
    }
    const epoch=drawChannelEpoch,finish=telemetry.sendStart(event),ch=drawChannel;
    drawInFlight++;
    const done=status=>{
      finish(status);
      if(epoch!==drawChannelEpoch)return status;
      drawInFlight=Math.max(0,drawInFlight-1);
      if(status!=='ok'){
        telemetry.noteRealtimeFailure();
        if(isDrawer())persistCanvasFallback();
        scheduleDrawRetry();
      }
      return status;
    };
    try{return Promise.resolve(ch.send({type:'broadcast',event,payload}))
      .then(done).catch(()=>done('error'));}
    catch{return Promise.resolve(done('error'));}
  }
  function isRealtimeHealthy(){
    return realtimeStatus==='SUBSCRIBED'&&!transportFailed&&Date.now()-serverHeartbeatAt<65000&&window.navigator?.onLine!==false;
  }
  function isCanvasHealthy(){
    return isRealtimeHealthy()&&drawStatus==='SUBSCRIBED'&&!canvasNeedsSync;
  }
  function updateRealtimeStatus(){
    const healthy=isRealtimeHealthy();
    const canvasRecovering=healthy&&state?.room.status==='playing'&&!isCanvasHealthy();
    for(const id of ['connectionStatus','gameConnectionStatus']){
      const pill=$(id);if(!pill)continue;
      pill.textContent=!healthy?'连接恢复中':canvasRecovering?'实时在线 · 画布同步中':(Number.isFinite(realtimeRtt)?`实时在线 · ${Math.round(realtimeRtt)}ms`:'实时在线');
      pill.classList.toggle('online',healthy);
    }
  }
  function checkHealth(){
    if(!state||suspended||document.hidden||window.navigator?.onLine===false)return;
    const healthy=isRealtimeHealthy();setStatePoll(healthy?18000:1800);updateRealtimeStatus();
    if(state.room.status==='playing'&&!isDrawer())pullCanvasFallback(false);
    if(healthy&&state.room.status==='playing'&&drawStatus!=='SUBSCRIBED')syncDrawingChannel();
    if(healthy&&!isDrawer()&&state.room.status==='playing'&&Date.now()-lastDrawerAt>10000)requestCanvas();
    if(healthy&&Date.now()-subscribedAt>20000)reconnectAttempt=0;
    updatePerfDiagnostics();
    if(realtimeStatus==='SUBSCRIBED'&&!healthy)scheduleReconnect(750);
  }
  function startPing(){clearInterval(pingTimer);sendPing();pingTimer=setInterval(sendPing,2000);}
  function sendPing(){
    if(realtimeStatus!=='SUBSCRIBED'||!state||document.hidden)return;
    const sent=Date.now(),id=makeClientId();pendingPings.set(id,sent);
    for(const [key,at] of pendingPings)if(sent-at>10000)pendingPings.delete(key);
    sendEvent('ping',{ping_id:id,sender_member_id:me.id,round_id:currentRoundId});
  }
  function handlePing(p){
    if(!p?.ping_id||!p.sender_member_id||p.sender_member_id===me?.id)return;
    sendEvent('pong',{ping_id:p.ping_id,target_member_id:p.sender_member_id,responder_member_id:me.id,round_id:currentRoundId,canvas_revision:canvasRevision});
  }
  function handlePong(p){
    const sent=pendingPings.get(p?.ping_id);
    if(!sent||p.target_member_id!==me?.id||!state?.players.some(x=>x.member_id===p.responder_member_id))return;
    lastPongAt=Date.now();realtimeRtt=Math.max(0,lastPongAt-sent);telemetry.setPeerRtt(realtimeRtt);
    if(isDrawer()&&p.round_id===currentRoundId&&
       p.responder_member_id!==me.id&&Number.isSafeInteger(Number(p.canvas_revision))){
      lastPeerCanvasAckAt=Date.now();
      if(Number(p.canvas_revision)<canvasRevision&&drawStatus==='SUBSCRIBED'&&
         Date.now()-lastSnapshotBroadcastAt>5000)queueSnapshotBroadcast();
    }
    if(p.responder_member_id===state.room.current_drawer_member_id&&p.round_id===currentRoundId){
      lastDrawerAt=Date.now();
      if(Number(p.canvas_revision)>canvasRevision){canvasNeedsSync=true;requestCanvas();}
    }
    updateRealtimeStatus();
  }
  function scheduleReconnect(grace=0){
    if(reconnectTimer||document.hidden||suspended||!state||window.navigator?.onLine===false)return;
    const epoch=roomEpoch,delay=grace+100+Math.random()*Math.min(12000,350*2**Math.min(5,reconnectAttempt++));
    reconnectTimer=setTimeout(async()=>{reconnectTimer=null;if(epoch!==roomEpoch)return;try{await connectRealtime();}catch{scheduleReconnect();}},delay);
  }
  function leaveRealtime(stopTimers=true){
    stopDrawingChannel();drawRetryAttempt=0;
    connectionEpoch++;connectPromise=null;clearTimeout(connectDeadline);connectDeadline=null;serverHeartbeatAt=0;transportFailed=false;
    clearTimeout(reconnectTimer);reconnectTimer=null;clearInterval(snapshotTimer);clearInterval(pingTimer);
    snapshotTimer=pingTimer=null;
    clearTimeout(snapshotBroadcastTimer);snapshotBroadcastTimer=null;
    const old=realtime;channel=realtime=null;realtimeToken=null;realtimeStatus='CLOSED';lastPongAt=lastDrawerAt=0;realtimeRtt=null;pendingPings.clear();presenceMembers.clear();
    if(old){Promise.resolve(old.removeAllChannels()).finally(()=>old.realtime.disconnect()).catch(()=>{});}
    if(stopTimers){
      clearInterval(pollTimer);clearInterval(clockTimer);clearInterval(canvasSyncTimer);clearInterval(heartbeatTimer);clearTimeout(serverSaveTimer);clearTimeout(sendTimer);
      pollTimer=clockTimer=canvasSyncTimer=heartbeatTimer=serverSaveTimer=sendTimer=null;statePollMs=0;
    }
  }
  function sendEvent(event,payload){
    if(!channel||realtimeStatus!=='SUBSCRIBED')return Promise.resolve('not_connected');
    const epoch=connectionEpoch,finish=telemetry.sendStart(event);
    try{
      return Promise.resolve(channel.send({type:'broadcast',event,payload}))
        .then(status=>{
          finish(status);
          if(epoch===connectionEpoch&&status&&status!=='ok')scheduleReconnect();
          return status;
        })
        .catch(()=>{
          finish('error');
          if(epoch===connectionEpoch)scheduleReconnect();
          return 'error';
        });
    }catch{finish('error');scheduleReconnect();return Promise.resolve('error');}
  }
  function transitionLeaderId(){
    if(!state?.players?.length)return null;
    const ids=[state.room.current_drawer_member_id,state.room.host_member_id,...state.players.map(p=>p.member_id)].filter(Boolean);
    if(!presenceMembers.size)return ids[0]||null;
    return ids.find(id=>id===me?.id||presenceMembers.has(id))||ids[0]||null;
  }
  function attemptTransition(action){
    if(!state||busy||transitionBusy||Date.now()<transitionRetryAt||transitionLeaderId()!==me?.id)return;
    transitionRetryAt=Date.now()+1200;
    mutate(action).catch(()=>{});
  }
  function receiveStateSync(p){
    if(!state||!p||p.room_id!==state.room.id||!p.room)return;
    if(Number(p.room.state_revision||0)<Number(state.room.state_revision||0))return;
    const oldStatus=state.room.status,oldRound=currentRoundId,nextRound=p.round||null,roundChanged=(nextRound?.id||null)!==(state.round?.id||null);
    state.room={...state.room,...p.room};
    if(Array.isArray(p.players))state.players=p.players;
    if(roundChanged){
      state.round=nextRound;state.answer=null;state.options=null;state.guesses=[];state.solved_members=[];state.revealed_answer=null;
    }else if(nextRound)state.round={...(state.round||{}),...nextRound};
    else state.round=null;
    if(Object.prototype.hasOwnProperty.call(p,'revealed_answer'))state.revealed_answer=p.revealed_answer;
    if(Array.isArray(p.solved_members))state.solved_members=p.solved_members;
    applyScores(p.score_state);
    if(oldStatus!==state.room.status||oldRound!==(nextRound?.id||null))transitionRetryAt=0;
    renderState();
    syncDrawingChannel();
    if(state.room.status==='choosing'&&state.room.current_drawer_member_id===me?.id&&!state.options?.length)requestState(20);
  }
  function receiveRoomTransition(p){
    if(!state||!p?.room||p.room_id!==state.room.id)return;
    if(Number(p.room.state_revision||0)<Number(state.room.state_revision||0))return;
    const oldStatus=state.room.status;
    state.room={...state.room,...p.room};
    if(Object.prototype.hasOwnProperty.call(p,'revealed_answer')&&state.room.status==='summary')
      state.revealed_answer=p.revealed_answer;
    applyScores(p.score_state);
    if(oldStatus!==state.room.status)transitionRetryAt=0;
    renderState();syncDrawingChannel();
    // Lost authoritative events are still reconciled by periodic HTTP snapshots.
  }

  function renderState(){
    if(!state)return;
    if(['closed','abandoned'].includes(state.room.status)){exitToHome(state.room.status==='closed'?'房间已结束':'房间已过期');return;}
    $('roomCode').textContent=state.room.code;$('playerCount').textContent=`${state.players.length} / 8`;renderPlayers();renderScores();
    const host=state.room.host_member_id===me?.id;
    $('leaveBtn').textContent=host?'结束':'退出';
    const status=state.room.status;
    if(status==='lobby'){show('roomScreen');renderLobby();$('wordModal').classList.add('hidden');}
    else if(status==='finished'){show('finishScreen');renderRanking();$('wordModal').classList.add('hidden');}
    else{show('gameScreen');renderGame();requestAnimationFrame(()=>resizeCanvas());}
  }
  function renderPlayers(){if(!state)return;const host=state.room.host_member_id;$('players').innerHTML=state.players.map(p=>`<div class="player"><span class="avatar" style="background:${/^#[0-9a-f]{6}$/i.test(p.color)?p.color:'#8EC5FF'}">${escapeHTML(p.nickname.slice(0,1))}</span><b>${escapeHTML(p.nickname)}${p.member_id===host?' 👑':''}</b><small>${presenceMembers.has(p.member_id)?'🟢 在线':'⚪'} · ${p.ready?'已准备':'未准备'}</small></div>`).join('');}
  function renderLobby(){const mine=state.players.find(p=>p.member_id===me.id);const host=state.room.host_member_id===me.id;$('readyBtn').classList.toggle('hidden',host);$('startBtn').classList.toggle('hidden',!host);$('readyBtn').textContent=mine?.ready?'取消准备':'我准备好了';const ready=state.players.filter(p=>p.ready||p.member_id===state.room.host_member_id).length;$('lobbyHint').textContent=host?`已有 ${ready}/${state.players.length} 人准备，至少 2 人且全员准备后可开始。`:'准备好后，等待房主开始。';$('startBtn').disabled=state.players.length<2||ready!==state.players.length;}
  function renderScores(){$('scoreStrip').innerHTML=state.players.slice().sort((a,b)=>b.score-a.score).map(p=>`<span class="score-chip">${escapeHTML(p.nickname)}<b>${escapeHTML(p.score)}</b></span>`).join('');}
  function renderRanking(){const sorted=state.players.slice().sort((a,b)=>b.score-a.score);$('ranking').innerHTML=sorted.map((p,i)=>`<div class="rank-row"><span class="place">${['🥇','🥈','🥉'][i]||`${i+1}.`}</span><span class="avatar" style="background:${/^#[0-9a-f]{6}$/i.test(p.color)?p.color:'#8EC5FF'}">${escapeHTML(p.nickname.slice(0,1))}</span><b>${escapeHTML(p.nickname)}</b><strong>${escapeHTML(p.score)}</strong></div>`).join('');$('againBtn').classList.toggle('hidden',state.room.host_member_id!==me.id);}
  function renderGame(){
    const r=state.round,choosing=state.room.status==='choosing';$('roundLabel').textContent=`第 ${state.room.round_no} / ${state.room.total_rounds} 轮`;$('drawerLabel').textContent=r?(choosing?`${r.drawer_nickname} 正在选题`:`${r.drawer_nickname} 正在画`):'等待画手选词';
    if(r?.id!==currentRoundId){switchRound(r?.id||null);}
    const mineDrawer=isDrawer();$('drawTools').classList.toggle('hidden',!mineDrawer||state.room.status!=='playing');
    $('guessPanel').classList.toggle('hidden',false);const guessed=hasGuessed(me?.id);
    const canGuess=state.room.status==='playing'&&!mineDrawer&&!guessed;$('guessInput').disabled=!canGuess;$('guessForm').querySelector('button').disabled=!canGuess;$('guessInput').placeholder=mineDrawer?'你是画手，不能猜词':guessed?'你已经猜中了':'输入你的答案…';
    $('wordLabel').textContent=choosing?'等待画手选题':mineDrawer&&state.answer?`题目：${state.answer}`:r&&r.char_count?`${r.char_count} 个字 · ${stars(r.difficulty)}`:'等待画手选题';
    renderGuessFeed();
    if(state.room.status==='choosing'){$('canvasCover').classList.remove('hidden');$('coverText').textContent=mineDrawer?'请选择本轮题目':'画手正在选题…';if(mineDrawer&&state.options?.length)showWordOptions();else $('wordModal').classList.add('hidden');}
    else if(state.room.status==='summary'){$('canvasCover').classList.remove('hidden');$('coverText').textContent=`本轮答案：${state.revealed_answer||'—'}`;$('wordModal').classList.add('hidden');}
    else{$('canvasCover').classList.add('hidden');$('wordModal').classList.add('hidden');}
    tick();
  }
  function stars(n){return '⭐'.repeat(Math.max(1,Math.min(3,Number(n)||1)));}
  function showWordOptions(){$('wordOptions').innerHTML=state.options.map(o=>`<button class="option" data-option="${escapeHTML(o.id)}"><b>${escapeHTML(o.word)}</b><small>${escapeHTML(o.category)} · ${stars(o.difficulty)}</small></button>`).join('');$('wordModal').classList.remove('hidden');}
  function isDrawer(){return !!state&&state.room.current_drawer_member_id===me?.id;}
  function hasGuessed(memberId){
    return !!memberId&&(
      (state?.solved_members||[]).includes(memberId)||(state?.guesses||[]).some(g=>g.member_id===memberId&&g.is_correct)
      || [...liveGuesses.values()].some(g=>g.round_id===currentRoundId&&g.member_id===memberId&&g.is_correct)
    );
  }
  function renderGuessFeed(){
    const authoritative=state?.guesses||[];
    const clientIds=new Set(authoritative.map(g=>g.client_id).filter(Boolean));
    for(const [id,g] of liveGuesses){if(clientIds.has(id))liveGuesses.delete(id);}
    const live=[...liveGuesses.values()].filter(g=>g.round_id===currentRoundId);
    const rows=[
      ...authoritative.map(g=>({...g,pending:false,sort_at:new Date(g.created_at||0).getTime()})),
      ...live.map(g=>({...g,sort_at:new Date(g.created_at||Date.now()).getTime()}))
    ].sort((a,b)=>a.sort_at-b.sort_at);
    $('guessFeed').innerHTML=rows.map(g=>`<p class="${g.is_correct?'correct':''}${g.pending?' pending':''}"><b>${escapeHTML(g.nickname||'好友')}</b>：${g.is_correct?'猜中了！':escapeHTML(g.text||'')}${g.pending?'<span class="pending-dot"> ···</span>':g.failed?`<button class="retry-guess" data-retry="${escapeHTML(g.client_id)}">尚未确认 · 重试</button>`:''}</p>`).join('')||'<p class="system">画面就绪，开始猜吧。</p>';
    $('guessFeed').scrollTop=$('guessFeed').scrollHeight;
  }
  function receiveGuessResult(p){
    if(!state||!p||p.round_id!==currentRoundId||!p.client_id)return;
    const prev=liveGuesses.get(p.client_id)||{};
    liveGuesses.set(p.client_id,{...prev,client_id:p.client_id,guess_id:p.guess_id,round_id:p.round_id,
      member_id:p.member_id,nickname:p.nickname||prev.nickname||'好友',text:p.correct?'':String(p.text||prev.text||''),
      is_correct:!!p.correct,score_awarded:Number(p.points)||0,created_at:p.created_at||prev.created_at||new Date().toISOString(),pending:false,failed:false});
    applyScores(p.score_state);renderScores();renderGuessFeed();
    if(p.member_id===me?.id&&p.correct)renderGame();
    if(p.correct&&p.round_complete){
      const epoch=roomEpoch,roundId=currentRoundId;
      setTimeout(()=>{if(epoch===roomEpoch&&roundId===currentRoundId&&state?.room?.status==='playing')
        requestState(0);},1500);
    }
  }

  function tick(){
    if(!state)return;let remaining=60;
    if(state.room.status==='playing'&&state.room.ends_at)remaining=Math.max(0,Math.ceil((new Date(state.room.ends_at).getTime()-Date.now())/1000));
    else if(state.room.status==='summary')remaining=Math.max(0,Math.ceil((new Date(state.room.summary_until).getTime()-Date.now())/1000));
    $('timer').textContent=remaining;$('timer').classList.toggle('urgent',remaining<=10);$('timer').classList.toggle('critical',remaining<=5);
    if(state.room.status==='playing'){
      if(remaining<=30&&!state.round?.hint&&!hintRequested){hintRequested=true;requestState(0);}
      if(remaining<=30&&state.round?.hint){$('hintBar').textContent=`范围提示：${state.round.hint}`;$('hintBar').classList.add('revealed');}
      else{$('hintBar').textContent='范围提示将在剩余 30 秒时出现';$('hintBar').classList.remove('revealed');}
      if(remaining<=0)attemptTransition('finish_round');
    }else if(state.room.status==='summary'){
      $('hintBar').textContent=`正确答案：${state.revealed_answer||'—'}`;$('hintBar').classList.add('revealed');
      if(remaining<=0)attemptTransition('next_round');
    }else{$('hintBar').textContent='画手选词后开始 60 秒倒计时';$('hintBar').classList.remove('revealed');}
  }
  async function submitGuess(e){
    e.preventDefault();const input=$('guessInput'),text=input.value.trim();
    if(!text||!state||state.room.status!=='playing'||isDrawer()||hasGuessed(me?.id))return;
    if(guessRequests.size>=4){toast('消息正在确认，稍等一下');return;}
    const item={client_id:makeClientId(),room_id:state.room.id,round_id:currentRoundId,member_id:me.id,nickname:me.nickname,text,is_correct:false,created_at:new Date().toISOString()};
    input.value='';await deliverGuess(item);
  }
  async function deliverGuess(item){
    if(!state||item.room_id!==state.room.id||item.round_id!==currentRoundId||guessRequests.has(item.client_id)||guessRequests.size>=4)return;
    const epoch=roomEpoch,id=item.client_id;
    liveGuesses.set(id,{...item,pending:true,failed:false});renderGuessFeed();
    // Do not broadcast unverified text: a correct guess would disclose the answer.
    const request=api('guess',{room_id:item.room_id,round_id:item.round_id,text:item.text,client_id:id});guessRequests.set(id,request);
    try{
      const data=await request;
      if(epoch!==roomEpoch||item.round_id!==currentRoundId)return;
      if(data.client_id!==id)liveGuesses.delete(id);
      receiveGuessResult({...data,round_id:item.round_id,member_id:me.id,nickname:me.nickname,text:item.text});
      if(data.correct&&!appliedGuessResults.has(data.guess_id||id)){
        appliedGuessResults.add(data.guess_id||id);toast(data.already_correct?'你已经猜中了':`猜对了！+${data.points} 分`);
      }
    }catch(err){
      if(epoch!==roomEpoch||item.round_id!==currentRoundId||err.cancelled)return;
      const current=liveGuesses.get(id);
      const confirmed=state.guesses?.some(g=>g.client_id===id)||current?.guess_id;
      if(!confirmed){
        if(err.retryable)liveGuesses.set(id,{...item,pending:false,failed:true});
        else liveGuesses.delete(id);
        renderGuessFeed();toast(err.message);requestState();
      }
    }finally{if(guessRequests.get(id)===request)guessRequests.delete(id);}
  }

  async function shareRoom(){const url=new URL('../pictionary/',location.href);url.searchParams.set('room',state.room.code);const text=`来玩你画我猜！房间码 ${state.room.code}\n${url.href}`;try{if(navigator.share)await navigator.share({title:'你画我猜好友房',text,url:url.href});else{await navigator.clipboard.writeText(text);toast('邀请链接已复制');}}catch(err){if(err.name!=='AbortError')toast('复制失败，请手动分享房间码');}}

  function resizeCanvas(){
    const rect=canvas.getBoundingClientRect();
    if(!rect.width||!rect.height)return false;
    const dpr=Math.min(2,window.devicePixelRatio||1);
    const width=Math.round(rect.width*dpr),height=Math.round(rect.height*dpr);
    if(canvas.width===width&&canvas.height===height)return false;
    logical={w:rect.width,h:rect.height};
    canvas.width=width;canvas.height=height;
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.lineCap='round';ctx.lineJoin='round';
    redraw();return true;
  }
  function point(e){const r=canvas.getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))];}
  function pointerDown(e){if(!isDrawer()||state.room.status!=='playing'||activeStroke)return;e.preventDefault();canvas.setPointerCapture(e.pointerId);const p=point(e);activeStroke={id:makeClientId(),color:erasing?'#ffffff':selectedColor,size:brushSize,points:[p]};sendPoints=[p];drawDot(activeStroke,p);flushStroke(false);scheduleServerCanvasSave();}
  function pointerMove(e){
    if(!activeStroke)return;const finish=Math.random()<.1?telemetry.begin('canvas.pointer_move'):()=>{};e.preventDefault();
    const events=typeof e.getCoalescedEvents==='function'?(e.getCoalescedEvents()||[]):[];
    const samples=events.length?events:[e];let changed=false;
    for(const ev of samples){
      const p=point(ev),last=activeStroke.points.at(-1);
      if(Math.hypot((p[0]-last[0])*logical.w,(p[1]-last[1])*logical.h)<1.5)continue;
      activeStroke.points.push(p);sendPoints.push(p);drawSegment(activeStroke,last,p);changed=true;
    }
    if(changed){if(sendPoints.length>=telemetry.profile().maxPoints)flushStroke(false);else scheduleSend();scheduleServerCanvasSave();}
    finish();
  }
  function pointerUp(e){
    if(!activeStroke)return;e.preventDefault();flushStroke(true);strokes.push(activeStroke);activeStroke=null;sendPoints=[];saveCanvas();
    if(isCanvasHealthy())scheduleServerCanvasSave();else persistCanvasFallback();
  }
  function encodePoints(points){return points.map(p=>[Math.round(p[0]*4095),Math.round(p[1]*4095)]);}
  function decodePoints(points,q){return q===1?points.map(p=>[Number(p[0])/4095,Number(p[1])/4095]):points;}
  function scheduleSend(){if(sendTimer)return;sendTimer=setTimeout(()=>flushStroke(false),telemetry.profile().strokeMs);}
  function nextCanvasRevision(){const base=canvasRevision;canvasRevision=Math.max(canvasRevision+1,Date.now()*1000);canvasDirty=true;return base;}
  function flushStroke(done){
    clearTimeout(sendTimer);sendTimer=null;
    if(!activeStroke||(!done&&sendPoints.length<1))return;
    const maxPoints=telemetry.profile().maxPoints;
    // A short completed stroke is sent as a replacement for gap-free final rendering.
    // Long strokes are chunked without dropping or reordering revisions.
    const replace=done&&activeStroke.points.length<=600;
    const chunks=[];
    if(replace)chunks.push(activeStroke.points);
    else{
      for(let i=0;i<sendPoints.length;i+=maxPoints)chunks.push(sendPoints.slice(i,i+maxPoints));
      if(done&&!chunks.length)chunks.push([]);
    }
    for(let i=0;i<chunks.length;i++){
      const base=nextCanvasRevision(),last=i===chunks.length-1;
      sendDrawEvent('stroke',{
        round_id:currentRoundId,revision:canvasRevision,base_revision:base,
        id:activeStroke.id,color:activeStroke.color,size:activeStroke.size,q:1,
        points:encodePoints(chunks[i]),done:done&&last,replace:replace&&last
      });
    }
    sendPoints=[];
  }
  function applyCanvasDelta(kind,p){
    lastDrawerAt=Date.now();
    canvasRevision=p.revision;canvasNeedsSync=false;
    if(kind==='stroke'){
      const incoming=decodePoints(p.points,p.q);let s=strokes.find(x=>x.id===p.id);
      if(p.replace){
        const next={id:p.id,color:p.color||'#111827',size:Number(p.size)||7,points:incoming};
        if(s)Object.assign(s,next);else strokes.push(next);
        redraw();return;
      }
      if(!s){s={id:p.id,color:p.color||'#111827',size:Number(p.size)||7,points:[]};strokes.push(s);}
      for(const pt of incoming){
        const last=s.points.at(-1);
        if(!last||last[0]!==pt[0]||last[1]!==pt[1]){
          s.points.push(pt);if(last)drawSegment(s,last,pt);else drawDot(s,pt);
        }
      }
    }else{
      if(kind==='clear')strokes=[];
      else strokes=strokes.filter(s=>s.id!==p.id);
      activeStroke=null;snapshotAssemblies.clear();redraw();
    }
  }
  function drainCanvasDeltas(){
    while(pendingCanvasDeltas.has(canvasRevision)){
      const item=pendingCanvasDeltas.get(canvasRevision);
      pendingCanvasDeltas.delete(canvasRevision);
      if(item.p.revision<=canvasRevision)continue;
      applyCanvasDelta(item.kind,item.p);
    }
    for(const [base] of pendingCanvasDeltas)if(base<canvasRevision)pendingCanvasDeltas.delete(base);
    if(!pendingCanvasDeltas.size){clearTimeout(canvasGapTimer);canvasGapTimer=null;}
  }
  function queueCanvasDelta(kind,p){
    if(!p||p.round_id!==currentRoundId||isDrawer()||
       !Number.isSafeInteger(p.revision)||!Number.isSafeInteger(p.base_revision)||
       p.revision<=canvasRevision||p.base_revision<canvasRevision||p.revision<=p.base_revision)return;
    if(kind==='stroke'&&(!p.id||!Array.isArray(p.points)))return;
    if(p.base_revision>canvasRevision){
      if(pendingCanvasDeltas.size>=32&&!pendingCanvasDeltas.has(p.base_revision)){
        pendingCanvasDeltas.clear();clearTimeout(canvasGapTimer);canvasGapTimer=null;
        canvasNeedsSync=true;requestCanvas(true);return;
      }
      pendingCanvasDeltas.set(p.base_revision,{kind,p});
      if(!canvasGapTimer)canvasGapTimer=setTimeout(()=>{
        canvasGapTimer=null;
        if(!pendingCanvasDeltas.size)return;
        pendingCanvasDeltas.clear();canvasNeedsSync=true;
        requestCanvas(true);pullCanvasFallback(false);
      },CANVAS_REORDER_WAIT_MS);
      return;
    }
    applyCanvasDelta(kind,p);drainCanvasDeltas();
  }
  function receiveStroke(p){queueCanvasDelta('stroke',p);}
  function receiveCanvasControl(event,p){
    if(event==='clear'||event==='undo')queueCanvasDelta(event,p);
  }

  function drawDot(s,p){ctx.fillStyle=s.color;ctx.beginPath();ctx.arc(p[0]*logical.w,p[1]*logical.h,s.size/2,0,Math.PI*2);ctx.fill();}
  function drawSegment(s,a,b){ctx.strokeStyle=s.color;ctx.lineWidth=s.size;ctx.beginPath();ctx.moveTo(a[0]*logical.w,a[1]*logical.h);ctx.lineTo(b[0]*logical.w,b[1]*logical.h);ctx.stroke();}
  function redraw(){if(!logical.w)return;const finish=telemetry.begin('canvas.redraw');try{ctx.clearRect(0,0,logical.w,logical.h);ctx.fillStyle='#fff';ctx.fillRect(0,0,logical.w,logical.h);for(const s of strokes){if(s.points.length===1)drawDot(s,s.points[0]);for(let i=1;i<s.points.length;i++)drawSegment(s,s.points[i-1],s.points[i]);}if(activeStroke){if(activeStroke.points.length===1)drawDot(activeStroke,activeStroke.points[0]);for(let i=1;i<activeStroke.points.length;i++)drawSegment(activeStroke,activeStroke.points[i-1],activeStroke.points[i]);}}finally{finish();}}
  function undoStroke(){if(!isDrawer()||!strokes.length)return;if(activeStroke)pointerUp({preventDefault(){}});const s=strokes.pop(),base=nextCanvasRevision();redraw();saveCanvas();sendDrawEvent('undo',{round_id:currentRoundId,id:s.id,base_revision:base,revision:canvasRevision});persistCanvasFallback();}
  function bindHoldClear(){
    let t=null;const b=$('clearBtn');
    const cancel=()=>{clearTimeout(t);t=null;b.classList.remove('holding');};
    b.addEventListener('pointerdown',e=>{if(!isDrawer())return;e.preventDefault();b.classList.add('holding');t=setTimeout(()=>{strokes=[];activeStroke=null;sendPoints=[];const base=nextCanvasRevision();redraw();saveCanvas();sendDrawEvent('clear',{round_id:currentRoundId,revision:canvasRevision,base_revision:base});persistCanvasFallback();toast('画布已清空');cancel();},480);});
    ['pointerup','pointercancel','pointerleave'].forEach(x=>b.addEventListener(x,cancel));
  }
  function storageKey(){return currentRoundId?`pictionary.canvas.${currentRoundId}`:'';}
  function saveCanvas(){try{if(storageKey())sessionStorage.setItem(storageKey(),JSON.stringify({revision:canvasRevision,strokes}));}catch{}}
  function switchRound(id){
    clearTimeout(sendTimer);clearTimeout(serverSaveTimer);sendTimer=serverSaveTimer=null;
    currentRoundId=id;strokes=[];activeStroke=null;sendPoints=[];snapshotAssemblies.clear();lastCanvasVersion=0;
    pendingCanvasDeltas.clear();clearTimeout(canvasGapTimer);canvasGapTimer=null;
    clearTimeout(snapshotBroadcastTimer);snapshotBroadcastTimer=null;lastSnapshotBroadcastAt=0;
    canvasRevision=0;canvasDirty=false;canvasNeedsSync=!!id;lastDrawerAt=0;lastCanvasCheck=lastSnapshotRequest=0;hintRequested=false;
    liveGuesses.clear();appliedGuessResults.clear();guessRequests.clear();
    if(id&&isDrawer()){
      try{const saved=JSON.parse(sessionStorage.getItem(storageKey())||'null');if(saved&&!Array.isArray(saved)){strokes=saved.strokes||[];canvasRevision=Number(saved.revision)||0;}}catch{}
      canvasNeedsSync=false;
    }
    redraw();if(id){requestCanvas();pullCanvasFallback(true);}
  }
  function requestCanvas(urgent=false){
    if(!currentRoundId||isDrawer()||!channel||realtimeStatus!=='SUBSCRIBED')return;
    const now=Date.now(),minInterval=urgent?Math.max(700,Math.round(telemetry.profile().snapshotMs/3)):telemetry.profile().snapshotMs;
    if(now-lastSnapshotRequest<minInterval)return;
    lastSnapshotRequest=now;
    sendEvent('sync_request',{member_id:me.id,round_id:currentRoundId});
  }
  function queueSnapshotBroadcast(){
    if(!currentRoundId||!isDrawer()||snapshotBroadcastTimer)return;
    // A single full-room snapshot answers all concurrent viewers' requests.
    const delay=Math.max(70,SNAPSHOT_COALESCE_MS-(Date.now()-lastSnapshotBroadcastAt));
    snapshotBroadcastTimer=setTimeout(()=>{
      snapshotBroadcastTimer=null;sendSnapshot();
    },delay);
  }
  function sendSnapshot(){
    if(!currentRoundId||!isDrawer()||drawStatus!=='SUBSCRIBED')return;
    if(activeStroke&&sendPoints.length)flushStroke(false);
    const text=JSON.stringify(canvasPayload()),size=12000,total=Math.max(1,Math.ceil(text.length/size));
    if(total>100){console.warn('画布快照过大，将使用数据库恢复');return;}
    lastSnapshotBroadcastAt=Date.now();
    const id=makeClientId(),roundId=currentRoundId,revision=canvasRevision,epoch=connectionEpoch;
    for(let i=0;i<total;i++){
      setTimeout(()=>{if(epoch===connectionEpoch&&roundId===currentRoundId)sendDrawEvent('snapshot',{snapshot_id:id,round_id:roundId,revision,index:i,total,part:text.slice(i*size,(i+1)*size)});},i*telemetry.profile().chunkGapMs);
    }
  }
  function applyCanvasSnapshot(roundId,revision,next){
    if(roundId!==currentRoundId||!Number.isSafeInteger(revision)||revision<canvasRevision||!Array.isArray(next))return false;
    // Equal versions never replace already-applied drawing operations.
    if(revision===canvasRevision&&!canvasNeedsSync)return false;
    if(isDrawer()&&(activeStroke||canvasDirty))return false;
    canvasRevision=revision;strokes=next;activeStroke=null;canvasNeedsSync=false;
    pendingCanvasDeltas.clear();clearTimeout(canvasGapTimer);canvasGapTimer=null;
    redraw();return true;
  }
  function receiveSnapshot(p){
    if(!p||p.round_id!==currentRoundId||isDrawer()||!p.snapshot_id||!Number.isSafeInteger(p.revision)||p.revision<canvasRevision)return;
    if(!Number.isInteger(p.total)||p.total<1||p.total>100||!Number.isInteger(p.index)||p.index<0||p.index>=p.total||typeof p.part!=='string'||p.part.length>12000)return;
    lastDrawerAt=Date.now();
    for(const [id,v] of snapshotAssemblies)if(Date.now()-v.created>5000)snapshotAssemblies.delete(id);
    let entry=snapshotAssemblies.get(p.snapshot_id);
    if(!entry){if(snapshotAssemblies.size>=4)snapshotAssemblies.delete(snapshotAssemblies.keys().next().value);entry={total:p.total,revision:p.revision,chunks:new Map(),created:Date.now()};snapshotAssemblies.set(p.snapshot_id,entry);}
    if(entry.total!==p.total||entry.revision!==p.revision)return;
    entry.chunks.set(p.index,p.part);if(entry.chunks.size!==entry.total)return;
    const text=Array.from({length:entry.total},(_,i)=>entry.chunks.get(i)).join('');snapshotAssemblies.delete(p.snapshot_id);
    try{applyCanvasSnapshot(p.round_id,p.revision,JSON.parse(text));}catch{canvasNeedsSync=true;}
  }
  function canvasPayload(){
    const all=activeStroke?[...strokes,activeStroke]:strokes;
    return all.map(s=>({id:s.id,color:s.color,size:s.size,points:s.points}));
  }
  function scheduleServerCanvasSave(){
    if(serverSaveTimer||!isDrawer()||state?.room?.status!=='playing'||!currentRoundId)return;
    serverSaveTimer=setTimeout(()=>{serverSaveTimer=null;persistCanvasFallback();},isCanvasHealthy()?Math.max(1800,telemetry.profile().strokeMs*55):900);
  }
  async function persistCanvasFallback(){
    clearTimeout(serverSaveTimer);serverSaveTimer=null;
    if(window.navigator?.onLine===false||!isDrawer()||state?.room?.status!=='playing'||!currentRoundId)return;
    if(canvasSaveBusy){canvasSaveQueued=true;return;}
    if(activeStroke&&sendPoints.length)flushStroke(false);
    if(!canvasDirty)return;
    canvasSaveBusy=true;
    const epoch=roomEpoch,roundId=currentRoundId,revision=canvasRevision,roomId=state.room.id;
    try{
      const data=await api('save_canvas',{room_id:roomId,round_id:roundId,revision,strokes:canvasPayload()});
      if(epoch===roomEpoch&&roundId===currentRoundId){
        lastCanvasVersion=Math.max(lastCanvasVersion,Number(data.version)||0);
        if(canvasRevision===revision)canvasDirty=false;
        if(data.accepted===false){canvasDirty=false;canvasNeedsSync=true;pullCanvasFallback(true);}
      }
    }catch(err){if(!err.cancelled)console.warn('画布保存尚未确认');}
    finally{canvasSaveBusy=false;if(canvasSaveQueued||canvasDirty){canvasSaveQueued=false;scheduleServerCanvasSave();}}
  }
  async function pullCanvasFallback(force=false){
    if(window.navigator?.onLine===false||canvasFetchBusy||!state||!currentRoundId||state.room.status!=='playing'||document.hidden||suspended)return;
    if(isDrawer()&&(activeStroke||canvasDirty))return;
    const now=Date.now();
    // Cheap version-only server check also detects silent loss of the entire stream.
    if(!force&&!canvasNeedsSync&&now-lastCanvasCheck<Math.max(6500,telemetry.profile().recoveryMs))return;
    if(now-lastCanvasCheck<(force?Math.max(700,Math.round(telemetry.profile().snapshotMs/3)):(isRealtimeHealthy()?Math.max(6500,telemetry.profile().recoveryMs):Math.max(1500,telemetry.profile().snapshotMs))))return;
    lastCanvasCheck=now;canvasFetchBusy=true;
    const epoch=roomEpoch,roundId=currentRoundId,roomId=state.room.id;
    try{
      const data=await api('canvas',{room_id:roomId,round_id:roundId,known_version:canvasRevision});
      if(epoch!==roomEpoch||roundId!==currentRoundId)return;
      const version=Number(data.version)||0;
      if(Array.isArray(data.strokes))applyCanvasSnapshot(roundId,version,data.strokes);
      if(data.unchanged&&version<=canvasRevision)canvasNeedsSync=false;
      lastCanvasVersion=Math.max(lastCanvasVersion,version);
    }catch(err){if(!err.cancelled)console.warn('画布同步尚未确认');}
    finally{canvasFetchBusy=false;}
  }


  boot();
})();
