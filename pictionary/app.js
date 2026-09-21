(() => {
  'use strict';
  const FUNCTION_URL = `${ToolboxAuth.url}/functions/v1/pictionary-game`;
  const COLORS = ['#111827','#ef4444','#f59e0b','#22c55e','#3b82f6','#8b5cf6','#ec4899','#ffffff'];
  const $ = id => document.getElementById(id);
  const screens = ['authScreen','homeScreen','roomScreen','gameScreen','finishScreen'];
  let session=null, me=null, state=null, channel=null, realtime=null, pollTimer=null, clockTimer=null;
  let currentRoundId=null, strokes=[], activeStroke=null, sendPoints=[], sendTimer=null, selectedColor=COLORS[0], brushSize=7, erasing=false;
  let canvas=$('canvas'), ctx=canvas.getContext('2d'), logical={w:1,h:1}, busy=false, transitionBusy=false, presenceMembers=new Set();

  function show(id){ screens.forEach(x => $(x).classList.toggle('active',x===id)); }
  function toast(message){ const el=$('toast'); el.textContent=message; el.classList.add('show'); clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove('show'),2300); }
  function escapeHTML(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
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
    $('signOutBtn').onclick=async()=>{leaveRealtime();await ToolboxAuth.signOut();session=me=state=null;setURL('');show('authScreen');};
    $('createBtn').onclick=async()=>{try{const data=await api('create_room');await enterRoom(data.state);}catch(err){toast(err.message);}};
    $('joinForm').addEventListener('submit',async e=>{e.preventDefault();await joinRoom($('roomCodeInput').value);});
    $('shareBtn').onclick=shareRoom;
    $('readyBtn').onclick=async()=>mutate('toggle_ready');
    $('startBtn').onclick=async()=>mutate('start_game');
    $('guessForm').addEventListener('submit',submitGuess);
    $('againBtn').onclick=async()=>mutate('play_again');
    $('wordOptions').addEventListener('click',async e=>{const b=e.target.closest('[data-option]');if(!b)return;try{await mutate('choose_word',{option_id:b.dataset.option});$('wordModal').classList.add('hidden');}catch(err){toast(err.message);}});
    $('colors').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;selectedColor=b.dataset.color;erasing=false;document.querySelectorAll('#colors button').forEach(x=>x.classList.toggle('active',x===b));$('eraserBtn').classList.remove('active');});
    document.querySelector('.brushes').addEventListener('click',e=>{const b=e.target.closest('[data-size]');if(!b)return;brushSize=Number(b.dataset.size);document.querySelectorAll('[data-size]').forEach(x=>x.classList.toggle('active',x===b));});
    $('eraserBtn').onclick=()=>{erasing=!erasing;$('eraserBtn').classList.toggle('active',erasing);};
    $('undoBtn').onclick=undoStroke; bindHoldClear();
    canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointermove',pointerMove);canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('pointercancel',pointerUp);
    window.addEventListener('resize',()=>{resizeCanvas();redraw();});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state)refreshState();});
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
  async function enterRoom(next){ state=next;setURL(state.room.code);$('shareBtn').classList.remove('hidden');await connectRealtime();renderState();clearInterval(pollTimer);pollTimer=setInterval(refreshState,2200);clearInterval(clockTimer);clockTimer=setInterval(tick,250); }
  async function mutate(action,payload={}){if(busy)return;busy=true;try{const data=await api(action,{room_id:state.room.id,...payload});if(data.state){state=data.state;renderState();sendEvent('state_changed',{at:Date.now()});}return data;}finally{busy=false;}}
  async function refreshState(){if(!state||transitionBusy)return;transitionBusy=true;try{const data=await api('state',{room_id:state.room.id});state=data.state;renderState();}catch(err){if(/不在房间|房间不存在/.test(err.message)){leaveRealtime();show('homeScreen');setURL('');}else console.warn(err);}finally{transitionBusy=false;}}

  async function connectRealtime(){
    leaveRealtime(false);
    if(!window.supabase?.createClient){toast('实时组件加载失败，请刷新页面');return;}
    realtime=window.supabase.createClient(ToolboxAuth.url,ToolboxAuth.key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    await realtime.realtime.setAuth(session.access_token);
    const topic=`pictionary:${state.room.id}`;
    channel=realtime.channel(topic,{config:{private:true,presence:{key:session.user.id},broadcast:{ack:false,self:false}}});
    channel.on('broadcast',{event:'stroke'},({payload})=>receiveStroke(payload))
      .on('broadcast',{event:'clear'},()=>{strokes=[];redraw();})
      .on('broadcast',{event:'undo'},({payload})=>{strokes=strokes.filter(s=>s.id!==payload.id);redraw();})
      .on('broadcast',{event:'sync_request'},()=>{if(isDrawer())sendSnapshot();})
      .on('broadcast',{event:'snapshot'},({payload})=>receiveSnapshot(payload))
      .on('broadcast',{event:'state_changed'},()=>refreshState())
      .on('presence',{event:'sync'},()=>{presenceMembers=new Set(Object.values(channel.presenceState()).flat().map(x=>x.member_id));renderPlayers();})
      .subscribe(async status=>{
        $('connectionStatus').textContent=status==='SUBSCRIBED'?'实时在线':'连接中';$('connectionStatus').classList.toggle('online',status==='SUBSCRIBED');
        if(status==='SUBSCRIBED'){await channel.track({member_id:me.id,nickname:me.nickname,online_at:new Date().toISOString()});sendEvent('sync_request',{member_id:me.id});}
      });
  }
  function leaveRealtime(stopTimers=true){if(channel&&realtime)realtime.removeChannel(channel);channel=realtime=null;presenceMembers.clear();if(stopTimers){clearInterval(pollTimer);clearInterval(clockTimer);pollTimer=clockTimer=null;}}
  function sendEvent(event,payload){try{return channel?.send({type:'broadcast',event,payload});}catch{}}

  function renderState(){
    if(!state)return;
    $('roomCode').textContent=state.room.code;$('playerCount').textContent=`${state.players.length} / 8`;renderPlayers();renderScores();
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
    const r=state.round;$('roundLabel').textContent=`第 ${state.room.round_no} / ${state.room.total_rounds} 轮`;$('drawerLabel').textContent=r?`${r.drawer_nickname} 正在画`:'等待画手选词';
    if(r?.id!==currentRoundId){switchRound(r?.id||null);}
    const mineDrawer=isDrawer();$('drawTools').classList.toggle('hidden',!mineDrawer||state.room.status!=='playing');
    $('guessPanel').classList.toggle('hidden',false);const guessed=state.guesses?.some(g=>g.member_id===me.id&&g.is_correct);
    const canGuess=state.room.status==='playing'&&!mineDrawer&&!guessed;$('guessInput').disabled=!canGuess;$('guessForm').querySelector('button').disabled=!canGuess;$('guessInput').placeholder=mineDrawer?'你是画手，不能猜词':guessed?'你已经猜中了':'输入你的答案…';
    $('wordLabel').textContent=mineDrawer&&state.answer?`题目：${state.answer}`:r?`${r.char_count} 个字 · ${stars(r.difficulty)}`:'等待选题';
    $('guessFeed').innerHTML=(state.guesses||[]).map(g=>`<p class="${g.is_correct?'correct':''}"><b>${escapeHTML(g.nickname)}</b>：${g.is_correct?'猜中了！':escapeHTML(g.text)}</p>`).join('')||'<p class="system">画面就绪，开始猜吧。</p>';
    $('guessFeed').scrollTop=$('guessFeed').scrollHeight;
    if(state.room.status==='choosing'){$('canvasCover').classList.remove('hidden');$('coverText').textContent=mineDrawer?'请选择本轮题目':'画手正在选题…';if(mineDrawer&&state.options?.length)showWordOptions();else $('wordModal').classList.add('hidden');}
    else if(state.room.status==='summary'){$('canvasCover').classList.remove('hidden');$('coverText').textContent=`本轮答案：${state.revealed_answer||'—'}`;$('wordModal').classList.add('hidden');}
    else{$('canvasCover').classList.add('hidden');$('wordModal').classList.add('hidden');}
    tick();
  }
  function stars(n){return '⭐'.repeat(Math.max(1,Math.min(3,Number(n)||1)));}
  function showWordOptions(){$('wordOptions').innerHTML=state.options.map(o=>`<button class="option" data-option="${escapeHTML(o.id)}"><b>${escapeHTML(o.word)}</b><small>${escapeHTML(o.category)} · ${stars(o.difficulty)}</small></button>`).join('');$('wordModal').classList.remove('hidden');}
  function isDrawer(){return !!state&&state.room.current_drawer_member_id===me?.id;}

  function tick(){
    if(!state)return;let remaining=60;
    if(state.room.status==='playing'&&state.room.ends_at)remaining=Math.max(0,Math.ceil((new Date(state.room.ends_at).getTime()-Date.now())/1000));
    else if(state.room.status==='summary')remaining=Math.max(0,Math.ceil((new Date(state.room.summary_until).getTime()-Date.now())/1000));
    $('timer').textContent=remaining;$('timer').classList.toggle('urgent',remaining<=10);$('timer').classList.toggle('critical',remaining<=5);
    if(state.room.status==='playing'){
      if(remaining<=30&&state.round){$('hintBar').textContent=`范围提示：${state.round.hint}`;$('hintBar').classList.add('revealed');}
      else{$('hintBar').textContent='范围提示将在剩余 30 秒时出现';$('hintBar').classList.remove('revealed');}
      if(remaining<=0&&!transitionBusy)mutate('finish_round').catch(()=>{});
    }else if(state.room.status==='summary'){
      $('hintBar').textContent=`正确答案：${state.revealed_answer||'—'}`;$('hintBar').classList.add('revealed');
      if(remaining<=0&&!transitionBusy)mutate('next_round').catch(()=>{});
    }else{$('hintBar').textContent='画手选词后开始 60 秒倒计时';$('hintBar').classList.remove('revealed');}
  }
  async function submitGuess(e){e.preventDefault();const text=$('guessInput').value.trim();if(!text||busy)return;$('guessInput').value='';try{const data=await mutate('guess',{text});if(data?.correct)toast(`猜对了！+${data.points} 分`);}catch(err){toast(err.message);}}
  async function shareRoom(){const url=new URL('../pictionary/',location.href);url.searchParams.set('room',state.room.code);const text=`来玩你画我猜！房间码 ${state.room.code}\n${url.href}`;try{if(navigator.share)await navigator.share({title:'你画我猜好友房',text,url:url.href});else{await navigator.clipboard.writeText(text);toast('邀请链接已复制');}}catch(err){if(err.name!=='AbortError')toast('复制失败，请手动分享房间码');}}

  function resizeCanvas(){const rect=canvas.getBoundingClientRect();if(!rect.width)return;const dpr=Math.min(2,window.devicePixelRatio||1);logical={w:rect.width,h:rect.height};canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.lineCap='round';ctx.lineJoin='round';redraw();}
  function point(e){const r=canvas.getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))];}
  function pointerDown(e){if(!isDrawer()||state.room.status!=='playing')return;e.preventDefault();canvas.setPointerCapture(e.pointerId);const p=point(e);activeStroke={id:crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`,color:erasing?'#ffffff':selectedColor,size:brushSize,points:[p]};sendPoints=[p];scheduleSend();}
  function pointerMove(e){if(!activeStroke)return;e.preventDefault();const p=point(e),last=activeStroke.points.at(-1);if(Math.hypot((p[0]-last[0])*logical.w,(p[1]-last[1])*logical.h)<1.5)return;activeStroke.points.push(p);sendPoints.push(p);drawSegment(activeStroke,last,p);scheduleSend();}
  function pointerUp(e){if(!activeStroke)return;e.preventDefault();flushStroke(true);strokes.push(activeStroke);activeStroke=null;saveCanvas();}
  function scheduleSend(){if(sendTimer)return;sendTimer=setTimeout(()=>flushStroke(false),100);}
  function flushStroke(done){clearTimeout(sendTimer);sendTimer=null;if(!activeStroke||!sendPoints.length)return;sendEvent('stroke',{id:activeStroke.id,color:activeStroke.color,size:activeStroke.size,points:sendPoints,done});sendPoints=[activeStroke.points.at(-1)];}
  function receiveStroke(p){if(!p?.id||!Array.isArray(p.points))return;let s=strokes.find(x=>x.id===p.id);if(!s){s={id:p.id,color:p.color||'#111827',size:Number(p.size)||7,points:[]};strokes.push(s);}for(const pt of p.points){const last=s.points.at(-1);if(!last||last[0]!==pt[0]||last[1]!==pt[1]){s.points.push(pt);if(last)drawSegment(s,last,pt);}}}
  function drawSegment(s,a,b){ctx.strokeStyle=s.color;ctx.lineWidth=s.size;ctx.beginPath();ctx.moveTo(a[0]*logical.w,a[1]*logical.h);ctx.lineTo(b[0]*logical.w,b[1]*logical.h);ctx.stroke();}
  function redraw(){if(!logical.w)return;ctx.clearRect(0,0,logical.w,logical.h);ctx.fillStyle='#fff';ctx.fillRect(0,0,logical.w,logical.h);for(const s of strokes){if(s.points.length===1){ctx.fillStyle=s.color;ctx.beginPath();ctx.arc(s.points[0][0]*logical.w,s.points[0][1]*logical.h,s.size/2,0,Math.PI*2);ctx.fill();}for(let i=1;i<s.points.length;i++)drawSegment(s,s.points[i-1],s.points[i]);}if(activeStroke){for(let i=1;i<activeStroke.points.length;i++)drawSegment(activeStroke,activeStroke.points[i-1],activeStroke.points[i]);}}
  function undoStroke(){if(!isDrawer()||!strokes.length)return;const s=strokes.pop();redraw();saveCanvas();sendEvent('undo',{id:s.id});}
  function bindHoldClear(){let t=null;const b=$('clearBtn'),cancel=()=>{clearTimeout(t);t=null;b.classList.remove('holding');};b.addEventListener('pointerdown',e=>{if(!isDrawer())return;e.preventDefault();b.classList.add('holding');t=setTimeout(()=>{strokes=[];activeStroke=null;redraw();saveCanvas();sendEvent('clear',{});toast('画布已清空');cancel();},1200);});['pointerup','pointercancel','pointerleave'].forEach(x=>b.addEventListener(x,cancel));}
  function storageKey(){return currentRoundId?`pictionary.canvas.${currentRoundId}`:'';}
  function saveCanvas(){try{if(storageKey())sessionStorage.setItem(storageKey(),JSON.stringify(strokes));}catch{}}
  function switchRound(id){currentRoundId=id;strokes=[];activeStroke=null;if(id&&isDrawer()){try{strokes=JSON.parse(sessionStorage.getItem(storageKey())||'[]');}catch{strokes=[];}}redraw();if(id&&!isDrawer())setTimeout(()=>sendEvent('sync_request',{member_id:me.id}),350);}
  function sendSnapshot(){const chunks=[];for(let i=0;i<strokes.length;i+=12)chunks.push(strokes.slice(i,i+12));if(!chunks.length)chunks.push([]);chunks.forEach((items,i)=>sendEvent('snapshot',{round_id:currentRoundId,index:i,total:chunks.length,reset:i===0,strokes:items}));}
  function receiveSnapshot(p){if(!p||p.round_id!==currentRoundId||isDrawer())return;if(p.reset)strokes=[];for(const s of p.strokes||[]){if(!strokes.some(x=>x.id===s.id))strokes.push(s);}redraw();}

  boot();
})();
