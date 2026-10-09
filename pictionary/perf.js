(() => {
  'use strict';
  // Local, bounded, metadata-only instrumentation. Never capture payloads or identifiers.
  const MAX_SAMPLES=96;
  const timing=new Map(), longTasks=[], send={pending:0,maxPending:0,errors:0,slow:0};
  const allowed=/^[a-z0-9_.-]{1,48}$/;
  const perf=globalThis.performance;
  let counter=0,peerRtt=null,edgeRegion='未观测',realtimeFailures=0;
  const now=()=>typeof perf?.now==='function'?perf.now():Date.now();
  function sample(label,value){
    if(!allowed.test(label)||!Number.isFinite(value)||value<0)return;
    let series=timing.get(label);
    if(!series){series=[];timing.set(label,series);}
    series.push(Math.min(60000,Math.round(value*10)/10));
    if(series.length>MAX_SAMPLES)series.shift();
  }
  function begin(label){
    const start=now(),key='pictionary.'+label+'.'+(++counter);
    let marked=false,finished=false;
    if(allowed.test(label)&&typeof perf?.mark==='function'){
      try{perf.mark(key+'.start');marked=true;}catch{}
    }
    return ()=>{
      if(finished)return;
      finished=true;
      const duration=now()-start;
      sample(label,duration);
      if(marked){
        try{
          perf.mark(key+'.end');
          perf.measure('pictionary.'+label,key+'.start',key+'.end');
          perf.clearMarks(key+'.start');perf.clearMarks(key+'.end');
          perf.clearMeasures('pictionary.'+label);
        }catch{}
      }
    };
  }
  function statistics(label){
    const series=timing.get(label)||[];
    if(!series.length)return null;
    const sorted=[...series].sort((a,b)=>a-b);
    const percentile=p=>sorted[Math.ceil(p*sorted.length)-1];
    return {count:series.length,p50:percentile(.5),p95:percentile(.95)};
  }
  function observeLongTasks(){
    if(typeof globalThis.PerformanceObserver!=='function')return;
    try{
      const observer=new PerformanceObserver(list=>{
        for(const entry of list.getEntries()){
          sample('main.longtask',entry.duration);
          longTasks.push({time:Date.now(),duration:entry.duration});
          if(longTasks.length>MAX_SAMPLES)longTasks.shift();
        }
      });
      observer.observe({entryTypes:['longtask']});
    }catch{}
  }
  observeLongTasks();
  function setPeerRtt(ms){
    if(!Number.isFinite(ms)||ms<0||ms>60000)return;
    peerRtt=peerRtt===null?ms:peerRtt*.75+ms*.25;
    sample('realtime.peer_rtt',ms);
  }
  function readServerTiming(action,headers){
    if(!headers?.get)return;
    const region=headers.get('x-sb-edge-region');
    if(region&&/^[a-z]{2}-[a-z]+-\d$/.test(region))edgeRegion=region;
    const header=headers.get('server-timing')||'';
    for(const item of header.split(',')){
      const match=item.trim().match(/^(parse|auth|limit|business|total);dur=([\d.]+)$/);
      if(match)sample('edge.'+match[1],Number(match[2]));
    }
  }
  function sendStart(event){
    const beginAt=now();
    send.pending++;
    send.maxPending=Math.max(send.maxPending,send.pending);
    let done=false;
    return status=>{
      if(done)return;
      done=true;send.pending=Math.max(0,send.pending-1);
      const elapsed=now()-beginAt;
      sample('realtime.send_wait',elapsed);
      if(elapsed>250)send.slow++;
      if(status!=='ok')send.errors++;
    };
  }
  function noteRealtimeFailure(){realtimeFailures++;}
  function connectionHint(){
    const connection=globalThis.navigator?.connection||globalThis.navigator?.mozConnection||globalThis.navigator?.webkitConnection;
    const effective=connection?.effectiveType;
    return effective==='slow-2g'||effective==='2g'?'slow':effective==='3g'?'moderate':'normal';
  }
  function profile(){
    const hint=connectionHint();
    const congestion=send.pending>8||send.slow>6&&send.slow>send.errors*2;
    const badRtt=peerRtt!==null&&peerRtt>600;
    const recentLong=longTasks.some(e=>Date.now()-e.time<15000&&e.duration>150);
    if(hint==='slow'||congestion||badRtt)return {tier:'slow',strokeMs:46,maxPoints:120,recoveryMs:8000,snapshotMs:4200,chunkGapMs:16};
    if(hint==='moderate'||(peerRtt!==null&&peerRtt>280)||recentLong||send.pending>3)
      return {tier:'moderate',strokeMs:28,maxPoints:84,recoveryMs:6500,snapshotMs:3200,chunkGapMs:12};
    return {tier:'fast',strokeMs:14,maxPoints:48,recoveryMs:5000,snapshotMs:2500,chunkGapMs:8};
  }
  function snapshot(){
    const quality=profile();
    return {
      route:'ap-southeast-1',observedRegion:edgeRegion,tier:quality.tier,
      peerRtt:peerRtt===null?null:Math.round(peerRtt),
      send:{pending:send.pending,maxPending:send.maxPending,errors:send.errors,slow:send.slow},
      realtimeFailures,
      latency:Object.fromEntries(['api.total','api.auth','api.fetch','api.parse','edge.total',
        'edge.auth','edge.limit','edge.business','realtime.peer_rtt','realtime.send_wait',
        'canvas.redraw','canvas.pointer_move','main.longtask'].map(x=>[x,statistics(x)]))
    };
  }
  // Read-only numeric diagnostic data, never room/player/guess/canvas contents.
  Object.defineProperty(globalThis,'PictionaryPerf',{value:Object.freeze({
    begin,sample,setPeerRtt,readServerTiming,sendStart,noteRealtimeFailure,profile,snapshot
  }),writable:false,configurable:false});
})();