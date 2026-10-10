(() => {
  'use strict';

  const FUNCTION_URL = `${ToolboxAuth.url}/functions/v1/blackjack-game?forceFunctionRegion=ap-southeast-1`;
  const $ = (id) => document.getElementById(id);
  const SCREENS = ['authScreen','recoveryScreen','homeScreen','roomScreen','gameScreen','finishScreen'];
  const SUITS = {S:'♠',H:'♥',D:'♦',C:'♣'};
  const STATUS_TEXT = {active:'思考中',stand:'已停牌',bust:'爆牌',blackjack:'黑杰克',none:'等待开局'};
  const HEALTHY_POLL_MS = 20000;
  const DEGRADED_POLL_STEPS = [[5000,1500],[15000,2500],[Infinity,4000]];
  const RECONNECT_GRACE_MS = 5000;
  const DEVICE_KEY = 'toolbox_blackjack_device_v12';
  const SOUND_KEY = 'toolbox_blackjack_sound_v15';
  const IMMERSIVE_KEY = 'toolbox_blackjack_immersive_v173';
  const DEAL_FLIGHT_MAX = 5;
  const PRESENTATION_MAX = 8;
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const lowPowerMode = Boolean(
    navigator.connection?.saveData ||
    (Number.isFinite(navigator.deviceMemory) && navigator.deviceMemory <= 4) ||
    (Number.isFinite(navigator.hardwareConcurrency) && navigator.hardwareConcurrency <= 4)
  );

  let session = null;
  let sdkPromise = null;
  let me = null;
  let state = null;
  let roomEpoch = 0;
  let busy = false;
  let loginBusy = false;
  let realtime = null;
  let channel = null;
  let realtimeConnectEpoch = 0;
  let realtimeStatus = 'CLOSED';
  let realtimeRtt = null;
  let heartbeatSentAt = 0;
  let serverHeartbeatAt = 0;
  let degradedSince = 0;
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
  let lobbyPendingAction = null;
  let lobbyPendingWasReady = false;
  let resyncing = false;
  let stateRefreshPromise = null;
  let refreshQueued = false;
  let pendingBet = 0;
  let lastConfirmedBet = 0;
  let soundEnabled = true;
  let immersiveMode = false;
  let audioContext = null;
  const soundSamples = new Map();
  const activeDealFlights = new Set();
  let presentationQueue = [];
  let presentationBusy = false;
  let presentationGeneration = 0;
  let lastReactionAt = 0;

  document.documentElement.classList.toggle('low-power',lowPowerMode);

  function motionAllowed() {
    return !prefersReducedMotion?.matches && !lowPowerMode && !document.hidden;
  }

  function show(id) {
    SCREENS.forEach((name) => $(name).classList.toggle('active', name === id));
    $('soundBtn')?.classList.toggle('hidden',!['roomScreen','gameScreen','finishScreen'].includes(id));
    $('immersiveBtn')?.classList.toggle('hidden',id !== 'gameScreen');
    document.documentElement.classList.toggle('immersive-mode',immersiveMode && id === 'gameScreen');
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
  function activeHand(player = myPlayer()) {
    if (!player || !Array.isArray(player.hands)) return null;
    if (player.active_hand_id) {
      const byId = player.hands.find((hand) => String(hand.id) === String(player.active_hand_id));
      if (byId) return byId;
    }
    return player.hands.find((hand) => hand.status === 'active') || null;
  }
  function formatChips(value) {
    const n = Number(value || 0);
    return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/,'');
  }
  function pulseHaptic(pattern = 10) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch {}
  }
  function animateChipFlight(button) {
    if (!button || !motionAllowed()) return;
    if (document.querySelectorAll('.chip-flight').length >= 5) return;
    const target = $('pendingBet');
    if (!target) return;
    const from = button.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const clone = button.cloneNode(true);
    clone.classList.add('chip-flight');
    clone.disabled = true;
    clone.style.left = `${from.left}px`;
    clone.style.top = `${from.top}px`;
    clone.style.width = `${from.width}px`;
    clone.style.height = `${from.height}px`;
    document.body.append(clone);
    const dx = to.left + to.width/2 - (from.left + from.width/2);
    const dy = to.top + to.height/2 - (from.top + from.height/2);
    const animation = clone.animate([
      {transform:'translate3d(0,0,0) scale(1)',opacity:1},
      {transform:`translate3d(${dx*.72}px,${dy*.72-14}px,0) scale(.82)`,opacity:.94,offset:.72},
      {transform:`translate3d(${dx}px,${dy}px,0) scale(.56)`,opacity:0},
    ],{duration:280,easing:'cubic-bezier(.18,.78,.22,1)',fill:'forwards'});
    animation.finished.finally(() => clone.remove()).catch(() => clone.remove());
  }

  function loadPreferences() {
    try {
      soundEnabled = localStorage.getItem(SOUND_KEY) !== '0';
      immersiveMode = localStorage.getItem(IMMERSIVE_KEY) === '1';
    } catch {
      soundEnabled = true;
      immersiveMode = false;
    }
    updateSoundButton();
    updateImmersiveButton();
  }
  function updateImmersiveButton() {
    const button = $('immersiveBtn');
    if (!button) return;
    button.textContent = immersiveMode ? '⛶ 退出沉浸' : '⛶ 沉浸';
    button.setAttribute('aria-pressed',immersiveMode ? 'true' : 'false');
    button.title = immersiveMode ? '退出沉浸牌桌' : '开启沉浸牌桌';
  }
  function toggleImmersive() {
    immersiveMode = !immersiveMode;
    try { localStorage.setItem(IMMERSIVE_KEY,immersiveMode ? '1' : '0'); } catch {}
    updateImmersiveButton();
    document.documentElement.classList.toggle('immersive-mode',immersiveMode && $('gameScreen').classList.contains('active'));
    pulseHaptic(7);
    toast(immersiveMode ? '已开启沉浸牌桌' : '已返回标准牌桌');
  }
  function updateSoundButton() {
    const button = $('soundBtn');
    if (!button) return;
    button.textContent = soundEnabled ? '🔊' : '🔇';
    button.setAttribute('aria-pressed',soundEnabled ? 'false' : 'true');
    button.title = soundEnabled ? '关闭牌桌音效' : '开启牌桌音效';
  }
  function toggleSound() {
    soundEnabled = !soundEnabled;
    try { localStorage.setItem(SOUND_KEY,soundEnabled ? '1' : '0'); } catch {}
    updateSoundButton();
    if (soundEnabled) {
      ensureAudio();
      playSound('chip');
    }
  }
  function ensureAudio() {
    if (!soundEnabled) return null;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    if (!audioContext) audioContext = new AudioCtor();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    return audioContext;
  }
  // Procedural, cached material sounds: paper scrape, ceramic chip strike and
  // restrained victory chimes. No network audio downloads or persistent audio loop.
  function materialSound(ctx,kind) {
    const key = kind + ':' + ctx.sampleRate;
    if (soundSamples.has(key)) return soundSamples.get(key);
    const durations = {chip:.12,card:.11,flip:.16,blackjack:.24,win:.19,loss:.13};
    const duration = durations[kind] || .11;
    const buffer = ctx.createBuffer(1,Math.ceil(duration*ctx.sampleRate),ctx.sampleRate);
    const samples = buffer.getChannelData(0);
    let seed = 17 + kind.length*231;
    let previousNoise = 0;
    for (let i=0;i<samples.length;i++) {
      const t = i/ctx.sampleRate;
      const progress = t/duration;
      seed = (Math.imul(seed,1664525)+1013904223) >>> 0;
      const noise = (seed/4294967296)*2-1;
      const scrape = noise-previousNoise*.82;
      previousNoise = noise;
      const decay = Math.pow(Math.max(0,1-progress),2);
      let value = 0;
      if (kind === 'card') {
        value = (scrape*.5+Math.sin(t*1800)*.04)*decay;
      } else if (kind === 'flip') {
        value = (scrape*.26+Math.sin(2*Math.PI*210*t)*.07)*decay;
      } else if (kind === 'chip') {
        value = (Math.sin(2*Math.PI*1450*t)*.47+Math.sin(2*Math.PI*2450*t)*.21+scrape*.08)*Math.exp(-t*35);
      } else if (kind === 'blackjack' || kind === 'win') {
        const second = kind === 'blackjack' ? 1047 : 880;
        value = (Math.sin(2*Math.PI*659*t)*.38+
          Math.sin(2*Math.PI*second*t)*.25*(t>.045?1:.25))*Math.exp(-t*13);
      } else {
        value = (Math.sin(2*Math.PI*185*t)*.32+scrape*.06)*Math.exp(-t*30);
      }
      samples[i] = Math.max(-1,Math.min(1,value*decay));
    }
    soundSamples.set(key,buffer);
    return buffer;
  }
  function playSound(kind,memberId = null) {
    if (!soundEnabled || document.hidden) return;
    const ctx = ensureAudio();
    if (!ctx || ctx.state !== 'running') return;
    try {
      const source = ctx.createBufferSource();
      source.buffer = materialSound(ctx,kind);
      const gain = ctx.createGain();
      gain.gain.value = kind === 'card' ? .13 : kind === 'flip' ? .12 : kind === 'chip' ? .14 : .1;
      source.connect(gain);
      if (memberId && typeof ctx.createStereoPanner === 'function') {
        const pan = ctx.createStereoPanner();
        const slot = presentationTarget(memberId)?.className || '';
        pan.pan.value = slot.includes('seat-slot-left') ? -.24 : slot.includes('seat-slot-right') ? .24 : 0;
        gain.connect(pan);
        pan.connect(ctx.destination);
      } else {
        gain.connect(ctx.destination);
      }
      source.start();
    } catch {
      // Audio is optional; gameplay must never depend on playback success.
    }
  }
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve,ms));
  }
  function handMap(player) {
    return new Map((Array.isArray(player?.hands) ? player.hands : []).map((hand) => [String(hand.id),hand]));
  }
  function derivePresentation(previous,next) {
    if (!previous || previous.room?.id !== next.room?.id || document.hidden || resyncing || prefersReducedMotion?.matches) return [];
    const events = [];
    const previousPlayers = new Map(previous.players.map((player) => [String(player.member_id),player]));
    for (const player of next.players) {
      const before = previousPlayers.get(String(player.member_id));
      if (!before) continue;
      const oldHands = handMap(before);
      const newHands = handMap(player);
      if (!before.bet_locked && player.bet_locked) {
        events.push({type:'bet',member_id:String(player.member_id),name:player.nickname,amount:Number(player.current_bet || 0)});
      }
      if (!before.insurance_decided && player.insurance_decided) {
        events.push({type:'insurance',member_id:String(player.member_id),name:player.nickname,amount:Number(player.insurance_bet || 0)});
      }
      if (newHands.size > oldHands.size) events.push({type:'split',member_id:String(player.member_id),name:player.nickname});
      for (const [id,hand] of newHands) {
        const old = oldHands.get(id);
        if (!old) continue;
        if (!old.doubled && hand.doubled) events.push({type:'double',member_id:String(player.member_id),name:player.nickname});
        if ((hand.cards?.length || 0) > (old.cards?.length || 0)) {
          events.push({type:'card',member_id:String(player.member_id),name:player.nickname,index:(hand.cards?.length || 1)-1});
        }
        if (old.status === 'active' && hand.status === 'stand') events.push({type:'stand',member_id:String(player.member_id),name:player.nickname});
        if (old.status !== 'blackjack' && hand.status === 'blackjack') events.push({type:'blackjack',member_id:String(player.member_id),name:player.nickname});
        if (old.status !== 'bust' && hand.status === 'bust') events.push({type:'bust',member_id:String(player.member_id),name:player.nickname});
        if (old.status !== 'surrender' && hand.status === 'surrender') events.push({type:'surrender',member_id:String(player.member_id),name:player.nickname});
      }
    }
    const oldDealer = previous.dealer?.cards || [];
    const newDealer = next.dealer?.cards || [];
    if (oldDealer.includes('BACK') && !newDealer.includes('BACK') && newDealer.length) events.push({type:'reveal'});
    if (newDealer.length > oldDealer.length) {
      for (let index=oldDealer.length;index<newDealer.length;index++) events.push({type:'dealer_card',index});
    }
    if (previous.room?.phase === 'betting' && next.room?.phase !== 'betting') events.unshift({type:'deal'});
    if (previous.room?.phase !== 'settlement' && next.room?.phase === 'settlement') {
      events.push({
        type:'settle',
        settlements:next.players.map((player) => ({
          member_id:String(player.member_id),
          amount:Number(player.stack || 0)-Number(player.round_start_stack || 0),
        })),
      });
    }
    return events.slice(0,PRESENTATION_MAX);
  }
  function announce(message) {
    const el = $('tableFeed');
    if (!el || !message) return;
    el.textContent = message;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'),1800);
  }
  function presentationTarget(memberId) {
    return memberId ? playerSeatNodes.get(String(memberId))?.seat : null;
  }
  function chipFace(amount,index) {
    const absolute = Math.abs(Number(amount || 0));
    const values = absolute >= 250 ? [250,100,50] : absolute >= 100 ? [100,50,20] : absolute >= 50 ? [50,20,10] : [20,10,10];
    return values[index % values.length];
  }
  function animateChipTransfer(fromRect,toRect,amount,count = 3) {
    if (!fromRect || !toRect || !amount || !motionAllowed()) return;
    const total = lowPowerMode ? 1 : Math.min(4,count);
    for (let index=0;index<total;index++) {
      const chip = document.createElement('span');
      const face = chipFace(amount,index);
      chip.className = `payout-chip payout-chip-${face}`;
      chip.textContent = String(face);
      chip.style.left = `${fromRect.left+fromRect.width/2}px`;
      chip.style.top = `${fromRect.top+fromRect.height/2}px`;
      document.body.append(chip);
      const spread = (index-(total-1)/2)*8;
      const dx = toRect.left+toRect.width/2-(fromRect.left+fromRect.width/2)+spread;
      const dy = toRect.top+toRect.height/2-(fromRect.top+fromRect.height/2)-index*3;
      const animation = chip.animate([
        {transform:`translate3d(${spread*.2}px,0,0) rotate(${spread}deg) scale(.82)`,opacity:0},
        {transform:`translate3d(${spread*.2}px,-9px,0) rotate(${spread}deg) scale(1)`,opacity:1,offset:.14},
        {transform:`translate3d(${dx*.72}px,${dy*.72-12}px,0) rotate(${spread*1.8}deg) scale(.94)`,opacity:1,offset:.76},
        {transform:`translate3d(${dx}px,${dy}px,0) rotate(${spread*2.4}deg) scale(.78)`,opacity:0},
      ],{duration:430+index*45,delay:index*42,easing:'cubic-bezier(.18,.76,.2,1)',fill:'forwards'});
      animation.finished.finally(() => chip.remove()).catch(() => chip.remove());
    }
  }
  function animatePayout(net,memberId) {
    if (!net || !motionAllowed()) return;
    const target = presentationTarget(String(memberId || me?.id || ''));
    const dealer = $('dealerHand');
    if (!target || !dealer) return;
    const fromRect = (net > 0 ? dealer : target).getBoundingClientRect();
    const toRect = (net > 0 ? target : dealer).getBoundingClientRect();
    animateChipTransfer(fromRect,toRect,net,Math.min(4,Math.max(2,Math.ceil(Math.abs(net)/100))));
  }
  function animateBetCommit(amount,fromRect) {
    const target = presentationTarget(String(me?.id || ''))?.querySelector('.bet-spot');
    if (!target || !fromRect || !motionAllowed()) return;
    animateChipTransfer(fromRect,target.getBoundingClientRect(),amount,3);
  }

  async function playPresentation(item,generation) {
    if (generation !== presentationGeneration || document.hidden || !state) return;
    const target = presentationTarget(item.member_id);
    const pulse = async (element,className,duration=260) => {
      if (!element) return;
      element.classList.remove(className);
      void element.offsetWidth;
      element.classList.add(className);
      await sleep(duration);
      element.classList.remove(className);
    };
    if (item.type === 'deal') {
      playSound('card');
      announce('发牌');
      await pulse($('gameScreen'),'presentation-deal',220);
    } else if (item.type === 'card') {
      playSound('card',item.member_id);
      announce(`${item.name || '玩家'}要牌`);
      const card = target?.querySelector('.mini-hand.active .card:last-child') || target?.querySelector('.card:last-child');
      await pulse(card,'presentation-card',180);
    } else if (item.type === 'stand') {
      playSound('flip');
      announce(`${item.name || '玩家'}停牌`);
      await pulse(target,'stand-pulse',220);
    } else if (item.type === 'bet') {
      playSound('chip',item.member_id);
      announce(`${item.name || '玩家'}下注 ${formatChips(item.amount)}`);
      await pulse(target?.querySelector('.bet-spot'),'bet-pulse',240);
    } else if (item.type === 'insurance') {
      playSound('chip',item.member_id);
      announce(`${item.name || '玩家'}${item.amount > 0 ? '购买了保险' : '未购买保险'}`);
      await pulse(target,'insurance-pulse',220);
    } else if (item.type === 'reveal') {
      playSound('flip');
      announce('庄家翻开暗牌');
      await pulse($('dealerHand'),'dealer-reveal',300);
    } else if (item.type === 'dealer_card') {
      playSound('card');
      const card = $('dealerHand')?.children?.[item.index];
      await pulse(card,'presentation-card',150);
    } else if (item.type === 'split') {
      playSound('card');
      pulseHaptic(10);
      announce(`${item.name || '玩家'}进行了分牌`);
      await pulse(target,'split-pulse',300);
    } else if (item.type === 'double') {
      playSound('chip');
      pulseHaptic([8,25,8]);
      announce(`${item.name || '玩家'}选择加倍`);
      await pulse(target,'double-pulse',300);
    } else if (item.type === 'blackjack') {
      playSound('blackjack',item.member_id);
      pulseHaptic([10,35,16]);
      announce(`${item.name || '玩家'}拿到黑杰克`);
      await pulse(target,'blackjack-pulse',420);
    } else if (item.type === 'bust') {
      playSound('loss');
      announce(`${item.name || '玩家'}爆牌`);
      await pulse(target,'split-pulse',220);
    } else if (item.type === 'surrender') {
      playSound('chip');
      announce(`${item.name || '玩家'}选择投降`);
      await pulse(target,'split-pulse',220);
    } else if (item.type === 'settle') {
      const mine = nextPlayerForPresentation();
      const net = mine ? Number(mine.stack || 0)-Number(mine.round_start_stack || 0) : 0;
      playSound(net > 0 ? 'win' : net < 0 ? 'loss' : 'chip');
      const settlements = Array.isArray(item.settlements) ? item.settlements : [];
      const visible = lowPowerMode ? settlements.filter((entry) => entry.member_id === String(me?.id || '')) : settlements;
      visible.forEach((entry) => animatePayout(entry.amount,entry.member_id));
      await pulse($('gameScreen'),'settle-pulse',320);
    }
  }
  function nextPlayerForPresentation() {
    return myPlayer();
  }
  function enqueuePresentation(items) {
    if (!items?.length || !motionAllowed()) return;
    presentationQueue.push(...items);
    if (presentationQueue.length > PRESENTATION_MAX) presentationQueue = presentationQueue.slice(-PRESENTATION_MAX);
    if (presentationBusy) return;
    presentationBusy = true;
    const generation = presentationGeneration;
    (async () => {
      try {
        while (presentationQueue.length && generation === presentationGeneration && !document.hidden) {
          await playPresentation(presentationQueue.shift(),generation);
        }
      } finally {
        presentationBusy = false;
        if (generation !== presentationGeneration && presentationQueue.length && !document.hidden) {
          const pending = presentationQueue.splice(0,PRESENTATION_MAX);
          enqueuePresentation(pending);
        }
      }
    })();
  }
  function cancelPresentation() {
    presentationGeneration += 1;
    presentationQueue.length = 0;
    for (const finish of [...activeDealFlights]) finish();
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
    const previous = state;
    if(previous?.room?.id===next.room.id && Number(next.room.realtime_generation||0)<Number(previous.room.realtime_generation||0))return;
    const presentation = derivePresentation(previous,next);
    if (previous?.room?.status === 'finished' && next.room?.status === 'lobby') lastConfirmedBet = 0;
    state = next;
    if(previous?.room?.id===next.room.id && previous.room.realtime_token!==next.room.realtime_token && !suspended){
      leaveRealtime(false);
      connectRealtime().catch(()=>scheduleReconnect(RECONNECT_GRACE_MS));
    }
    const serverNow = Date.parse(next.server_now || '');
    if (Number.isFinite(serverNow)) clockOffset = serverNow - Date.now();
    timeoutRequested = false;
    if (next.room.phase !== 'settlement') advanceRequested = false;
    renderState();
    startTimers();
    enqueuePresentation(presentation);
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
      loadDashboard().catch(() => {});
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

  function betLimit() {
    const mine = myPlayer();
    return mine ? Math.min(Number(state?.room?.max_bet || 500),Number(mine.stack || 0)) : 0;
  }
  function setPendingBet(value,feedback = true) {
    const min = Number(state?.room?.min_bet || 10);
    const max = betLimit();
    if (!max) return;
    let next = Math.floor(Number(value || 0)/min)*min;
    next = Math.max(0,Math.min(next,max));
    pendingBet = next;
    if (feedback) {
      pulseHaptic(7);
      playSound('chip');
    }
    renderBetting();
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
    $('historyRefreshBtn').onclick = () => loadDashboard(true);
    $('soundBtn').onclick = toggleSound;
    $('immersiveBtn').onclick = toggleImmersive;
    document.addEventListener('pointerdown',() => { if (soundEnabled) ensureAudio(); },{once:true,passive:true});
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
      finally {
        busy = false;
        $('createBtn').disabled = false;
        if (state?.room.status === 'lobby') renderRoom();
        updateActions();
      }
    };
    $('joinForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      await joinRoom($('roomCodeInput').value);
    });
    $('readyBtn').onclick = () => mutate('toggle_ready');
    $('startBtn').onclick = () => mutate('start_game',{action_id:makeId()});
    $('hitBtn').onclick = () => casinoAction('hit');
    $('standBtn').onclick = () => casinoAction('stand');
    $('doubleBtn').onclick = () => casinoAction('double');
    $('splitBtn').onclick = () => casinoAction('split');
    $('surrenderBtn').onclick = () => casinoAction('surrender');
    $('takeoverBtn').onclick = takeoverDevice;
    $('chipRack').addEventListener('click',(event) => {
      const button = event.target.closest('[data-chip]');
      if (!button || !state || busy) return;
      const mine = myPlayer();
      if (!mine || mine.bet_locked) return;
      const chip = Number(button.dataset.chip || 0);
      const max = Math.min(Number(state.room.max_bet || 500),Number(mine.stack || 0));
      if (pendingBet + chip > max) {
        pulseHaptic([8,30,8]);
        toast('已达到本局可下注上限');
        return;
      }
      setPendingBet(pendingBet + chip,false);
      pulseHaptic(7);
      playSound('chip');
      animateChipFlight(button);
    });
    $('clearBetBtn').onclick = () => setPendingBet(0);
    $('repeatBetBtn').onclick = () => {
      if (!lastConfirmedBet) { toast('还没有上一局下注'); return; }
      setPendingBet(lastConfirmedBet);
    };
    $('halfBetBtn').onclick = () => setPendingBet(pendingBet/2);
    $('doubleBetBtn').onclick = () => setPendingBet(pendingBet*2);
    $('confirmBetBtn').onclick = () => confirmBet();
    $('takeInsuranceBtn').onclick = () => mutate('insurance',{take:true,action_id:makeId()});
    $('declineInsuranceBtn').onclick = () => mutate('insurance',{take:false,action_id:makeId()});
    $('againBtn').onclick = () => mutate('play_again');
    $('shareBtn').onclick = shareRoom;
    $('leaveBtn').onclick = leaveRoom;
    document.querySelector('.emoji-row').addEventListener('click',(event) => {
      const button = event.target.closest('[data-emoji]');
      if (button) sendEmoji(button.dataset.emoji);
    });
    document.addEventListener('visibilitychange',() => {
      suspended = document.hidden;
      if (suspended) cancelPresentation();
      else resumeRoom();
    });
    window.addEventListener('online',resumeRoom);
    window.addEventListener('offline',updateConnection);
    window.addEventListener('pageshow',(event) => {
      suspended = false;
      if (event.persisted) requestState(0,true);
      resumeRoom();
    });
    window.addEventListener('pagehide',(event) => {
      suspended = true;
      cancelPresentation();
      if (!event.persisted) leaveRealtime();
    });
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
    finally {
      busy = false;
      if (state?.room.status === 'lobby') renderRoom();
      updateActions();
    }
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
    // Background connections must not hold the lobby's ready/start controls hostage.
    const claim = claimDevice(false).catch(() => false);
    const realtimeConnect = connectRealtime().catch(() => { scheduleReconnect(400); return false; });
    void Promise.allSettled([claim,realtimeConnect]);
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
    lobbyPendingAction = null;
    resyncing = false;
    stateRefreshPromise = null;
    refreshQueued = false;
    pendingBet = 0;
    lastConfirmedBet = 0;
    cancelPresentation();
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
    loadDashboard().catch(() => {});
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

  async function casinoAction(action) {
    const hand = activeHand();
    if (!hand) return;
    return mutate(action,{
      hand_id:hand.id,
      expected_token:hand.action_token,
      action_id:makeId(),
    });
  }

  async function confirmBet() {
    const mine = myPlayer();
    if (!state || !mine || busy || state.room.phase !== 'betting' || mine.bet_locked) return;
    const min = Number(state.room.min_bet || 10);
    if (pendingBet < min) {
      toast(`最低下注 ${formatChips(min)}`);
      return;
    }
    const amount = pendingBet;
    const fromRect = $('pendingBet')?.getBoundingClientRect();
    pulseHaptic(12);
    playSound('chip');
    const ok = await mutate('bet',{amount,action_id:makeId()});
    if (ok) {
      lastConfirmedBet = amount;
      animateBetCommit(amount,fromRect);
    }
  }

  async function mutate(action,payload = {}) {
    if (!state || busy) return;
    const gameplayAction = ['hit','stand','double','split','surrender'].includes(action);
    if (gameplayAction && deviceControl === 'PASSIVE') {
      toast('当前由另一台设备操作，可点击“接管操作”切换');
      return;
    }
    busy = true;
    pendingGameAction = gameplayAction ? action : null;
    lobbyPendingAction = ['toggle_ready','start_game'].includes(action) ? action : null;
    lobbyPendingWasReady = Boolean(myPlayer()?.ready);
    updateActions();
    if (state?.room.status === 'lobby') renderRoom();
    if (state?.room.status === 'playing') renderGame();
    const roomId = state.room.id;
    const startedAt = performance.now();
    let succeeded = false;
    try {
      const extra = gameplayAction ? {device_id:getDeviceId()} : {};
      const data = await api(action,{room_id:roomId,...payload,...extra});
      lastActionRtt = Math.round(performance.now()-startedAt);
      pendingGameAction = null;
      if (action === 'bet') pendingBet = 0;
      if (data.state) adoptState(data.state);
      succeeded = true;
      if (action === 'toggle_ready') {
        toast(myPlayer()?.ready ? '准备成功，等待房主开始' : '已取消准备');
      } else if (action === 'start_game') {
        toast('游戏已开始，正在发牌…');
      }
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
        if (lobbyPendingAction && (err.retryable || err.status >= 500)) {
          toast('操作状态未确认，正在重新同步，请稍候');
          requestState(0,true);
        } else {
          toast(err.message || (lobbyPendingAction ? '操作失败，请重试' : '操作失败'));
        }
      }
    } finally {
      busy = false;
      lobbyPendingAction = null;
      updateActions();
      if (state?.room.status === 'lobby') renderRoom();
      if (state?.room.status === 'playing') renderGame();
    }
    return succeeded;
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
    const net = Number((player.net_chips ?? (Number(player.stack || 0)-Number(player.round_start_stack || 0))) || 0);
    const hands = Array.isArray(player.hands) ? player.hands : [];
    const handText = hands.length
      ? hands.map((hand) => {
          const cards = Array.isArray(hand.cards) ? hand.cards.map(prettyCard).join(' ') : '';
          const tag = hand.status === 'blackjack' ? '黑杰克' : hand.status === 'surrender' ? '投降' : hand.status === 'bust' ? '爆牌' : '';
          return `${cards}${hand.value == null ? '' : ` ${hand.value}`}${tag ? ` ${tag}` : ''}`;
        }).join(' / ')
      : '';
    return `${player.nickname || '好友'}：${handText || '—'} · ${net > 0 ? '+' : ''}${formatChips(net)}`;
  }

  async function loadDashboard(showToast = false) {
    if (historyLoading || !me) return;
    historyLoading = true;
    $('historyRefreshBtn').disabled = true;
    try {
      const data = await api('dashboard',{limit:12});
      renderStats(data.stats && typeof data.stats === 'object' ? data.stats : {});
      renderHistory(Array.isArray(data.history) ? data.history : []);
      if (showToast) toast('战绩与对局记录已刷新');
    } catch (err) {
      if (showToast) toast(err.message || '战绩加载失败');
    } finally {
      historyLoading = false;
      $('historyRefreshBtn').disabled = false;
    }
  }

  function renderStats(stats) {
    const rounds = Math.max(0,Number(stats.rounds || 0));
    const completed = Math.max(0,Number(stats.completed_matches || 0));
    const interrupted = Math.max(0,Number(stats.interrupted_matches || 0));
    const wins = Math.max(0,Number(stats.wins || 0));
    const pushes = Math.max(0,Number(stats.pushes || 0));
    const losses = Math.max(0,Number(stats.losses || 0));
    const blackjacks = Math.max(0,Number(stats.blackjacks || 0));
    const streak = Math.max(0,Number(stats.longest_win_streak || 0));
    const totalDelta = Number(stats.net_chips ?? stats.total_delta ?? 0);
    const winRate = Number(stats.win_rate_pct || 0);
    const bustRate = Number(stats.bust_rate_pct || 0);
    const avgStand = Number(stats.avg_stand_value || 0);
    const bestScore = Number(stats.best_match_score || 0);

    $('statMatches').textContent = String(completed);
    $('statRounds').textContent = String(rounds);
    $('statWinRate').textContent = `${winRate.toFixed(1).replace(/\.0$/,'')}%`;
    $('statBlackjacks').textContent = String(blackjacks);
    $('statBustRate').textContent = `${bustRate.toFixed(1).replace(/\.0$/,'')}%`;
    $('statAvgStand').textContent = avgStand > 0 ? avgStand.toFixed(1).replace(/\.0$/,'') : '--';
    $('statStreak').textContent = String(streak);
    $('statBestScore').textContent = completed > 0 ? String(bestScore) : '--';

    const signed = totalDelta > 0 ? `+${totalDelta}` : String(totalDelta);
    $('statsMeta').textContent = rounds
      ? `胜 ${wins} · 和 ${pushes} · 负 ${losses} · 净筹码 ${signed}${interrupted ? ` · 中断 ${interrupted} 场` : ''}`
      : '暂无统计数据';

    const strip = $('recentForm');
    strip.replaceChildren();
    const recent = Array.isArray(stats.recent_rounds) ? stats.recent_rounds : [];
    if (!recent.length) {
      const empty = document.createElement('span');
      empty.className = 'form-empty';
      empty.textContent = '完成一局后，这里会显示最近表现';
      strip.append(empty);
      return;
    }

    for (const item of recent) {
      const chip = document.createElement('span');
      const result = item?.result === 'win' ? 'win' : item?.result === 'push' ? 'push' : 'loss';
      chip.className = `form-chip ${result}`;
      const label = result === 'win' ? '胜' : result === 'push' ? '和' : '负';
      const value = Number(item?.value);
      chip.textContent = Number.isFinite(value) ? `${label} · ${value}` : label;
      chip.title = item?.hand_status === 'blackjack' ? '黑杰克' :
        item?.hand_status === 'bust' ? '爆牌' : `筹码 ${Number(item?.delta || 0) >= 0 ? '+' : ''}${Number(item?.delta || 0)}`;
      strip.append(chip);
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
      players.sort((a,b) => Number(b.stack ?? b.score ?? 0)-Number(a.stack ?? a.score ?? 0) || Number(a.seat || 0)-Number(b.seat || 0));
      const scoreline = document.createElement('div');
      scoreline.className = 'history-scoreline';
      scoreline.textContent = players.length
        ? players.map((p) => {
            const stack = Number(p.stack ?? p.score ?? 0);
            const delta = stack-1000;
            return `${p.nickname || '好友'} ${formatChips(stack)} (${delta > 0 ? '+' : ''}${formatChips(delta)})`;
          }).join(' · ')
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
    $('rulesText').textContent = `${state.room.round_limit} 局 · 初始 1000 筹码 · 黑杰克 3:2 · 庄家软 17 停牌 · 加倍 / 分牌 / 保险 / 延迟投降`;
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
    const preparing = lobbyPendingAction === 'toggle_ready';
    const starting = lobbyPendingAction === 'start_game';
    $('readyBtn').classList.toggle('hidden',isHost());
    $('readyBtn').disabled = busy || !mine;
    $('readyBtn').setAttribute('aria-busy',preparing ? 'true' : 'false');
    $('readyBtn').textContent = preparing
      ? (lobbyPendingWasReady ? '正在取消准备…' : '正在准备…')
      : (mine?.ready ? '取消准备' : '我准备好了');
    const everyoneReady = state.players.length >= 2 && state.players.length <= 3 &&
      state.players.every((p) => p.ready || String(p.member_id) === String(state.room.host_member_id));
    $('startBtn').classList.toggle('hidden',!isHost());
    $('startBtn').disabled = !everyoneReady || busy;
    $('startBtn').setAttribute('aria-busy',starting ? 'true' : 'false');
    $('startBtn').textContent = starting ? '正在开始游戏…' : '开始游戏';
    $('lobbyHint').textContent = preparing
      ? '正在提交准备状态，请稍候…'
      : starting ? '正在创建牌局并发牌，请稍候…'
      : isHost()
        ? (everyoneReady ? '大家都准备好了，可以开始。' : '至少 2 人，等待其他玩家准备。')
        : (mine?.ready ? '已准备，等待房主开始。' : '准备好后，等待房主开始。');
  }

  function createPlayerSeatNode() {
    const seat = document.createElement('article');
    const meta = document.createElement('div');
    meta.className = 'seat-meta';
    const head = document.createElement('div');
    head.className = 'seat-head';
    const name = document.createElement('b');
    const score = document.createElement('span');
    score.className = 'seat-score';
    head.append(name,score);
    const status = document.createElement('div');
    status.className = 'seat-status';
    const betSpot = document.createElement('div');
    betSpot.className = 'bet-spot';
    betSpot.setAttribute('aria-label','下注区');
    const betStack = document.createElement('span');
    betStack.className = 'bet-stack hidden';
    betStack.setAttribute('aria-hidden','true');
    const betAmount = document.createElement('span');
    betAmount.className = 'bet-amount';
    betAmount.textContent = '下注区';
    betSpot.append(betStack,betAmount);
    const turn = document.createElement('span');
    turn.className = 'turn-indicator';
    turn.textContent = '操作中';
    meta.append(head,status,betSpot,turn);
    const hands = document.createElement('div');
    hands.className = 'seat-hands';
    seat.append(meta,hands);
    return {seat,name,score,status,betSpot,betStack,betAmount,turn,hands,handNodes:new Map()};
  }

  function seatSlot(player) {
    if (String(player.member_id) === String(me?.id || '')) return ' seat-slot-self';
    const others = state.players
      .filter((candidate) => String(candidate.member_id) !== String(me?.id || ''))
      .sort((a,b) => Number(a.seat || 0)-Number(b.seat || 0));
    if (others.length === 1) return ' seat-slot-solo';
    return others.findIndex((candidate) => String(candidate.member_id) === String(player.member_id)) === 0
      ? ' seat-slot-left'
      : ' seat-slot-right';
  }

  function renderPlayerHands(node,player) {
    const wanted = new Set();
    const hands = Array.isArray(player.hands) ? player.hands : [];
    for (const hand of hands) {
      const key = String(hand.id);
      wanted.add(key);
      let handNode = node.handNodes.get(key);
      if (!handNode) {
        const wrap = document.createElement('div');
        wrap.className = 'mini-hand';
        const top = document.createElement('div');
        top.className = 'mini-hand-top';
        const label = document.createElement('span');
        const bet = document.createElement('b');
        top.append(label,bet);
        const cards = document.createElement('div');
        cards.className = 'hand';
        const footer = document.createElement('div');
        footer.className = 'mini-hand-footer';
        wrap.append(top,cards,footer);
        handNode = {wrap,label,bet,cards,footer};
        node.handNodes.set(key,handNode);
      }
      const active = hand.status === 'active' && hand.action_token;
      handNode.wrap.className = 'mini-hand' + (active ? ' active' : '') + (hand.from_split ? ' split' : '') + (hand.doubled ? ' doubled' : '');
      handNode.label.textContent = hands.length > 1 ? `第 ${hand.hand_no} 手牌` : '当前手牌';
      handNode.bet.textContent = `下注 ${formatChips(hand.bet)}`;
      const tag = hand.status === 'blackjack' ? '黑杰克' :
        hand.status === 'bust' ? '爆牌' :
        hand.status === 'surrender' ? '投降' :
        hand.status === 'stand' ? '已停牌' :
        hand.doubled ? '已加倍' : '';
      const net = state?.room.phase === 'settlement' ? Number(hand.net_delta || 0) : null;
      handNode.footer.textContent = state?.room.phase === 'settlement'
        ? `${tag || '已结算'} · ${net > 0 ? '+' : ''}${formatChips(net)}`
        : `${hand.value == null ? '--' : hand.value}${tag ? ` · ${tag}` : ''}`;
      renderHand(handNode.cards,hand.cards || []);
      node.hands.append(handNode.wrap);
    }
    for (const [key,handNode] of node.handNodes) {
      if (wanted.has(key)) continue;
      handNode.wrap.remove();
      node.handNodes.delete(key);
    }
  }

  function renderBetting() {
    const mine = myPlayer();
    if (!mine || state.room.phase !== 'betting') return;
    const max = Math.min(Number(state.room.max_bet || 500),Number(mine.stack || 0));
    if (mine.bet_locked) pendingBet = 0;
    pendingBet = Math.max(0,Math.min(pendingBet,max));
    $('chipBalance').textContent = formatChips(mine.stack);
    $('pendingBet').textContent = mine.bet_locked ? formatChips(mine.current_bet) : formatChips(pendingBet);
    $('confirmBetBtn').disabled = busy || mine.bet_locked || pendingBet < Number(state.room.min_bet || 10);
    $('clearBetBtn').disabled = busy || mine.bet_locked || pendingBet === 0;
    $('repeatBetBtn').disabled = busy || mine.bet_locked || !lastConfirmedBet || lastConfirmedBet > max;
    $('halfBetBtn').disabled = busy || mine.bet_locked || pendingBet <= 0;
    $('doubleBetBtn').disabled = busy || mine.bet_locked || pendingBet <= 0 || pendingBet >= max;
    for (const button of $('chipRack').querySelectorAll('[data-chip]')) {
      const chip = Number(button.dataset.chip || 0);
      button.disabled = busy || mine.bet_locked || pendingBet + chip > max;
    }
    $('betHint').textContent = mine.stack < Number(state.room.min_bet || 10)
      ? '筹码不足，本局观战；下一场 Match 会重新获得 1000'
      : mine.bet_locked
        ? `已确认下注 ${formatChips(mine.current_bet)} · 等待其他玩家`
        : `最低 ${formatChips(state.room.min_bet)} · 单手最高 ${formatChips(state.room.max_bet)} · 点击筹码组成下注`;
  }

  function renderGame() {
    const renderStartedAt = performance.now();
    const phase = state.room.phase;
    const phaseText = {
      betting:'请下注',
      insurance:'保险选择',
      player_action:'玩家操作',
      settlement:'本局结算',
    };
    $('roundLabel').textContent = `第 ${state.room.current_round} / ${state.room.round_limit} 局`;
    $('phaseLabel').textContent = phaseText[phase] || '21 点牌桌';
    renderHand($('dealerHand'),state.dealer.cards || []);
    $('dealerValue').textContent = state.dealer.value == null ? '?' : String(state.dealer.value);

    const table = $('playerTable');
    table.classList.toggle('two-players',state.players.length === 2);
    const wanted = new Set();
    for (const player of state.players) {
      const key = String(player.member_id);
      wanted.add(key);
      let node = playerSeatNodes.get(key);
      if (!node) {
        node = createPlayerSeatNode();
        playerSeatNodes.set(key,node);
      }
      const active = phase === 'player_action' && Boolean(activeHand(player));
      node.seat.className = 'player-seat' + (key === String(me?.id) ? ' me' : '') + seatSlot(player) + (active ? ' is-turn' : '');
      node.seat.dataset.seat = String(player.seat || '');
      node.seat.setAttribute('aria-current',active ? 'true' : 'false');
      node.name.textContent = player.nickname || '好友';
      node.score.textContent = `${formatChips(player.stack)} 筹码`;
      const hasBet = Number(player.current_bet || 0) > 0;
      node.betAmount.textContent = hasBet ? formatChips(player.current_bet) : '下注区';
      node.betSpot.classList.toggle('has-bet',hasBet);
      node.betStack.classList.toggle('hidden',!hasBet);
      if (phase === 'betting') {
        node.status.textContent = Number(player.stack || 0) < Number(state.room.min_bet || 10)
          ? '筹码不足 · 观战'
          : player.bet_locked ? `下注 ${formatChips(player.current_bet)} · 已确认` : '正在下注';
      } else if (phase === 'insurance') {
        node.status.textContent = player.insurance_decided
          ? (Number(player.insurance_bet || 0) > 0 ? `保险 ${formatChips(player.insurance_bet)}` : '未购买保险')
          : '考虑保险';
      } else if (phase === 'settlement') {
        const net = Number(player.stack || 0)-Number(player.round_start_stack || 0);
        node.status.textContent = `${player.result === 'win' ? '胜' : player.result === 'loss' ? '负' : '和'} · ${net > 0 ? '+' : ''}${formatChips(net)}`;
      } else {
        const hand = activeHand(player);
        node.status.textContent = hand ? `第 ${hand.hand_no} 手牌 · ${hand.value ?? '--'} 点` : '等待其他玩家';
      }
      renderPlayerHands(node,player);
      table.append(node.seat);
    }
    for (const [key,node] of playerSeatNodes) {
      if (wanted.has(key)) continue;
      node.seat.remove();
      playerSeatNodes.delete(key);
    }

    const mine = myPlayer();
    const hand = activeHand(mine);
    $('bettingDock').classList.toggle('hidden',phase !== 'betting');
    $('insuranceDock').classList.toggle('hidden',phase !== 'insurance' || !mine?.bet_locked || Number(mine.current_bet || 0) <= 0);
    $('actionDock').classList.toggle('hidden',phase !== 'player_action');
    if (phase === 'betting') renderBetting();

    if (phase === 'insurance' && mine) {
      const cost = Number(mine.current_bet || 0)/2;
      const naturalBlackjack = (mine.hands || []).some((candidate) => candidate.status === 'blackjack' && !candidate.from_split);
      $('insuranceTitle').textContent = naturalBlackjack ? '锁定等额收益？' : '是否购买保险？';
      $('insuranceHint').textContent = naturalBlackjack
        ? '你已拿到黑杰克 · 接受后本局确保净赢 1:1'
        : '庄家明牌 A · 保险赔付 2:1';
      $('insuranceActionText').textContent = naturalBlackjack ? '接受等额收益' : '购买保险';
      $('declineInsuranceBtn').textContent = naturalBlackjack ? '继续等待 3:2' : '不买保险';
      $('insuranceCost').textContent = naturalBlackjack ? `+${formatChips(mine.current_bet)}` : (cost > 0 ? `· ${formatChips(cost)}` : '');
      $('takeInsuranceBtn').disabled = busy || mine.insurance_decided || Number(mine.stack || 0) < cost;
      $('declineInsuranceBtn').disabled = busy || mine.insurance_decided;
    }

    $('myValue').textContent = hand?.value == null ? '--' : String(hand.value);
    $('activeBet').textContent = hand ? formatChips(hand.bet) : '--';

    if (deviceControl === 'PASSIVE' && phase === 'player_action') {
      $('tableMessage').textContent = '此牌局正在另一台设备操作';
    } else if (pendingGameAction) {
      const labels = {hit:'正在发牌…',stand:'正在停牌…',double:'正在加倍…',split:'正在分牌…',surrender:'正在投降…'};
      $('tableMessage').textContent = labels[pendingGameAction] || '正在确认…';
    } else if (phase === 'betting') {
      $('tableMessage').textContent = mine?.bet_locked ? '下注已锁定 · 等待牌桌开局' : '请下注';
    } else if (phase === 'insurance') {
      const naturalBlackjack = (mine?.hands || []).some((candidate) => candidate.status === 'blackjack' && !candidate.from_split);
      $('tableMessage').textContent = mine?.insurance_decided
        ? '保险选择已确认 · 等待其他玩家'
        : naturalBlackjack ? '黑杰克 · 可锁定 1:1 等额收益' : '庄家明牌 A · 是否购买保险？';
    } else if (phase === 'settlement') {
      const dealerText = state.dealer.status === 'bust' ? `庄家 ${state.dealer.value} 点爆牌` :
        state.dealer.status === 'blackjack' ? '庄家黑杰克' : `庄家 ${state.dealer.value} 点`;
      const net = mine ? Number(mine.stack || 0)-Number(mine.round_start_stack || 0) : 0;
      $('tableMessage').textContent = `${dealerText} · 本局 ${net > 0 ? '+' : ''}${formatChips(net)}`;
    } else if (!hand) {
      $('tableMessage').textContent = '等待其他玩家完成操作';
    } else {
      $('tableMessage').textContent = hand.from_split ? `第 ${hand.hand_no} 手牌 · 请选择操作` : '请选择操作';
    }

    updateActions();
    tick();
    lastRenderCost = Math.round((performance.now()-renderStartedAt)*10)/10;
  }

  function renderFinish() {
    const sorted = [...state.players].sort((a,b) => Number(b.stack)-Number(a.stack) || Number(a.seat)-Number(b.seat));
    const ranking = $('ranking');
    ranking.replaceChildren();
    sorted.forEach((player,index) => {
      const row = document.createElement('div');
      row.className = 'rank-row';
      const no = document.createElement('span');
      no.className = 'rank-no';
      no.textContent = index === 0 ? '♠' : String(index + 1);
      const name = document.createElement('span');
      name.className = 'rank-name';
      name.textContent = player.nickname || '好友';
      const score = document.createElement('strong');
      score.className = 'rank-score';
      const delta = Number(player.stack || 0)-Number(state.room.initial_stack || 1000);
      score.textContent = `${formatChips(player.stack)} · ${delta > 0 ? '+' : ''}${formatChips(delta)}`;
      row.append(no,name,score);
      ranking.append(row);
    });
    $('finishSubtitle').textContent = `${state.room.round_limit} 局结束 · 每场筹码已独立结算`;
    $('againBtn').classList.toggle('hidden',!isHost());
    $('againBtn').disabled = busy;
  }

  function updateActions() {
    const mine = myPlayer();
    const hand = activeHand(mine);
    const ownsDevice = deviceControl !== 'PASSIVE';
    const active = Boolean(
      state &&
      state.room.phase === 'player_action' &&
      hand?.status === 'active' &&
      hand?.action_token &&
      !busy &&
      ownsDevice
    );
    $('hitBtn').disabled = !active;
    $('standBtn').disabled = !active;
    $('doubleBtn').disabled = !active || !hand?.can_double;
    $('splitBtn').disabled = !active || !hand?.can_split;
    $('surrenderBtn').disabled = !active || !hand?.can_surrender;
    $('hitBtn').textContent = pendingGameAction === 'hit' ? '发牌中…' : '要牌';
    $('standBtn').textContent = pendingGameAction === 'stand' ? '停牌中…' : '停牌';
    $('takeoverBtn').classList.toggle('hidden',deviceControl !== 'PASSIVE' || state?.room.phase !== 'player_action');
    if ($('readyBtn')) $('readyBtn').disabled = busy;
  }

  function resultText(player) {
    const net = Number(player.stack || 0)-Number(player.round_start_stack || 0);
    if (net>0) return `胜 · +${formatChips(net)}`;
    if (net===0) return '和 · 0';
    return `负 · ${formatChips(net)}`;
  }

  function safeColor(value) {
    const color = String(value || '');
    return /^#[0-9a-f]{6}$/i.test(color) ? color : '#4b8e76';
  }

  // Render the authoritative card immediately; animate only a bounded, aria-hidden
  // visual clone from the shoe. Flights never delay game actions or Realtime updates.
  function animateDealFlight(card,index = 0) {
    if (!motionAllowed() || resyncing || activeDealFlights.size >= DEAL_FLIGHT_MAX ||
        !$('casinoStage')?.contains(card) || typeof card.animate !== 'function') return false;
    const shoe = $('cardShoe');
    if (!shoe?.isConnected) return false;
    const from = shoe.getBoundingClientRect();
    const to = card.getBoundingClientRect();
    if (from.width < 10 || to.width < 10 || to.height < 10) return false;
    const clone = card.cloneNode(true);
    clone.classList.remove('dealt','flipped');
    clone.classList.add('flying-card');
    clone.setAttribute('aria-hidden','true');
    clone.style.left = `${to.left}px`;
    clone.style.top = `${to.top}px`;
    clone.style.width = `${to.width}px`;
    clone.style.height = `${to.height}px`;
    document.body.append(clone);
    card.style.opacity = '0';
    const finish = () => {
      card.style.removeProperty('opacity');
      clone.remove();
      activeDealFlights.delete(finish);
    };
    activeDealFlights.add(finish);
    const dx = from.left + from.width*.5 - (to.left + to.width*.5);
    const dy = from.top + from.height*.5 - (to.top + to.height*.5);
    try {
      const animation = clone.animate([
        {transform:`translate3d(${dx}px,${dy}px,0) rotate(-14deg) scale(.72)`,opacity:.8},
        {transform:`translate3d(${dx*.1}px,${dy*.09}px,0) rotate(1deg) scale(1.04)`,opacity:1,offset:.8},
        {transform:'translate3d(0,0,0) rotate(0deg) scale(1)',opacity:1},
      ],{duration:330+Math.min(index,4)*25,easing:'cubic-bezier(.18,.78,.2,1)',fill:'forwards'});
      animation.finished.then(finish,finish);
      return true;
    } catch {
      finish();
      return false;
    }
  }

  function renderHand(container,cards) {
    const desired = cards.map((code) => String(code));
    for (let i=0;i<desired.length;i++) {
      const current = container.children[i];
      if (current?.dataset.code === desired[i]) continue;
      const card = createCard(desired[i]);
      const flip = current?.dataset.code === 'BACK' && desired[i] !== 'BACK';
      if (current) current.replaceWith(card);
      else container.append(card);
      if (container.isConnected && motionAllowed()) {
        if (flip) {
          card.classList.add('flipped');
          card.addEventListener('animationend',() => card.classList.remove('flipped'),{once:true});
        } else if (!animateDealFlight(card,i)) {
          card.style.setProperty('--deal-delay',`${Math.min(i,4)*45}ms`);
          card.classList.add('dealt');
          card.addEventListener('animationend',() => card.classList.remove('dealt'),{once:true});
        }
      }
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
    const hand = activeHand(mine);
    if (state.room.phase === 'player_action' && hand?.status === 'active' && hand.decision_deadline) {
      const ms = Date.parse(hand.decision_deadline) - now;
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
      const hand = activeHand(mine);
      const decisionMs = state.room.phase === 'player_action' && hand?.status === 'active' && hand.decision_deadline
        ? Date.parse(hand.decision_deadline)-now
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
    setPollInterval(desiredPollMs());
  }

  function desiredPollMs() {
    if (isRealtimeHealthy()) {
      degradedSince = 0;
      return HEALTHY_POLL_MS;
    }
    if (!degradedSince) degradedSince = Date.now();
    const elapsed = Date.now()-degradedSince;
    return DEGRADED_POLL_STEPS.find(([until]) => elapsed < until)?.[1] || 4000;
  }

  function setPollInterval(ms) {
    if (pollTimer && pollMs === ms) return;
    clearInterval(pollTimer);
    pollMs = ms;
    pollTimer = setInterval(refreshState,ms);
  }

  function requestState(delay = 80,markResync = false) {
    if (!state || suspended || navigator.onLine === false) return;
    if (markResync) {
      resyncing = true;
      updateConnection();
    }
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refreshState(markResync),delay);
  }

  async function refreshState(markResync = false) {
    if (!state || suspended || navigator.onLine === false) return;
    if (stateRefreshPromise) {
      refreshQueued = true;
      if (markResync) {
        resyncing = true;
        updateConnection();
      }
      return stateRefreshPromise;
    }

    const roomId = state.room.id;
    if (markResync) {
      resyncing = true;
      updateConnection();
    }

    stateRefreshPromise = (async () => {
      try {
        const data = await api('state',{room_id:roomId});
        if (state?.room.id === roomId && data.state) adoptState(data.state);
      } catch (err) {
        if (err.cancelled) return;
        if ([403,404,410].includes(err.status) || /房间.*(结束|不存在)|不在这个房间/.test(err.message || '')) {
          exitToHome(err.message || '房间已结束');
        }
      } finally {
        resyncing = false;
        updateConnection();
      }
    })();

    try {
      await stateRefreshPromise;
    } finally {
      stateRefreshPromise = null;
      if (refreshQueued && state && !suspended) {
        refreshQueued = false;
        requestState(0,false);
      } else {
        refreshQueued = false;
      }
    }
  }

  function applyGameEvent(event) {
    if (!state || !event || event.room_id !== state.room.id) return;
    const currentVersion = Number(state.room.version);
    const fromVersion = Number(event.from_version);
    const nextVersion = Number(event.version);

    if (!Number.isFinite(fromVersion) || !Number.isFinite(nextVersion)) {
      requestState(0,true);
      return;
    }
    if (nextVersion <= currentVersion) return;
    if (fromVersion !== currentVersion) {
      requestState(0,true);
      return;
    }

    const next = {
      ...state,
      server_now:event.server_time || state.server_now,
      room:{...state.room,...(event.room || {}),version:nextVersion},
      dealer:{...state.dealer},
      players:[...state.players],
    };

    if (Array.isArray(event.players)) {
      next.players = event.players;
    } else if (event.player?.member_id) {
      const key = String(event.player.member_id);
      const index = next.players.findIndex((p) => String(p.member_id) === key);
      if (index < 0) {
        requestState(0,true);
        return;
      }
      next.players[index] = event.player;
    }

    if (event.dealer && typeof event.dealer === 'object') {
      next.dealer = {...state.dealer,...event.dealer};
    }

    adoptState(next);
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
    const generation = realtimeConnectEpoch;
    const roomId = state.room.id;
    const auth = await ToolboxAuth.getSession();
    if (!auth || epoch !== roomEpoch || generation !== realtimeConnectEpoch) return;
    realtimeStatus = 'CONNECTING';
    updateConnection();
    realtime = window.supabase.createClient(ToolboxAuth.url,ToolboxAuth.key,{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      realtime:{
        worker:true,
        heartbeatIntervalMs:15000,
        heartbeatCallback:(status) => {
          if (epoch !== roomEpoch || generation !== realtimeConnectEpoch) return;
          if (status === 'sent') {
            heartbeatSentAt = performance.now();
          } else if (status === 'ok') {
            if (heartbeatSentAt) realtimeRtt = Math.max(0,Math.round(performance.now()-heartbeatSentAt));
            heartbeatSentAt = 0;
            serverHeartbeatAt = Date.now();
            if (realtimeStatus === 'SUBSCRIBED') {
              reconnectAttempt = 0;
              clearTimeout(reconnectTimer);
              reconnectTimer = null;
            }
          } else if (status === 'disconnected') {
            try { realtime?.realtime?.connect(); } catch {}
            scheduleReconnect(RECONNECT_GRACE_MS);
          } else if (['timeout','error'].includes(status)) {
            scheduleReconnect(RECONNECT_GRACE_MS);
          }
          updateConnection();
        },
      },
    });
    await realtime.realtime.setAuth(auth.access_token);
    if (epoch !== roomEpoch || generation !== realtimeConnectEpoch || !state || state.room.id !== roomId) return;

    const nonce = state?.room?.realtime_token;
    const topic = nonce ? `blackjack:${roomId}:${nonce}` : `blackjack:${roomId}`;
    channel = realtime.channel(topic,{
      config:{private:true,presence:{key:auth.user.id},broadcast:{ack:false,self:false}},
    });
    channel.on('broadcast',{event:'state_snapshot'},({payload}) => {
      if (epoch !== roomEpoch || !validSnapshot(payload) || payload.room.id !== roomId) return;
      resyncing = false;
      adoptState(payload);
    });
    channel.on('broadcast',{event:'game_event'},({payload}) => {
      if (epoch !== roomEpoch || payload?.room_id !== roomId) return;
      applyGameEvent(payload);
    });
    channel.on('broadcast',{event:'state_changed'},() => requestState(30,false));
    // The replacement key is fetched via the authenticated state endpoint.
    channel.on('broadcast',{event:'channel_rotated'},() => {
      leaveRealtime(false);
      requestState(0,true);
    });
    channel.on('broadcast',{event:'emoji'},({payload}) => {
      if (payload?.emoji && typeof payload.emoji === 'string') {
        showReaction(payload.emoji,payload.member_id);
      }
    });
    channel.on('presence',{event:'sync'},() => {
      if (epoch !== roomEpoch || !channel) return;
      presenceMembers = new Set(Object.values(channel.presenceState()).flat().map((x) => String(x.member_id)));
      if (state?.room.status === 'lobby') renderRoom();
    });
    channel.on('presence',{event:'join'},() => requestState(100));
    channel.on('presence',{event:'leave'},() => requestState(100));
    channel.subscribe(async (status) => {
      if (epoch !== roomEpoch || generation !== realtimeConnectEpoch) return;
      realtimeStatus = status;
      if (status === 'SUBSCRIBED') {
        serverHeartbeatAt = Date.now();
        reconnectAttempt = 0;
        try { await channel.track({member_id:String(me.id),nickname:me.nickname,online_at:new Date().toISOString()}); } catch {}
        requestState(0,false);
      } else if (['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)) {
        scheduleReconnect(RECONNECT_GRACE_MS);
      }
      updateConnection();
    });
  }

  function isRealtimeHealthy() {
    return realtimeStatus === 'SUBSCRIBED' && Date.now()-serverHeartbeatAt < 65000 && navigator.onLine !== false;
  }

  function updateConnection() {
    const healthy = isRealtimeHealthy();
    setPollInterval(desiredPollMs());
    const network = Number.isFinite(realtimeRtt) ? `实时 ${Math.round(realtimeRtt)}ms` : null;
    const action = Number.isFinite(lastActionRtt) ? `操作 ${lastActionRtt}ms` : null;
    let label = '降级同步中';
    let mode = 'degraded';

    if (navigator.onLine === false) {
      label = '网络已断开';
      mode = 'offline';
    } else if (resyncing) {
      label = '正在同步牌局…';
      mode = 'resyncing';
    } else if (healthy) {
      label = ['实时在线',network,action].filter(Boolean).join(' · ');
      mode = 'online';
    } else if (realtimeStatus === 'CONNECTING' || reconnectTimer) {
      label = '正在重新连接…';
      mode = 'reconnecting';
    }

    for (const id of ['connectionStatus','gameConnectionStatus']) {
      const el = $(id);
      if (!el) continue;
      el.textContent = label;
      el.dataset.mode = mode;
      el.classList.toggle('online',mode === 'online');
      el.classList.toggle('warn',mode !== 'online');
    }
  }

  function sendEvent(event,payload) {
    if (!channel || realtimeStatus !== 'SUBSCRIBED') return Promise.resolve('not_connected');
    return channel.send({type:'broadcast',event,payload}).catch(() => 'error');
  }

  function sendEmoji(emoji) {
    const now = Date.now();
    if (now-lastReactionAt < 650) return;
    lastReactionAt = now;
    const memberId = String(me?.id || '');
    showReaction(emoji,memberId);
    pulseHaptic(6);
    sendEvent('emoji',{emoji:String(emoji).slice(0,4),member_id:memberId});
  }

  function showReaction(emoji,memberId) {
    const layer = $('reactionLayer');
    if (!layer) return;
    if (layer.childElementCount >= 6) layer.firstElementChild?.remove();
    const bubble = document.createElement('span');
    bubble.className = 'table-reaction';
    bubble.textContent = String(emoji).slice(0,4);
    const target = presentationTarget(memberId);
    const rect = target?.getBoundingClientRect();
    if (rect) {
      bubble.style.left = `${Math.max(20,Math.min(innerWidth-40,rect.left+rect.width*.5))}px`;
      bubble.style.top = `${Math.max(80,rect.top+20)}px`;
    } else {
      bubble.style.left = '50%';
      bubble.style.top = '58%';
    }
    layer.append(bubble);
    bubble.addEventListener('animationend',() => bubble.remove(),{once:true});
    setTimeout(() => bubble.remove(),1600);
  }

  function scheduleReconnect(base = RECONNECT_GRACE_MS) {
    if (reconnectTimer || suspended || !state || navigator.onLine === false) return;
    if (['closed','abandoned'].includes(state.room.status)) {
      exitToHome('房间已结束');
      return;
    }
    const epoch = roomEpoch;
    updateConnection();
    const delay = base + Math.min(1200,250*reconnectAttempt);
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      if (epoch !== roomEpoch || !state || isRealtimeHealthy()) return;
      if (['closed','abandoned'].includes(state.room.status)) {
        exitToHome('房间已结束');
        return;
      }
      if (reconnectAttempt === 0 && realtime?.realtime) {
        reconnectAttempt = 1;
        try { realtime.realtime.connect(); } catch {}
        scheduleReconnect(3500);
        return;
      }
      reconnectAttempt = Math.min(6,reconnectAttempt+1);
      try { await connectRealtime(); } catch { scheduleReconnect(RECONNECT_GRACE_MS); }
    },delay);
  }

  function leaveRealtime(stopPoll = true) {
    realtimeConnectEpoch++;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    pendingPings.clear();
    realtimeRtt = null;
    heartbeatSentAt = 0;
    serverHeartbeatAt = 0;
    degradedSince = 0;
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
    claimDevice(false).catch(() => false);
    requestState(0,true);
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

  loadPreferences();
  bind();
  initialize();
})();
