(() => {
  'use strict';

  const FUNCTION_URL = `${ToolboxAuth.url}/functions/v1/blackjack-game`;
  const $ = (id) => document.getElementById(id);
  const SCREENS = ['authScreen','recoveryScreen','homeScreen','roomScreen','gameScreen','finishScreen'];
  const SUITS = {S:'♠',H:'♥',D:'♦',C:'♣'};
  const STATUS_TEXT = {active:'思考中',stand:'已停牌',bust:'爆牌',blackjack:'Blackjack',none:'等待开局'};
  const HEALTHY_POLL_MS = 12000;
  const DEGRADED_POLL_MS = 1200;
  const PING_MS = 6000;
  const DEVICE_KEY = 'toolbox_blackjack_device_v12';

  let session = null;
  let sdkPromise = null;
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
  const playerSeatNodes = new Map();
  let lastActionRtt = null;
  let lastRenderCost = null;
  let historyLoading = false;
  let deviceId = null;
  let deviceControl = 'UNKNOWN';
  let pendingGameAction = null;
  let resyncing = false;
  let stateRefreshPromise = null;
  let refreshQueued = false;

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
  function getDeviceId() {
    if (deviceId) return deviceId;
    try {
      const saved = localStorage.getItem(DEVICE_KEY);
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved || '')) {
        deviceId = saved;
        return deviceId;
      }
    } catch {}
    deviceId = makeId();
    try { localStorage.setItem(DEVICE_KEY,deviceId); } catch {}
    return deviceId;
  }

  async function claimDevice(takeover = false) {
    if (!state) return false;
    try {
      const data = await api('claim_device',{
        room_id:state.room.id,
        device_id:getDeviceId(),
        takeover,
      });
      deviceControl = data.device?.granted ? 'OWNED' : 'PASSIVE';
      updateActions();
      if (state?.room.status === 'playing') renderGame();
      return deviceControl === 'OWNED';
    } catch (err) {
      if (err.code === 'DEVICE_CONFLICT') {
        deviceControl = 'PASSIVE';
        updateActions();
        if (state?.room.status === 'playing') renderGame();
        return false;
      }
      throw err;
    }
  }

  async function takeoverDevice() {
    if (!state || busy) return;
    const ok = await claimDevice(true).catch((err) => {
      toast(err.message || '接管失败');
      return false;
    });
    if (ok) {
      toast('已切换为当前设备操作');
      requestState(0,true);
    }
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
      loadHistory().catch(() => {});
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
    $('historyRefreshBtn').onclick = () => loadHistory(true);
    $('createBtn').onclick = async () => {
      if (busy) return;
      busy = true;
      $('createBtn').disabled = true;
      try {
        ensureRealtimeSDK().catch(() => {});
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
    $('takeoverBtn').onclick = takeoverDevice;
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
      ensureRealtimeSDK().catch(() => {});
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
    deviceControl = 'UNKNOWN';
    adoptState(next);
    setURL(next.room.code);
    $('shareBtn').classList.remove('hidden');
    $('leaveBtn').classList.remove('hidden');
    const claim = claimDevice(false).catch(() => false);
    const realtimeConnect = connectRealtime().catch(() => { scheduleReconnect(400); return false; });
    await Promise.allSettled([claim,realtimeConnect]);
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
    deviceControl = 'UNKNOWN';
    pendingGameAction = null;
    resyncing = false;
    stateRefreshPromise = null;
    refreshQueued = false;
    playerSeatNodes.clear();
    $('playerTable').replaceChildren();
    presenceMembers.clear();
    setURL('');
    $('shareBtn').classList.add('hidden');
    $('leaveBtn').classList.add('hidden');
  }

  function exitToHome(message = '') {
    clearRoom();
    show('homeScreen');
    loadHistory().catch(() => {});
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
    const gameplayAction = action === 'hit' || action === 'stand';
    if (gameplayAction && deviceControl === 'PASSIVE') {
      toast('当前由另一台设备操作，可点击“接管操作”切换');
      return;
    }
    busy = true;
    pendingGameAction = gameplayAction ? action : null;
    updateActions();
    if (state?.room.status === 'playing') renderGame();
    const roomId = state.room.id;
    const startedAt = performance.now();
    try {
      const extra = gameplayAction ? {device_id:getDeviceId()} : {};
      const data = await api(action,{room_id:roomId,...payload,...extra});
      lastActionRtt = Math.round(performance.now()-startedAt);
      pendingGameAction = null;
      if (data.state) adoptState(data.state);
    } catch (err) {
      pendingGameAction = null;
      if (err.code === 'DEVICE_CONFLICT') {
        deviceControl = 'PASSIVE';
        toast('此牌局正在另一台设备操作');
        requestState(0,true);
      } else if (err.status === 409 || err.code === 'STALE_ACTION') {
        toast('牌局刚刚更新，已重新同步');
        requestState(0,true);
      } else if (!err.cancelled) {
        toast(err.message || '操作失败');
      }
    } finally {
      busy = false;
      updateActions();
      if (state?.room.status === 'playing') renderGame();
    }
  }

  function historyStatusText(status) {
    if (status === 'finished') return '已完成';
    if (status === 'abandoned') return '中断';
    return '提前结束';
  }

  function formatHistoryTime(value) {
    const date = new Date(value || 0);
    if (!Number.isFinite(date.getTime())) return '--';
    return new Intl.DateTimeFormat('zh-CN',{
      month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,
    }).format(date);
  }

  function prettyCard(code) {
    const text = String(code || '');
    const suitCode = text.slice(-1);
    const rank = text.slice(0,-1);
    return `${rank}${SUITS[suitCode] || ''}`;
  }

  function playerSummaryText(player) {
    const result = player.result === 'win' ? '胜' : player.result === 'push' ? '和' : player.result === 'loss' ? '负' : '';
    const delta = Number(player.round_delta || 0);
    const deltaText = result ? ` ${result} ${delta > 0 ? '+' : ''}${delta}` : '';
    const cards = Array.isArray(player.hand_cards) ? player.hand_cards.map(prettyCard).join(' ') : '';
    const value = player.hand_value == null ? '' : ` · ${player.hand_value}点`;
    return `${player.nickname || '好友'}：${cards}${value}${deltaText}`;
  }

  async function loadHistory(showToast = false) {
    if (historyLoading || !me) return;
    historyLoading = true;
    $('historyRefreshBtn').disabled = true;
    try {
      const data = await api('history',{limit:12});
      renderHistory(Array.isArray(data.history) ? data.history : []);
      if (showToast) toast('对局记录已刷新');
    } catch (err) {
      if (showToast) toast(err.message || '对局记录加载失败');
    } finally {
      historyLoading = false;
      $('historyRefreshBtn').disabled = false;
    }
  }

  function renderHistory(records) {
    const list = $('historyList');
    list.replaceChildren();
    $('historyEmpty').classList.toggle('hidden',records.length > 0);

    for (const record of records) {
      const details = document.createElement('details');
      details.className = 'history-item';

      const summary = document.createElement('summary');
      const top = document.createElement('div');
      top.className = 'history-summary-top';
      const time = document.createElement('strong');
      time.textContent = formatHistoryTime(record.finished_at || record.started_at);
      const badge = document.createElement('span');
      badge.className = `history-status ${record.status || 'closed'}`;
      badge.textContent = historyStatusText(record.status);
      top.append(time,badge);

      const players = Array.isArray(record.players) ? [...record.players] : [];
      players.sort((a,b) => Number(b.score || 0)-Number(a.score || 0) || Number(a.seat || 0)-Number(b.seat || 0));
      const scoreline = document.createElement('div');
      scoreline.className = 'history-scoreline';
      scoreline.textContent = players.length
        ? players.map((p) => `${p.nickname || '好友'} ${Number(p.score || 0)}`).join(' · ')
        : `${Number(record.round_limit || 0)} 局`;

      summary.append(top,scoreline);
      details.append(summary);

      const body = document.createElement('div');
      body.className = 'history-rounds';
      const rounds = Array.isArray(record.rounds) ? record.rounds : [];

      if (!rounds.length) {
        const empty = document.createElement('p');
        empty.className = 'history-round-empty';
        empty.textContent = record.status === 'finished' ? '暂无逐局数据。' : '本场在完成一局前结束。';
        body.append(empty);
      }

      for (const round of rounds) {
        const row = document.createElement('section');
        row.className = 'history-round';
        const title = document.createElement('div');
        title.className = 'history-round-title';
        const dealer = round?.dealer || {};
        const dealerCards = Array.isArray(dealer.cards) ? dealer.cards.map(prettyCard).join(' ') : '';
        title.textContent = `第 ${Number(round.round || 0)} 局 · 庄家 ${dealerCards}${dealer.value == null ? '' : ` · ${dealer.value}点`}`;
        row.append(title);

        const roundPlayers = Array.isArray(round.players) ? round.players : [];
        for (const player of roundPlayers) {
          const line = document.createElement('div');
          line.className = 'history-player-line';
          line.textContent = playerSummaryText(player);
          row.append(line);
        }
        body.append(row);
      }

      const meta = document.createElement('div');
      meta.className = 'history-meta';
      meta.textContent = `${Number(record.round_limit || 0)} 局制 · 房间 ${String(record.room_code || '------')}`;
      body.append(meta);

      details.append(body);
      list.append(details);
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

  function createPlayerSeatNode() {
    const seat = document.createElement('article');
    const left = document.createElement('div');
    const head = document.createElement('div');
    head.className = 'seat-head';
    const name = document.createElement('b');
    const score = document.createElement('span');
    score.className = 'seat-score';
    head.append(name,score);
    const status = document.createElement('div');
    status.className = 'seat-status';
    left.append(head,status);
    const hand = document.createElement('div');
    hand.className = 'hand';
    seat.append(left,hand);
    return {seat,name,score,status,hand};
  }

  function renderGame() {
    const renderStartedAt = performance.now();
    $('roundLabel').textContent = `第 ${state.room.current_round} / ${state.room.round_limit} 局`;
    $('phaseLabel').textContent = state.room.phase === 'settlement' ? '本局结算' : '同时行动';
    renderHand($('dealerHand'),state.dealer.cards || []);
    $('dealerValue').textContent = state.dealer.value == null ? '?' : String(state.dealer.value);

    const table = $('playerTable');
    const wanted = new Set();
    for (const player of state.players) {
      const key = String(player.member_id);
      wanted.add(key);
      let node = playerSeatNodes.get(key);
      if (!node) {
        node = createPlayerSeatNode();
        playerSeatNodes.set(key,node);
      }
      node.seat.className = 'player-seat' + (key === String(me?.id) ? ' me' : '');
      node.name.textContent = player.nickname || '好友';
      node.score.textContent = `${player.score} 分`;
      node.status.textContent = player.result && state.room.phase === 'settlement'
        ? resultText(player)
        : `${STATUS_TEXT[player.hand_status] || '等待'}${player.hand_value == null ? '' : ` · ${player.hand_value}`}`;
      renderHand(node.hand,player.hand_cards || []);
      table.append(node.seat);
    }
    for (const [key,node] of playerSeatNodes) {
      if (wanted.has(key)) continue;
      node.seat.remove();
      playerSeatNodes.delete(key);
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
    lastRenderCost = Math.round((performance.now()-renderStartedAt)*10)/10;
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
    const desired = cards.map((code) => String(code));
    for (let i=0;i<desired.length;i++) {
      const current = container.children[i];
      if (current?.dataset.code === desired[i]) continue;
      const card = createCard(desired[i]);
      if (current) current.replaceWith(card);
      else container.append(card);
    }
    while (container.children.length > desired.length) container.lastElementChild.remove();
  }

  function createCard(code) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.code = String(code);
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

  function scheduleClockTick(delay = 0) {
    clearTimeout(clockTimer);
    if (!state || suspended) return;
    clockTimer = setTimeout(() => {
      tick();
      if (!state || suspended) return;
      const now = Date.now() + clockOffset;
      const mine = myPlayer();
      const decisionMs = state.room.phase === 'player_action' && mine?.hand_status === 'active' && mine.decision_deadline
        ? Date.parse(mine.decision_deadline)-now
        : Infinity;
      const summaryMs = state.room.phase === 'settlement' && state.room.summary_until
        ? Date.parse(state.room.summary_until)-now
        : Infinity;
      scheduleClockTick(Math.min(decisionMs,summaryMs) <= 3000 ? 250 : 1000);
    },delay);
  }

  function startTimers() {
    if (!state || suspended) return;
    scheduleClockTick(0);
    setPollInterval(isRealtimeHealthy() ? HEALTHY_POLL_MS : DEGRADED_POLL_MS);
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

  function ensureRealtimeSDK() {
    if (window.supabase?.createClient) return Promise.resolve();
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve,reject) => {
      const script = document.createElement('script');
      const finish = (err) => {
        clearTimeout(timer);
        script.onload = script.onerror = null;
        if (err) { script.remove(); reject(err); } else resolve();
      };
      const timer = setTimeout(() => finish(new Error('实时连接组件加载超时')),8000);
      script.src = '../shared/vendor/supabase-2.57.4.min.js';
      script.integrity = 'sha384-AkNSQdptcXlJ0/NBZc4qGk86cDVXcCevwoWgEKIpHOEfbvlXGLlIkimQtONt8KNf';
      script.onload = () => finish(window.supabase?.createClient ? null : new Error('实时连接组件加载失败'));
      script.onerror = () => finish(new Error('实时连接组件加载失败'));
      document.head.appendChild(script);
    }).catch((err) => { sdkPromise = null; throw err; });
    return sdkPromise;
  }

  async function connectRealtime() {
    if (!state || suspended || navigator.onLine === false) return;
    await ensureRealtimeSDK();
    if (!state || suspended || navigator.onLine === false) return;
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
    setPollInterval(healthy ? HEALTHY_POLL_MS : DEGRADED_POLL_MS);
    const network = Number.isFinite(realtimeRtt) ? `${Math.round(realtimeRtt)}ms` : null;
    const action = Number.isFinite(lastActionRtt) ? `操作 ${lastActionRtt}ms` : null;
    const label = healthy ? ['实时在线',network,action].filter(Boolean).join(' · ') : '同步恢复中';
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
    pingTimer = setInterval(sendPing,PING_MS);
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
