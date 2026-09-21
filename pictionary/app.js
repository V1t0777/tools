(() => {
  'use strict';
  const FUNCTION_URL = `${ToolboxAuth.url}/functions/v1/pictionary-game`;
  const COLORS = ['#111827','#ef4444','#f59e0b','#22c55e','#3b82f6','#8b5cf6','#ec4899','#ffffff'];
  const $ = id => document.getElementById(id);
  const screens = ['authScreen','homeScreen','roomScreen','gameScreen','finishScreen'];
  let session=null, me=null, state=null, stateGeneration=0, channel=null, realtime=null, pollTimer=null, clockTimer=null, statePollMs=0;
  let currentRoundId=null, strokes=[], activeStroke=null, sendPoints=[], sendTimer=null, selectedColor=COLORS[0], brushSize=7, erasing=false;
  let canvas=$('canvas'), ctx=canvas.getContext('2d'), logical={w:1,h:1}, busy=false, transitionBusy=false, presenceMembers=new Set();
  let realtimeStatus='CLOSED', reconnectTimer=null, snapshotTimer=null, snapshotAssemblies=new Map();
  let canvasSyncTimer=null, serverSaveTimer=null, canvasFetchBusy=false, canvasSaveBusy=false, canvasSaveQueued=false, lastCanvasVersion=0;
  let pingTimer=null, lastPongAt=0, realtimeRtt=null, pingSeq=0;
  let liveGuesses=new Map(), appliedGuessResults=new Set(), guessRequests=new Map();

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

  async function api(action,payload={}){
    session=await ToolboxAuth.getSession();
    if(!session) throw new Error('请先登录');
    const r=await fetch(FUNCTION_URL,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json','apikey':ToolboxAuth.key,'Authorization':`Bearer ${session.access_token}`},body:JSON.stringify({action,...payload})});
    const data=await r.json().catch(()=>({}));
    if(!r.ok||data.error) throw new Error(data.error||`请求失败（${r.status}）`);
    return data;
  }

  async function boot(){
    buildTools(); bind(); resizeCanvas();
    try{ session=await ToolboxAuth.getSession(); }catch{}
    if(!session){show('authScreen');return;}
    try{
      const data=await api('me'); me=data.member; $('welcomeName').textContent=me.nickname; show('homeScreen');
      const code=codeFromURL(); if(code){$('roomCodeInput').value=code; await joinRoom(code,true);}
    }catch(err){ await ToolboxAuth.signOut(); show('authScreen'); $('loginError').textContent=err.message; }
  }

  function bind(){
    $('loginForm').addEventListener('submit',async e=>{e.preventDefault();$('loginError').textContent='';try{const out=await ToolboxAuth.signIn($('emailInput').value.trim(),$('passwordInput').value);session=out;const data=await api('me');me=data.member;$('welcomeName').textContent=me.nickname;show('homeScreen');const code=codeFromURL();if(code)await joinRoom(code,true);}catch(err){$('loginError').textContent=ToolboxAuth.authMessage(err);}});
    $('signOutBtn').onclick=async()=>{leaveRealtime();await ToolboxAuth.signOut();session=me=state=null;setURL('');$('shareBtn').classList.add('hidden');$('leaveBtn').classList.add('hidden');show('authScreen');};
    $('createBtn').onclick=async()=>{try{const data=await api('create_room');await enterRoom(data.state);}catch(err){toast(err.message);}};
    $('joinForm').addEventListener('submit',async e=>{e.preventDefault();await joinRoom($('roomCodeInput').value);});
    $('shareBtn').onclick=shareRoom;
    $('leaveBtn').onclick=leaveRoom;
    $('readyBtn').onclick=async()=>mutate('toggle_ready');
    $('startBtn').onclick=async()=>mutate('start_game');
    $('guessForm').addEventListener('submit',submitGuess);
    $('againBtn').onclick=async()=>mutate('play_again');
    $('wordOptions').addEventListener('click',async e=>{const b=e.target.closest('[data-option]');if(!b||busy)return;const modal=$('wordModal');b.disabled=true;modal.classList.add('hidden');$('canvasCover').classList.remove('hidden');$('coverText').textContent='正在开始本轮…';try{await mutate('choose_word',{option_id:b.dataset.option});}catch(err){b.disabled=false;modal.classList.remove('hidden');toast(err.message);}});
    $('colors').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;selectedColor=b.dataset.color;erasing=false;document.querySelectorAll('#colors button').forEach(x=>x.classList.toggle('active',x===b));$('eraserBtn').classList.remove('active');});
    document.querySelector('.brushes').addEventListener('click',e=>{const b=e.target.closest('[data-size]');if(!b)return;brushSize=Number(b.dataset.size);document.querySelectorAll('[data-size]').forEach(x=>x.classList.toggle('active',x===b));});
    $('eraserBtn').onclick=()=>{erasing=!erasing;$('eraserBtn').classList.toggle('active',erasing);};
    $('undoBtn').onclick=undoStroke; bindHoldClear();
    canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointermove',pointerMove);canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('pointercancel',pointerUp);
    window.addEventListener('resize',()=>{resizeCanvas();redraw();});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state){refreshState();if(realtimeStatus!=='SUBSCRIBED')scheduleReconnect();}});
    window.addEventListener('pagehide',leaveRealtime);
  }

  function buildTools(){
    $('colors').innerHTML=COLORS.map((c,i)=>`<button aria-label="颜色" data-color="${c}" class="${i===0?'active':''}" style="background:${c}"></button>`).join('');
  }

  async function joinRoom(raw,silent=false){
    const code=String(raw||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);
    if(code.length!==6){if(!silent)toast('请输入 6 位房间码');return;}
    try{const data=await api('join_room',{code});await enterRoom(data.state);}catch(err){toast(err.message);if(silent)setURL('');}
  }
  async function enterRoom(next){
    stateGeneration++;state=next;setURL(state.room.code);$('shareBtn').classList.remove('hidden');$('leaveBtn').classList.remove('hidden');
    await connectRealtime();renderState();
    setStatePoll(5000);
    clearInterval(clockTimer);clockTimer=setInterval(tick,250);
    clearInterval(canvasSyncTimer);canvasSyncTimer=setInterval(pullCanvasFallback,650);
  }
  function setStatePoll(ms){
    if(pollTimer&&statePollMs===ms)return;
    clearInterval(pollTimer);statePollMs=ms;
    pollTimer=setInterval(refreshState,ms);
  }
  async function mutate(action,payload={}){if(busy)return;busy=true;const generation=++stateGeneration;try{const data=await api(action,{room_id:state.room.id,...payload});if(data.state&&generation===stateGeneration){state=data.state;renderState();sendEvent('state_changed',{at:Date.now()});}return data;}finally{busy=false;}}
  function exitToHome(message=''){
    leaveRealtime();state=null;currentRoundId=null;strokes=[];activeStroke=null;setURL('');
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
    if(!state||busy||transitionBusy)return;
    const generation=stateGeneration;transitionBusy=true;
    try{
      const data=await api('state',{room_id:state.room.id});
      if(generation!==stateGeneration)return;state=data.state;renderState();
    }catch(err){
      if(/不在房间|房间不存在|房间已由房主结束|房间因长时间无人活动已过期|房间已过期|房间已结束/.test(err.message)){
        exitToHome(err.message);
      }else console.warn(err);
    }finally{transitionBusy=false;}
  }

  async function connectRealtime(){
    leaveRealtime(false);
    if(!window.supabase?.createClient){toast('实时组件加载失败，请刷新页面');return;}
    try{session=await ToolboxAuth.getSession();}catch{}
    if(!session?.access_token){toast('登录状态已失效，请重新登录');return;}
    realtimeStatus='CONNECTING';
    realtime=window.supabase.createClient(ToolboxAuth.url,ToolboxAuth.key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    await realtime.realtime.setAuth(session.access_token);
    const topic=`pictionary:${state.room.id}`;
    channel=realtime.channel(topic,{config:{private:true,presence:{key:session.user.id},broadcast:{ack:false,self:false}}});
    channel.on('broadcast',{event:'stroke'},({payload})=>{markRealtimeRx();receiveStroke(payload);})
      .on('broadcast',{event:'clear'},({payload})=>{markRealtimeRx();if(payload?.round_id&&payload.round_id!==currentRoundId)return;strokes=[];activeStroke=null;redraw();})
      .on('broadcast',{event:'undo'},({payload})=>{markRealtimeRx();if(payload?.round_id&&payload.round_id!==currentRoundId)return;strokes=strokes.filter(s=>s.id!==payload.id);redraw();})
      .on('broadcast',{event:'sync_request'},()=>{markRealtimeRx();if(isDrawer())sendSnapshot();})
      .on('broadcast',{event:'snapshot'},({payload})=>{markRealtimeRx();receiveSnapshot(payload);})
      .on('broadcast',{event:'guess_result'},({payload})=>{markRealtimeRx();receiveGuessResult(payload);})
      .on('broadcast',{event:'state_changed'},()=>{markRealtimeRx();refreshState();})
      .on('broadcast',{event:'ping'},({payload})=>{markRealtimeRx();handlePing(payload);})
      .on('broadcast',{event:'pong'},({payload})=>{markRealtimeRx();handlePong(payload);})
      .on('presence',{event:'sync'},()=>{markRealtimeRx();presenceMembers=new Set(Object.values(channel.presenceState()).flat().map(x=>x.member_id));renderPlayers();})
      .subscribe(async status=>{
        realtimeStatus=status;
        updateRealtimeStatus(status);
        if(status==='SUBSCRIBED'){
          clearTimeout(reconnectTimer);reconnectTimer=null;lastPongAt=Date.now();setStatePoll(5000);
          await channel.track({member_id:me.id,nickname:me.nickname,online_at:new Date().toISOString()});
          sendEvent('sync_request',{member_id:me.id,round_id:currentRoundId});
          startPing();
          clearInterval(snapshotTimer);
          snapshotTimer=setInterval(()=>{if(isDrawer()&&state?.room?.status==='playing'&&(strokes.length||activeStroke))sendSnapshot();},1800);
        }else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED'){
          setStatePoll(1800);scheduleReconnect();
        }
      });
  }
  function updateRealtimeStatus(status=realtimeStatus){
    const pill=$('connectionStatus');if(!pill)return;
    const healthy=isRealtimeHealthy();
    if(status==='SUBSCRIBED'){
      pill.textContent=healthy?(Number.isFinite(realtimeRtt)?`实时在线 · ${Math.round(realtimeRtt)}ms`:'实时在线'):'实时降级';
      pill.classList.toggle('online',healthy);
    }else{
      pill.textContent=status==='CHANNEL_ERROR'||status==='TIMED_OUT'?'正在重连':'连接中';
      pill.classList.remove('online');
    }
  }
  function markRealtimeRx(){if(realtimeStatus==='SUBSCRIBED'){lastPongAt=Date.now();updateRealtimeStatus();}}
  function isRealtimeHealthy(){
    if(realtimeStatus!=='SUBSCRIBED')return false;
    if((state?.players?.length||0)<2)return true;
    return Date.now()-lastPongAt<9000;
  }
  function startPing(){
    clearInterval(pingTimer);sendPing();pingTimer=setInterval(sendPing,4000);
  }
  function sendPing(){
    if(realtimeStatus!=='SUBSCRIBED'||!state?.room?.id||!me?.id)return;
    const healthy=isRealtimeHealthy();setStatePoll(healthy?5000:1800);updateRealtimeStatus();
    const sent=Date.now(),id=`${sent}-${++pingSeq}`;
    sendEvent('ping',{ping_id:id,sender_member_id:me.id,sent_at:sent});
  }
  function handlePing(p){
    if(!p?.ping_id||!p?.sender_member_id||p.sender_member_id===me?.id)return;
    sendEvent('pong',{ping_id:p.ping_id,target_member_id:p.sender_member_id,responder_member_id:me.id,sent_at:Number(p.sent_at)||Date.now()});
  }
  function handlePong(p){
    if(!p||p.target_member_id!==me?.id)return;
    lastPongAt=Date.now();
    if(Number.isFinite(Number(p.sent_at)))realtimeRtt=Math.max(0,Date.now()-Number(p.sent_at));
    updateRealtimeStatus();
  }
  function scheduleReconnect(){
    if(reconnectTimer||document.hidden||!state?.room?.id)return;
    reconnectTimer=setTimeout(async()=>{reconnectTimer=null;try{await connectRealtime();}catch{scheduleReconnect();}},850);
  }
  function leaveRealtime(stopTimers=true){
    clearTimeout(reconnectTimer);reconnectTimer=null;clearInterval(snapshotTimer);snapshotTimer=null;clearInterval(pingTimer);pingTimer=null;
    if(channel&&realtime)realtime.removeChannel(channel);channel=realtime=null;realtimeStatus='CLOSED';lastPongAt=0;realtimeRtt=null;presenceMembers.clear();
    if(stopTimers){
      clearInterval(pollTimer);clearInterval(clockTimer);clearInterval(canvasSyncTimer);clearTimeout(serverSaveTimer);
      pollTimer=clockTimer=canvasSyncTimer=serverSaveTimer=null;statePollMs=0;
    }
  }
  function sendEvent(event,payload){
    if(!channel||realtimeStatus!=='SUBSCRIBED')return Promise.resolve('not_connected');
    try{
      const out=channel.send({type:'broadcast',event,payload});
      Promise.resolve(out).then(status=>{if(status&&status!=='ok')scheduleReconnect();}).catch(()=>scheduleReconnect());
      return out;
    }catch{scheduleReconnect();return Promise.resolve('error');}
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
    else{show('gameScreen');renderGame();requestAnimationFrame(()=>{resizeCanvas();redraw();});}
  }
  function renderPlayers(){if(!state)return;const host=state.room.host_member_id;$('players').innerHTML=state.players.map(p=>`<div class="player"><span class="avatar" style="background:${escapeHTML(p.color)}">${escapeHTML(p.nickname.slice(0,1))}</span><b>${escapeHTML(p.nickname)}${p.member_id===host?' 👑':''}</b><small>${presenceMembers.has(p.member_id)?'🟢 在线':'⚪'} · ${p.ready?'已准备':'未准备'}</small></div>`).join('');}
  function renderLobby(){const mine=state.players.find(p=>p.member_id===me.id);const host=state.room.host_member_id===me.id;$('readyBtn').classList.toggle('hidden',host);$('startBtn').classList.toggle('hidden',!host);$('readyBtn').textContent=mine?.ready?'取消准备':'我准备好了';const ready=state.players.filter(p=>p.ready||p.member_id===state.room.host_member_id).length;$('lobbyHint').textContent=host?`已有 ${ready}/${state.players.length} 人准备，至少 2 人且全员准备后可开始。`:'准备好后，等待房主开始。';$('startBtn').disabled=state.players.length<2||ready!==state.players.length;}
  function renderScores(){$('scoreStrip').innerHTML=state.players.slice().sort((a,b)=>b.score-a.score).map(p=>`<span class="score-chip">${escapeHTML(p.nickname)}<b>${p.score}</b></span>`).join('');}
  function renderRanking(){const sorted=state.players.slice().sort((a,b)=>b.score-a.score);$('ranking').innerHTML=sorted.map((p,i)=>`<div class="rank-row"><span class="place">${['🥇','🥈','🥉'][i]||`${i+1}.`}</span><span class="avatar" style="background:${escapeHTML(p.color)}">${escapeHTML(p.nickname.slice(0,1))}</span><b>${escapeHTML(p.nickname)}</b><strong>${p.score}</strong></div>`).join('');$('againBtn').classList.toggle('hidden',state.room.host_member_id!==me.id);}
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
      (state?.guesses||[]).some(g=>g.member_id===memberId&&g.is_correct)
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
    $('guessFeed').innerHTML=rows.map(g=>`<p class="${g.is_correct?'correct':''}${g.pending?' pending':''}"><b>${escapeHTML(g.nickname||'好友')}</b>：${g.is_correct?'猜中了！':escapeHTML(g.text||'')}${g.pending?'<span class="pending-dot"> ···</span>':''}</p>`).join('')||'<p class="system">画面就绪，开始猜吧。</p>';
    $('guessFeed').scrollTop=$('guessFeed').scrollHeight;
  }
  function receiveGuessResult(p){
    if(!p||p.round_id!==currentRoundId||!p.client_id)return;
    const prev=liveGuesses.get(p.client_id)||{};
    liveGuesses.set(p.client_id,{
      ...prev,
      client_id:p.client_id,guess_id:p.guess_id,round_id:p.round_id,
      member_id:p.member_id,nickname:p.nickname||prev.nickname||'好友',
      text:p.correct?'':String(p.text||prev.text||''),is_correct:!!p.correct,
      score_awarded:Number(p.points)||0,created_at:p.created_at||prev.created_at||new Date().toISOString(),
      pending:false
    });
    const key=p.guess_id||p.client_id;
    if(p.correct&&!appliedGuessResults.has(key)){
      appliedGuessResults.add(key);
      const guesser=state?.players?.find(x=>x.member_id===p.member_id);
      if(guesser)guesser.score+=Number(p.points)||0;
      const drawer=state?.players?.find(x=>x.member_id===p.drawer_member_id);
      if(drawer)drawer.score+=50;
      renderScores();
    }
    renderGuessFeed();
    if(p.member_id===me?.id&&p.correct)renderGame();
    if(p.round_complete)setTimeout(refreshState,120);
  }

  function tick(){
    if(!state)return;let remaining=60;
    if(state.room.status==='playing'&&state.room.ends_at)remaining=Math.max(0,Math.ceil((new Date(state.room.ends_at).getTime()-Date.now())/1000));
    else if(state.room.status==='summary')remaining=Math.max(0,Math.ceil((new Date(state.room.summary_until).getTime()-Date.now())/1000));
    $('timer').textContent=remaining;$('timer').classList.toggle('urgent',remaining<=10);$('timer').classList.toggle('critical',remaining<=5);
    if(state.room.status==='playing'){
      if(remaining<=30&&state.round?.hint){$('hintBar').textContent=`范围提示：${state.round.hint}`;$('hintBar').classList.add('revealed');}
      else{$('hintBar').textContent='范围提示将在剩余 30 秒时出现';$('hintBar').classList.remove('revealed');}
      if(remaining<=0&&!transitionBusy)mutate('finish_round').catch(()=>{});
    }else if(state.room.status==='summary'){
      $('hintBar').textContent=`正确答案：${state.revealed_answer||'—'}`;$('hintBar').classList.add('revealed');
      if(remaining<=0&&!transitionBusy)mutate('next_round').catch(()=>{});
    }else{$('hintBar').textContent='画手选词后开始 60 秒倒计时';$('hintBar').classList.remove('revealed');}
  }
  async function submitGuess(e){
    e.preventDefault();
    const input=$('guessInput'),text=input.value.trim();
    if(!text||!state||state.room.status!=='playing'||isDrawer()||hasGuessed(me?.id))return;
    if(guessRequests.size>=4){toast('发送太快了，稍等一下');return;}
    const clientId=makeClientId();
    const item={client_id:clientId,round_id:currentRoundId,member_id:me.id,nickname:me.nickname,text,is_correct:false,created_at:new Date().toISOString(),pending:true};
    liveGuesses.set(clientId,item);input.value='';renderGuessFeed();
    const request=api('guess',{room_id:state.room.id,text,client_id:clientId});
    guessRequests.set(clientId,request);
    try{
      const data=await request;
      const current=liveGuesses.get(clientId)||item;
      liveGuesses.set(clientId,{...current,guess_id:data?.guess_id||current.guess_id,is_correct:!!data?.correct,text:data?.correct?'':text,score_awarded:Number(data?.points)||0,created_at:data?.created_at||current.created_at,pending:false});
      renderGuessFeed();
      if(data?.correct){
        toast(`猜对了！+${data.points} 分`);
        setTimeout(refreshState,data?.round_complete?80:350);
      }
    }catch(err){
      const current=liveGuesses.get(clientId);
      if(!current?.guess_id)liveGuesses.delete(clientId);
      renderGuessFeed();toast(err.message);
    }finally{guessRequests.delete(clientId);}
  }
  async function shareRoom(){const url=new URL('../pictionary/',location.href);url.searchParams.set('room',state.room.code);const text=`来玩你画我猜！房间码 ${state.room.code}\n${url.href}`;try{if(navigator.share)await navigator.share({title:'你画我猜好友房',text,url:url.href});else{await navigator.clipboard.writeText(text);toast('邀请链接已复制');}}catch(err){if(err.name!=='AbortError')toast('复制失败，请手动分享房间码');}}

  function resizeCanvas(){const rect=canvas.getBoundingClientRect();if(!rect.width)return;const dpr=Math.min(2,window.devicePixelRatio||1);logical={w:rect.width,h:rect.height};canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.lineCap='round';ctx.lineJoin='round';redraw();}
  function point(e){const r=canvas.getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))];}
  function pointerDown(e){if(!isDrawer()||state.room.status!=='playing')return;e.preventDefault();canvas.setPointerCapture(e.pointerId);const p=point(e);activeStroke={id:crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`,color:erasing?'#ffffff':selectedColor,size:brushSize,points:[p]};sendPoints=[p];drawDot(activeStroke,p);flushStroke(false);scheduleServerCanvasSave();}
  function pointerMove(e){
    if(!activeStroke)return;e.preventDefault();
    const events=typeof e.getCoalescedEvents==='function'?(e.getCoalescedEvents()||[]):[];
    const samples=events.length?events:[e];let changed=false;
    for(const ev of samples){
      const p=point(ev),last=activeStroke.points.at(-1);
      if(Math.hypot((p[0]-last[0])*logical.w,(p[1]-last[1])*logical.h)<1.5)continue;
      activeStroke.points.push(p);sendPoints.push(p);drawSegment(activeStroke,last,p);changed=true;
    }
    if(changed){scheduleSend();scheduleServerCanvasSave();}
  }
  function pointerUp(e){
    if(!activeStroke)return;e.preventDefault();flushStroke(true);strokes.push(activeStroke);activeStroke=null;sendPoints=[];saveCanvas();
    if(isRealtimeHealthy())scheduleServerCanvasSave();else persistCanvasFallback();
  }
  function encodePoints(points){return points.map(p=>[Math.round(p[0]*4095),Math.round(p[1]*4095)]);}
  function decodePoints(points,q){return q===1?points.map(p=>[Number(p[0])/4095,Number(p[1])/4095]):points;}
  function scheduleSend(){if(sendTimer)return;sendTimer=setTimeout(()=>flushStroke(false),28);}
  function flushStroke(done){
    clearTimeout(sendTimer);sendTimer=null;if(!activeStroke)return;
    if(done){sendEvent('stroke',{round_id:currentRoundId,id:activeStroke.id,color:activeStroke.color,size:activeStroke.size,points:encodePoints(activeStroke.points),q:1,done:true,replace:true,sent_at:Date.now()});return;}
    if(!sendPoints.length)return;
    sendEvent('stroke',{round_id:currentRoundId,id:activeStroke.id,color:activeStroke.color,size:activeStroke.size,points:encodePoints(sendPoints),q:1,done:false,sent_at:Date.now()});
    sendPoints=[activeStroke.points.at(-1)];
  }
  function receiveStroke(p){
    if(!p?.id||!Array.isArray(p.points)||p.round_id!==currentRoundId||isDrawer())return;
    const incoming=decodePoints(p.points,p.q);
    let s=strokes.find(x=>x.id===p.id);
    if(p.replace){
      const next={id:p.id,color:p.color||'#111827',size:Number(p.size)||7,points:incoming};
      if(s)Object.assign(s,next);else strokes.push(next);
      redraw();return;
    }
    if(!s){s={id:p.id,color:p.color||'#111827',size:Number(p.size)||7,points:[]};strokes.push(s);}
    for(const pt of incoming){
      const last=s.points.at(-1);
      if(!last||last[0]!==pt[0]||last[1]!==pt[1]){
        s.points.push(pt);
        if(last)drawSegment(s,last,pt);else drawDot(s,pt);
      }
    }
  }
  function drawDot(s,p){ctx.fillStyle=s.color;ctx.beginPath();ctx.arc(p[0]*logical.w,p[1]*logical.h,s.size/2,0,Math.PI*2);ctx.fill();}
  function drawSegment(s,a,b){ctx.strokeStyle=s.color;ctx.lineWidth=s.size;ctx.beginPath();ctx.moveTo(a[0]*logical.w,a[1]*logical.h);ctx.lineTo(b[0]*logical.w,b[1]*logical.h);ctx.stroke();}
  function redraw(){if(!logical.w)return;ctx.clearRect(0,0,logical.w,logical.h);ctx.fillStyle='#fff';ctx.fillRect(0,0,logical.w,logical.h);for(const s of strokes){if(s.points.length===1)drawDot(s,s.points[0]);for(let i=1;i<s.points.length;i++)drawSegment(s,s.points[i-1],s.points[i]);}if(activeStroke){if(activeStroke.points.length===1)drawDot(activeStroke,activeStroke.points[0]);for(let i=1;i<activeStroke.points.length;i++)drawSegment(activeStroke,activeStroke.points[i-1],activeStroke.points[i]);}}
  function undoStroke(){if(!isDrawer()||!strokes.length)return;const s=strokes.pop();redraw();saveCanvas();sendEvent('undo',{round_id:currentRoundId,id:s.id});sendSnapshot();persistCanvasFallback();}
  function bindHoldClear(){
    let t=null;const b=$('clearBtn');
    const cancel=()=>{clearTimeout(t);t=null;b.classList.remove('holding');};
    b.addEventListener('pointerdown',e=>{if(!isDrawer())return;e.preventDefault();b.classList.add('holding');t=setTimeout(()=>{strokes=[];activeStroke=null;sendPoints=[];redraw();saveCanvas();sendEvent('clear',{round_id:currentRoundId,sent_at:Date.now()});persistCanvasFallback();toast('画布已清空');cancel();},480);});
    ['pointerup','pointercancel','pointerleave'].forEach(x=>b.addEventListener(x,cancel));
  }
  function storageKey(){return currentRoundId?`pictionary.canvas.${currentRoundId}`:'';}
  function saveCanvas(){try{if(storageKey())sessionStorage.setItem(storageKey(),JSON.stringify(strokes));}catch{}}
  function switchRound(id){
    currentRoundId=id;strokes=[];activeStroke=null;sendPoints=[];snapshotAssemblies.clear();lastCanvasVersion=0;liveGuesses.clear();appliedGuessResults.clear();
    if(id&&isDrawer()){try{strokes=JSON.parse(sessionStorage.getItem(storageKey())||'[]');}catch{strokes=[];}}
    redraw();
    if(id&&!isDrawer()){setTimeout(()=>sendEvent('sync_request',{member_id:me.id,round_id:id}),120);setTimeout(pullCanvasFallback,180);}
  }
  function sendSnapshot(){
    if(!currentRoundId||!isDrawer())return;
    const snapshotId=`${currentRoundId}:${Date.now()}:${Math.random().toString(36).slice(2,7)}`;
    const all=activeStroke?[...strokes,activeStroke]:strokes;
    const chunks=[];for(let i=0;i<all.length;i+=8)chunks.push(all.slice(i,i+8));if(!chunks.length)chunks.push([]);
    chunks.forEach((items,i)=>sendEvent('snapshot',{snapshot_id:snapshotId,round_id:currentRoundId,index:i,total:chunks.length,strokes:items,sent_at:Date.now()}));
  }
  function receiveSnapshot(p){
    if(!p||p.round_id!==currentRoundId||isDrawer()||!p.snapshot_id)return;
    let entry=snapshotAssemblies.get(p.snapshot_id);
    if(!entry){entry={total:Number(p.total)||1,chunks:new Map(),created:Date.now()};snapshotAssemblies.set(p.snapshot_id,entry);}
    entry.chunks.set(Number(p.index)||0,p.strokes||[]);
    for(const [id,v] of snapshotAssemblies){if(Date.now()-v.created>8000)snapshotAssemblies.delete(id);}
    if(entry.chunks.size<entry.total)return;
    const merged=[];for(let i=0;i<entry.total;i++)merged.push(...(entry.chunks.get(i)||[]));
    strokes=merged;activeStroke=null;snapshotAssemblies.clear();redraw();
  }

  function canvasPayload(){
    const all=activeStroke?[...strokes,activeStroke]:strokes;
    return all.map(s=>({id:s.id,color:s.color,size:s.size,points:s.points}));
  }
  function scheduleServerCanvasSave(){
    if(serverSaveTimer||!isDrawer()||state?.room?.status!=='playing'||!currentRoundId)return;
    serverSaveTimer=setTimeout(()=>{serverSaveTimer=null;persistCanvasFallback();},2000);
  }
  async function persistCanvasFallback(){
    clearTimeout(serverSaveTimer);serverSaveTimer=null;
    if(!isDrawer()||state?.room?.status!=='playing'||!currentRoundId)return;
    if(canvasSaveBusy){canvasSaveQueued=true;return;}
    canvasSaveBusy=true;
    const roundId=currentRoundId,roomId=state.room.id,payload=canvasPayload();
    try{
      const data=await api('save_canvas',{room_id:roomId,round_id:roundId,strokes:payload});
      if(roundId===currentRoundId)lastCanvasVersion=Math.max(lastCanvasVersion,Number(data?.version)||0);
    }catch(err){console.warn('canvas fallback save failed',err);}
    finally{
      canvasSaveBusy=false;
      if(canvasSaveQueued){canvasSaveQueued=false;scheduleServerCanvasSave();}
    }
  }
  async function pullCanvasFallback(){
    if(canvasFetchBusy||!state||!currentRoundId||isDrawer()||state.room.status!=='playing'||isRealtimeHealthy())return;
    canvasFetchBusy=true;
    const roundId=currentRoundId,roomId=state.room.id;
    try{
      const data=await api('canvas',{room_id:roomId,round_id:roundId});
      if(roundId!==currentRoundId)return;
      const version=Number(data?.version)||0;
      if(version>lastCanvasVersion&&Array.isArray(data?.strokes)){
        lastCanvasVersion=version;strokes=data.strokes;activeStroke=null;redraw();
      }
    }catch(err){console.warn('canvas fallback fetch failed',err);}
    finally{canvasFetchBusy=false;}
  }

  boot();
})();
