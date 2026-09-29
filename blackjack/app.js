(() => {
  'use strict';

  const FUNCTION_URL = `${ToolboxAuth.url}/functions/v1/blackjack-game`;
  const $ = (id) => document.getElementById(id);
  const SCREENS = ['authScreen','recoveryScreen','homeScreen','roomScreen','gameScreen','finishScreen'];
  const SUITS = {S:'♠',H:'♥',D:'♦',C:'♣'};
  const STATUS_TEXT = {active:'思考中',stand:'已停牌',bust:'爆牌',blackjack:'Blackjack',none:'等待开局'};

  let session = null;
  let me = null;
  let state = null;
  let roomEpoch = 0;
  let busy = false;
  let loginBusy = false;
  let realtime = null;
  let channel = null;
  let realtimeStatus = 'CLOSED';
  let realtimeRtt = null;
  let serverHeartbeatAt = 0;
  let pingTimer = null;
  let pollTimer = null, pollMs = 0;
  let clockTimer = null;
  let reconnectTimer = null;
  let refreshTimer = null;
  let pendingPings = new Map();
  let presenceMembers = new Set();
  let reconnectAttempt = 0;
  let timeoutRequested = false;
  let advanceRequested = false;
  let clockOffset = 0;
  let suspended = false;

  function show(id) {
    SCREENS.forEach((name) => $(name).classList.toggle('active', name === id));
  }
  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 2200);
  }
  function makeId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    const h = [...b].map((x) => x.toString(16).padStart(2,'0')).join('');
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  }
  function codeFromURL() {
    return (new URLSearchParams(location.search).get('room') || '')
      .toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,6);
  }
  function setURL(code) {
    const url = new URL(location.href);
    if (code) url.searchParams.set('room',code); else url.searchParams.delete('room');
    history.replaceState({},'',url);
  }
  function myPlayer() {
    if (!state || !me) return null;
    const id = String(me.id);
    return state.players.find((p) => String(p.member_id) === id) || null;
  }
  function isHost() {
    return Boolean(state && me && String(state.room.host_member_id) === String(me.id));
  }
  function validSnapshot(next) {
    return next && next.room && Array.isArray(next.players) && next.dealer &&
      typeof next.room.id === 'string' && Number.isFinite(Number(next.room.version));
  }

  async function api(action, payload = {}, timeout = 6500) {
    if (navigator.onLine === false) throw Object.assign(new Error('网络已断开，恢复后请重试'),{retryable:true});
    const epoch = roomEpoch;
    const auth = await ToolboxAuth.getSession();
    if (!auth) throw Object.assign(new Error('请先登录'),{code:'AUTH_REQUIRED',status:401});
    session = auth;
    if (realtime && realtime.realtime && auth.access_token) {
      Promise.resolve(realtime.realtime.setAuth(auth.access_token)).catch(() => scheduleReconnect());
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(FUNCTION_URL,{
        method:'POST',
        cache:'no-store',
        signal:controller.signal,
        headers:{
          'Content-Type':'application/json',
          'apikey':ToolboxAuth.key,
          'Authorization':`Bearer ${auth.access_token}`,
        },
        body:JSON.stringify({action,...payload}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.error) {
        const err = new Error(data.error || `请求失败（${response.status}）`);
        err.status = response.status;
        err.code = data.code;
        err.retryable = response.status >= 500 || response.status === 429;
        throw err;
      }
      if (epoch !== roomEpoch) throw Object.assign(new Error('会话已切换'),{cancelled:true});
      return data;
    } catch (err) {
      if (err?.name === 'AbortError') throw Object.assign(new Error('网络较慢，操作尚未确认，请重试'),{retryable:true});
      if (err instanceof TypeError) err.retryable = true;
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function adoptState(next) {
    if (!validSnapshot(next)) return;
    if (state && next.room.id === state.room.id && Number(next.room.version) < Number(state.room.version)) return;
    state = next;
    const serverNow = Date.parse(next.server_now || '');
    if (Number.isFinite(serverNow)) clockOffset = serverNow - Date.now();
    timeoutRequested = false;
    if (next.room.phase !== 'settlement') advanceRequested = false;
    renderState();
    startTimers();
  }

  async function initialize() {
    show('recoveryScreen');
    $('recoveryMessage').textContent = '正在恢复登录和房间…';
    try {
      session = await ToolboxAuth.getSession();
      if (!session) {
        show('authScreen');
        return;
      }
      const code = codeFromURL();
      let data;
      try {
        data = await api('bootstrap', code ? {code} : {});
      } catch (err) {
        if (code && [400,404,410].includes(err.status)) {
          setURL('');
          toast(err.message);
          data = await api('bootstrap');
        } else throw err;
      }
      me = data.member;
      $('welcomeName').textContent = me.nickname;
      show('homeScreen');
      if (data.state) await enterRoom(data.state);
    } catch (err) {
      if (['AUTH_REQUIRED','SESSION_REVOKED'].includes(err.code)) {
        await ToolboxAuth.signOut();
        session = null;
        show('authScreen');
        $('loginError').textContent = ToolboxAuth.authMessage(err);
      } else {
        show('recoveryScreen');
        $('recoveryMessage').textContent = err.message || '连接失败，请重试。';
      }
    }
  }

  function bind() {
    $('loginForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (loginBusy) return;
      loginBusy = true;
      const button = $('loginForm').querySelector('button');
      button.disabled = true;
      button.textContent = '正在登录…';
      $('loginError').textContent = '';
      try {
        session = await ToolboxAuth.signIn($('emailInput').value.trim(),$('passwordInput').value);
        $('passwordInput').value = '';
        await initialize();
      } catch (err) {
        $('loginError').textContent = ToolboxAuth.authMessage(err);
      } finally {
        loginBusy = false;
        button.disabled = false;
        button.textContent = '登录';
      }
    });
    $('retrySessionBtn').onclick = initialize;
    $('resetSessionBtn').onclick = async () => {
      await ToolboxAuth.signOut();
      clearRoom();
      session = me = null;
      show('authScreen');
    };
    $('signOutBtn').onclick = async () => {
      clearRoom();
      await ToolboxAuth.signOut();
      session = me = null;
      show('authScreen');
    };
    $('createBtn').onclick = async () => {
      if (busy) return;
      busy = true;
      $('createBtn').disabled = true;
      try {
        const data = await api('create_room',{round_limit:Number($('roundLimit').value)});
        me = data.member || me;
        await enterRoom(data.state);
      } catch (err) { toast(err.message); }
      finally { busy = false; $('createBtn').disabled = false; }
    };
    $('joinForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      await joinRoom($('roomCodeInput').value);
    });
    $('readyBtn').onclick = () => mutate('toggle_ready');
    $('startBtn').onclick = () => mutate('start_game',{action_id:makeId()});
    $('hitBtn').onclick = () => mutate('hit',{expected_token:myPlayer()?.action_token,action_id:makeId()});
    $('standBtn').onclick = () => mutate('stand',{expected_token:myPlayer()?.action_token,action_id:makeId()});
    $('againBtn').onclick = () => mutate('play_again');
    $('shareBtn').onclick = shareRoom;
    $('leaveBtn').onclick = leaveRoom;
    document.querySelector('.emoji-row').addEventListener('click',(event) => {
      const button = event.target.closest('[data-emoji]');
      if (button) sendEmoji(button.dataset.emoji);
    });
    document.addEventListener('visibilitychange',() => {
      suspended = document.hidden;
      if (!suspended) resumeRoom();
    });
    window.addEventListener('online',resumeRoom);
    window.addEventListener('offline',updateConnection);
    window.addEventListener('pageshow',resumeRoom);
    window.addEventListener('pagehide',() => { suspended = true; leaveRealtime(); });
    ToolboxAuth.onAuthStateChange((event,next) => {
      if (event === 'SIGNED_OUT' || (session?.user?.id && next?.user?.id && session.user.id !== next.user.id)) {
        clearRoom();
        session = me = null;
        show('authScreen');
      }
    });
  }

  async function joinRoom(raw) {
    const code = String(raw || '').toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,6);
    if (code.length !== 6) { toast('请输入 6 位房间码'); return; }
    if (busy) return;
    busy = true;
    try {
      const data = await api('join_room',{code});
      me = data.member || me;
      await enterRoom(data.state);
    } catch (err) { toast(err.message); }
    finally { busy = false; }
  }

  async function enterRoom(next) {
    roomEpoch += 1;
    leaveRealtime();
    state = null;
    suspended = false;
    adoptState(next);
    setURL(next.room.code);
    $('shareBtn').classList.remove('hidden');
    $('leaveBtn').classList.remove('hidden');
    try { await connectRealtime(); } catch { scheduleReconnect(400); }
  }

  function clearRoom() {
    roomEpoch += 1;
    leaveRealtime();
    clearInterval(pollTimer);
    clearInterval(clockTimer);
    clearTimeout(refreshTimer);
    pollTimer = clockTimer = refreshTimer = null;
    pollMs = 0;
    state = null;
    presenceMembers.clear();
    setURL('');
    $('shareBtn').classList.add('hidden');
    $('leaveBtn').classList.add('hidden');
  }

  function exitToHome(message = '') {
    clearRoom();
    show('homeScreen');
    if (message) toast(message);
  }

  async function leaveRoom() {
    if (!state || busy) return;
    const active = state.room.status === 'playing';
    const message = isHost()
      ? '你是房主，退出会结束这个房间。确定退出吗？'
      : active ? '对局正在进行，退出会结束本场。确定退出吗？' : '确定退出这个房间吗？';
    if (!confirm(message)) return;
    busy = true;
    try {
      await api(isHost() ? 'close_room' : 'leave_room',{room_id:state.room.id});
      sendEvent('state_changed',{at:Date.now()});
      exitToHome(isHost() ? '房间已结束' : '已退出房间');
    } catch (err) { toast(err.message); }
    finally { busy = false; }
  }

  async function mutate(action,payload = {}) {
    if (!state || busy) return;
    busy = true;
    updateActions();
    const roomId = state.room.id;
    try {
      const data = await api(action,{room_id:roomId,...payload});
      if (data.state) adoptState(data.state);
    } catch (err) {
      if (err.status === 409 || err.code === 'STALE_VERSION') {
        toast('牌局刚刚更新，已重新同步');
        requestState(0);
      } else if (!err.cancelled) {
        toast(err.message || '操作失败');
      }
    } finally {
      busy = false;
      updateActions();
    }
  }

  function renderState() {
    if (!state) return;
    if (['closed','abandoned'].includes(state.room.status)) {
      exitToHome(state.room.status === 'closed' ? '房间已结束' : '本场因玩家退出而结束');
      return;
    }
    if (state.room.status === 'lobby') {
      show('roomScreen');
      renderRoom();
    } else if (state.room.status === 'finished' || state.room.phase === 'finished') {
      show('finishScreen');
      renderFinish();
    } else {
      show('gameScreen');
      renderGame();
    }
    updateConnection();
  }

  function renderRoom() {
    $('roomCode').textContent = state.room.code;
    $('playerCount').textContent = `${state.players.length} / 3`;
    $('rulesText').textContent = `${state.room.round_limit} 局 · 每次决定 20 秒 · 超时自动停牌 · 庄家 17 点停牌 · Blackjack +3`;
    const list = $('players');
    list.replaceChildren();
    for (const player of state.players) {
      const row = document.createElement('div');
      row.className = 'player-row';
      const avatar = document.createElement('div');
      avatar.className = 'avatar';
      avatar.style.setProperty('--avatar',safeColor(player.color));
      avatar.textContent = String(player.nickname || '友').slice(0,1);
      const copy = document.createElement('div');
      copy.className = 'player-copy';
      const name = document.createElement('b');
      name.textContent = player.nickname || '好友';
      const info = document.createElement('small');
      const online = presenceMembers.has(String(player.member_id));
      info.textContent = `座位 ${player.seat} · ${online ? '在线' : '等待连接'}`;
      copy.append(name,info);
      const badge = document.createElement('span');
      badge.className = player.ready ? 'ready-badge' : 'not-ready';
      badge.textContent = player.ready ? '✓ 已准备' : '未准备';
      row.append(avatar,copy,badge);
      list.append(row);
    }
    const mine = myPlayer();
    $('readyBtn').classList.toggle('hidden',isHost());
    $('readyBtn').textContent = mine?.ready ? '取消准备' : '我准备好了';
    const everyoneReady = state.players.length >= 2 && state.players.length <= 3 &&
      state.players.every((p) => p.ready || String(p.member_id) === String(state.room.host_member_id));
    $('startBtn').classList.toggle('hidden',!isHost());
    $('startBtn').disabled = !everyoneReady || busy;
    $('lobbyHint').textContent = isHost()
      ? (everyoneReady ? '大家都准备好了，可以开始。' : '至少 2 人，等待其他玩家准备。')
      : (mine?.ready ? '已准备，等待房主开始。' : '准备好后，等待房主开始。');
  }

  function renderGame() {
    $('roundLabel').textContent = `第 ${state.room.current_round} / ${state.room.round_limit} 局`;
    $('phaseLabel').textContent = state.room.phase === 'settlement' ? '本局结算' : '同时行动';
    renderHand($('dealerHand'),state.dealer.cards || []);
    $('dealerValue').textContent = state.dealer.value == null ? '?' : String(state.dealer.value);

    const table = $('playerTable');
    table.replaceChildren();
    for (const player of state.players) {
      const seat = document.createElement('article');
      seat.className = 'player-seat' + (String(player.member_id) === String(me?.id) ? ' me' : '');
      const left = document.createElement('div');
      const head = document.createElement('div');
      head.className = 'seat-head';
      const name = document.createElement('b');
      name.textContent = player.nickname || '好友';
      const score = document.createElement('span');
      score.className = 'seat-score';
      score.textContent = `${player.score} 分`;
      head.append(name,score);
      const status = document.createElement('div');
      status.className = 'seat-status';
      status.textContent = player.result && state.room.phase === 'settlement'
        ? resultText(player)
        : `${STATUS_TEXT[player.hand_status] || '等待'}${player.hand_value == null ? '' : ` · ${player.hand_value}`}`;
      left.append(head,status);
      const hand = document.createElement('div');
      hand.className = 'hand';
      renderHand(hand,player.hand_cards || []);
      seat.append(left,hand);
      table.append(seat);
    }

    const mine = myPlayer();
    $('myValue').textContent = mine?.hand_value == null ? '--' : String(mine.hand_value);
    if (state.room.phase === 'settlement') {
      const dealerText = state.dealer.status === 'bust' ? `庄家 ${state.dealer.value} 点爆牌` :
        state.dealer.status === 'blackjack' ? '庄家 Blackjack' : `庄家 ${state.dealer.value} 点`;
      $('tableMessage').textContent = `${dealerText} · 下一局即将开始`;
    } else if (!mine) {
      $('tableMessage').textContent = '正在同步你的座位…';
    } else if (mine.hand_status === 'active') {
      $('tableMessage').textContent = '请选择要牌或停牌';
    } else if (mine.hand_status === 'blackjack') {
      $('tableMessage').textContent = 'Blackjack！等待其他好友完成';
    } else if (mine.hand_status === 'bust') {
      $('tableMessage').textContent = '你爆牌了，等待其他好友完成';
    } else {
      $('tableMessage').textContent = '你已停牌，等待其他好友完成';
    }
    updateActions();
    tick();
  }

  function renderFinish() {
    const sorted = [...state.players].sort((a,b) => Number(b.score)-Number(a.score) || Number(a.seat)-Number(b.seat));
    const ranking = $('ranking');
    ranking.replaceChildren();
    sorted.forEach((player,index) => {
      const row = document.createElement('div');
      row.className = 'rank-row';
      const no = document.createElement('span');
      no.className = 'rank-no';
      no.textContent = index === 0 ? '🥇' : String(index + 1);
      const name = document.createElement('span');
      name.className = 'rank-name';
      name.textContent = player.nickname || '好友';
      const score = document.createElement('strong');
      score.className = 'rank-score';
      score.textContent = `${player.score} 分`;
      row.append(no,name,score);
      ranking.append(row);
    });
    $('finishSubtitle').textContent = `${state.room.round_limit} 局结束 · 最终积分`;
    $('againBtn').classList.toggle('hidden',!isHost());
    $('againBtn').disabled = busy;
  }

  function updateActions() {
    const mine = myPlayer();
    const active = Boolean(state && state.room.phase === 'player_action' && mine?.hand_status === 'active' && !busy);
    $('hitBtn').disabled = !active;
    $('standBtn').disabled = !active;
    if ($('readyBtn')) $('readyBtn').disabled = busy;
  }

  function resultText(player) {
    const delta = Number(player.round_delta || 0);
    if (player.result === 'win') return `胜 · +${delta}`;
    if (player.result === 'push') return '和 · 0';
    return `负 · ${delta}`;
  }

  function safeColor(value) {
    const color = String(value || '');
    return /^#[0-9a-f]{6}$/i.test(color) ? color : '#4b8e76';
  }

  function renderHand(container,cards) {
    container.replaceChildren();
    for (const code of cards) container.append(createCard(code));
  }

  function createCard(code) {
    const card = document.createElement('div');
    card.className = 'card';
    if (code === 'BACK') {
      card.classList.add('back');
      card.setAttribute('aria-label','暗牌');
      return card;
    }
    const text = String(code || '');
    const suitCode = text.slice(-1);
    const rank = text.slice(0,-1);
    const suit = SUITS[suitCode] || '?';
    if (suitCode === 'H' || suitCode === 'D') card.classList.add('red');
    const rankEl = document.createElement('span');
    rankEl.className = 'rank';
    rankEl.textContent = rank;
    const suitEl = document.createElement('span');
    suitEl.className = 'suit';
    suitEl.textContent = suit;
    const center = document.createElement('span');
    center.className = 'center';
    center.textContent = suit;
    card.append(rankEl,suitEl,center);
    card.setAttribute('aria-label',`${rank}${suit}`);
    return card;
  }

  function tick() {
    if (!state) return;
    const now = Date.now() + clockOffset;
    const mine = myPlayer();
    if (state.room.phase === 'player_action' && mine?.hand_status === 'active' && mine.decision_deadline) {
      const ms = Date.parse(mine.decision_deadline) - now;
      const seconds = Math.max(0,Math.ceil(ms/1000));
      $('countdown').textContent = String(seconds);
      $('countdown').classList.toggle('critical',seconds <= 5);
      if (ms <= 0 && !timeoutRequested && !busy) {
        timeoutRequested = true;
        mutate('timeout').finally(() => { timeoutRequested = false; });
      }
    } else {
      $('countdown').textContent = '--';
      $('countdown').classList.remove('critical');
    }
    if (state.room.phase === 'settlement' && state.room.summary_until) {
      const ms = Date.parse(state.room.summary_until) - now;
      if (ms <= 0 && !advanceRequested && !busy) {
        advanceRequested = true;
        mutate('advance_round',{action_id:makeId()}).finally(() => {
          if (state?.room.phase === 'settlement') advanceRequested = false;
        });
      }
    }
  }

  function startTimers() {
    if (!state || suspended) return;
    clearInterval(clockTimer);
    clockTimer = setInterval(tick,250);
    setPollInterval(isRealtimeHealthy() ? 3500 : 1200);
  }

  function setPollInterval(ms) {
    if (pollTimer && pollMs === ms) return;
    clearInterval(pollTimer);
    pollMs = ms;
    pollTimer = setInterval(refreshState,ms);
  }

  function requestState(delay = 80) {
    if (!state || suspended || navigator.onLine === false) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshState,delay);
  }

  async function refreshState() {
    if (!state || busy || suspended || navigator.onLine === false) return;
    const roomId = state.room.id;
    try {
      const data = await api('state',{room_id:roomId});
      if (state?.room.id === roomId && data.state) adoptState(data.state);
    } catch (err) {
      if (err.cancelled) return;
      if ([403,404,410].includes(err.status) || /房间.*(结束|不存在)|不在这个房间/.test(err.message || '')) {
        exitToHome(err.message || '房间已结束');
      }
    }
  }

  async function connectRealtime() {
    if (!state || suspended || navigator.onLine === false || !window.supabase?.createClient) return;
    leaveRealtime(false);
    const epoch = roomEpoch;
    const roomId = state.room.id;
    const auth = await ToolboxAuth.getSession();
    if (!auth || epoch !== roomEpoch) return;
    realtimeStatus = 'CONNECTING';
    realtime = window.supabase.createClient(ToolboxAuth.url,ToolboxAuth.key,{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      realtime:{heartbeatCallback:(status) => {
        if (epoch !== roomEpoch) return;
        if (status === 'ok') {
          serverHeartbeatAt = Date.now();
          if (realtimeStatus === 'SUBSCRIBED') {
            reconnectAttempt = 0;
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
          }
        } else if (['timeout','error','disconnected'].includes(status)) {
          scheduleReconnect(1200);
        }
        updateConnection();
      }},
    });
    await realtime.realtime.setAuth(auth.access_token);
    if (epoch !== roomEpoch || !state || state.room.id !== roomId) return;

    channel = realtime.channel(`blackjack:${roomId}`,{
      config:{private:true,presence:{key:auth.user.id},broadcast:{ack:false,self:false}},
    });
    channel.on('broadcast',{event:'state_snapshot'},({payload}) => {
      if (epoch !== roomEpoch || !validSnapshot(payload) || payload.room.id !== roomId) return;
      adoptState(payload);
    });
    channel.on('broadcast',{event:'state_changed'},() => requestState(30));
    channel.on('broadcast',{event:'emoji'},({payload}) => {
      if (payload?.emoji && typeof payload.emoji === 'string') showEmoji(payload.emoji);
    });
    channel.on('broadcast',{event:'ping'},({payload}) => {
      if (!payload?.id || payload.member_id === String(me?.id)) return;
      sendEvent('pong',{id:payload.id,target:payload.member_id,member_id:String(me?.id)});
    });
    channel.on('broadcast',{event:'pong'},({payload}) => {
      const sent = pendingPings.get(payload?.id);
      if (!sent || payload.target !== String(me?.id)) return;
      pendingPings.delete(payload.id);
      realtimeRtt = Math.max(0,Date.now()-sent);
      updateConnection();
    });
    channel.on('presence',{event:'sync'},() => {
      if (epoch !== roomEpoch || !channel) return;
      presenceMembers = new Set(Object.values(channel.presenceState()).flat().map((x) => String(x.member_id)));
      if (state?.room.status === 'lobby') renderRoom();
    });
    channel.on('presence',{event:'join'},() => requestState(100));
    channel.on('presence',{event:'leave'},() => requestState(100));
    channel.subscribe(async (status) => {
      if (epoch !== roomEpoch) return;
      realtimeStatus = status;
      if (status === 'SUBSCRIBED') {
        serverHeartbeatAt = Date.now();
        reconnectAttempt = 0;
        try { await channel.track({member_id:String(me.id),nickname:me.nickname,online_at:new Date().toISOString()}); } catch {}
        startPing();
        requestState(0);
      } else if (['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)) {
        scheduleReconnect(1500);
      }
      updateConnection();
    });
  }

  function isRealtimeHealthy() {
    return realtimeStatus === 'SUBSCRIBED' && Date.now()-serverHeartbeatAt < 65000 && navigator.onLine !== false;
  }

  function updateConnection() {
    const healthy = isRealtimeHealthy();
    setPollInterval(healthy ? 3500 : 1200);
    const label = healthy ? (Number.isFinite(realtimeRtt) ? `实时在线 · ${Math.round(realtimeRtt)}ms` : '实时在线') : '同步恢复中';
    for (const id of ['connectionStatus','gameConnectionStatus']) {
      const el = $(id);
      if (!el) continue;
      el.textContent = label;
      el.classList.toggle('online',healthy);
    }
  }

  function startPing() {
    clearInterval(pingTimer);
    sendPing();
    pingTimer = setInterval(sendPing,3000);
  }

  function sendPing() {
    if (!channel || realtimeStatus !== 'SUBSCRIBED' || document.hidden) return;
    const id = makeId();
    pendingPings.set(id,Date.now());
    for (const [key,at] of pendingPings) if (Date.now()-at > 10000) pendingPings.delete(key);
    sendEvent('ping',{id,member_id:String(me?.id)});
  }

  function sendEvent(event,payload) {
    if (!channel || realtimeStatus !== 'SUBSCRIBED') return Promise.resolve('not_connected');
    return channel.send({type:'broadcast',event,payload}).catch(() => 'error');
  }

  function sendEmoji(emoji) {
    showEmoji(emoji);
    sendEvent('emoji',{emoji:String(emoji).slice(0,4),member_id:String(me?.id)});
  }

  function showEmoji(emoji) {
    const el = $('emojiFloat');
    el.textContent = String(emoji).slice(0,4);
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  function scheduleReconnect(base = 0) {
    if (reconnectTimer || suspended || !state || navigator.onLine === false) return;
    const epoch = roomEpoch;
    const jitter = 250 + Math.random()*Math.min(9000,500*2**Math.min(4,reconnectAttempt++));
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      if (epoch !== roomEpoch) return;
      try { await connectRealtime(); } catch { scheduleReconnect(1200); }
    },base+jitter);
  }

  function leaveRealtime(stopPoll = true) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    clearInterval(pingTimer);
    pingTimer = null;
    pendingPings.clear();
    realtimeRtt = null;
    serverHeartbeatAt = 0;
    realtimeStatus = 'CLOSED';
    const old = realtime;
    channel = realtime = null;
    if (old) {
      Promise.resolve(old.removeAllChannels()).finally(() => old.realtime.disconnect()).catch(() => {});
    }
    if (stopPoll) {
      clearInterval(pollTimer);
      pollTimer = null;
      pollMs = 0;
    }
  }

  function resumeRoom() {
    if (!state || document.hidden || navigator.onLine === false) return;
    suspended = false;
    startTimers();
    requestState(0);
    if (!isRealtimeHealthy()) connectRealtime().catch(() => scheduleReconnect(500));
  }

  async function shareRoom() {
    if (!state) return;
    const url = new URL('https://zhao-toolbox-secure.pages.dev/blackjack/');
    url.searchParams.set('room',state.room.code);
    const text = `来玩朋友21点，房间码 ${state.room.code}`;
    try {
      if (navigator.share) await navigator.share({title:'朋友21点',text,url:url.toString()});
      else {
        await navigator.clipboard.writeText(url.toString());
        toast('邀请链接已复制');
      }
    } catch (err) {
      if (err?.name !== 'AbortError') toast('复制失败，请手动分享房间码');
    }
  }

  bind();
  initialize();
})();
