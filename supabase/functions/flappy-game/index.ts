import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const URL=Deno.env.get("SUPABASE_URL")!;
const GAME_VERSION="2026.09.23-leaderboard-v1";
const LEADERBOARD_CACHE_MS=15000;
let leaderboardCache:{expiresAt:number;weekStart:string;allTime:any[];weekly:any[];updatedAt:string}|null=null;
const ORIGINS=new Set([
  "https://v1t0777.github.io",
  "https://zhao-toolbox-secure.pages.dev",
  "http://localhost:8000",
  "http://127.0.0.1:8000"
]);

function adminKey(){
  try{
    const raw=Deno.env.get("SUPABASE_SECRET_KEYS");
    if(raw){const keys=JSON.parse(raw);if(keys?.default)return keys.default;}
  }catch{}
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
}
function publishableKey(){
  try{
    const raw=Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
    if(raw){const keys=JSON.parse(raw);if(keys?.default)return keys.default;}
  }catch{}
  return Deno.env.get("SUPABASE_ANON_KEY")||"";
}

const ADMIN_KEY=adminKey();
if(!ADMIN_KEY)throw new Error("服务端数据库密钥未配置");
const admin=createClient(URL,ADMIN_KEY,{auth:{persistSession:false,autoRefreshToken:false}});

const cors=(req:Request)=>({
  "Access-Control-Allow-Origin":ORIGINS.has(req.headers.get("origin")||"")?(req.headers.get("origin")||""):"https://v1t0777.github.io",
  "Access-Control-Allow-Headers":"authorization, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"no-store",
  "Vary":"Origin"
});
const reply=(req:Request,body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors(req)});
function fail(message:string,status=400,code?:string):never{
  const error=new Error(message) as Error&{status?:number;code?:string};
  error.status=status;error.code=code;throw error;
}

type Member={id:string;user_id:string;nickname:string;color:string;excluded:boolean};

async function identify(req:Request):Promise<Member>{
  const authorization=req.headers.get("authorization")||"";
  if(!authorization.startsWith("Bearer "))fail("请先登录",401,"AUTH_REQUIRED");
  const token=authorization.slice(7).trim();
  if(!token||token===req.headers.get("apikey")||token.startsWith("sb_publishable_"))fail("请先登录",401,"AUTH_REQUIRED");
  const key=req.headers.get("apikey")||publishableKey();
  const client=createClient(URL,key,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const [{data:status,error:statusError},{data:userData,error:userError}]=await Promise.all([
    client.rpc("toolbox_session_status"),
    client.auth.getUser(token)
  ]);
  if(statusError||userError||!userData.user)fail("登录状态暂时无法验证，请重试",401,"AUTH_REQUIRED");
  if(!status?.active||!status?.member_id)fail("当前账号不在工具箱成员名单中或会话已失效",403,"SESSION_REVOKED");
  const {data:member,error}=await admin.from("members").select("id,user_id,nickname,color,exclude_from_leaderboard").eq("id",status.member_id).eq("user_id",userData.user.id).maybeSingle();
  if(error)fail("成员资料读取失败，请稍后重试",503);
  if(!member)fail("成员资料不存在",403,"SESSION_REVOKED");
  if(member.exclude_from_leaderboard)fail("当前账号不参与排行榜",403,"LEADERBOARD_EXCLUDED");
  return {id:member.id,user_id:member.user_id,nickname:member.nickname,color:member.color,excluded:false};
}

async function optionalViewer(req:Request):Promise<{member:Member|null;excluded:boolean}>{
  const authorization=req.headers.get("authorization")||"";
  if(!authorization.startsWith("Bearer "))return {member:null,excluded:false};
  try{return {member:await identify(req),excluded:false};}
  catch(error){
    if((error as any)?.code==="LEADERBOARD_EXCLUDED")return {member:null,excluded:true};
    return {member:null,excluded:false};
  }
}

function base64url(bytes:Uint8Array){
  let raw="";for(const byte of bytes)raw+=String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
async function sha256(value:string){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
function currentWeekStart(){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit",weekday:"short"}).formatToParts(new Date());
  const get=(type:string)=>parts.find(p=>p.type===type)?.value||"";
  const date=new Date(`${get("year")}-${get("month")}-${get("day")}T00:00:00+08:00`);
  const weekday={Mon:0,Tue:1,Wed:2,Thu:3,Fri:4,Sat:5,Sun:6}[get("weekday") as "Mon"]??0;
  date.setUTCDate(date.getUTCDate()-weekday);
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
}

async function rateLimit(req:Request,action:string,limit:number,windowSeconds:number){
  const ip=(req.headers.get("cf-connecting-ip")||req.headers.get("x-real-ip")||"unknown").trim();
  const day=new Date().toISOString().slice(0,10);
  const key=await sha256(ip+"|"+day+"|"+action);
  const {data,error}=await admin.rpc("flappy_rate_limit_check",{
    p_key:key,p_action:action,p_limit:limit,p_window_seconds:windowSeconds
  });
  if(error)fail("请求过于频繁，请稍后再试",429,"RATE_LIMIT_UNAVAILABLE");
  return data===true;
}

async function leaderboardBase(){
  const weekStart=currentWeekStart();
  const now=Date.now();
  if(leaderboardCache&&leaderboardCache.expiresAt>now&&leaderboardCache.weekStart===weekStart){
    return {
      game_version:GAME_VERSION,
      week_start:leaderboardCache.weekStart,
      all_time:leaderboardCache.allTime,
      weekly:leaderboardCache.weekly,
      updated_at:leaderboardCache.updatedAt
    };
  }

  const [allResult,weekResult,membersResult]=await Promise.all([
    admin.from("flappy_best_scores").select("user_id,member_id,best_score,bird_skin,achieved_at").order("best_score",{ascending:false}).order("achieved_at",{ascending:true}),
    admin.from("flappy_weekly_bests").select("user_id,member_id,best_score,bird_skin,achieved_at").eq("week_start",weekStart).order("best_score",{ascending:false}).order("achieved_at",{ascending:true}),
    admin.from("members").select("id,nickname,color,exclude_from_leaderboard").eq("exclude_from_leaderboard",false)
  ]);
  if(allResult.error||weekResult.error||membersResult.error)fail("排行榜暂时无法加载",503);

  const memberMap=new Map<string,{nickname:string;color:string}>();
  for(const member of membersResult.data||[])memberMap.set(member.id,{nickname:member.nickname,color:member.color});

  const shape=(rows:any[])=>rows
    .filter(row=>memberMap.has(row.member_id))
    .sort((a,b)=>b.best_score-a.best_score||a.achieved_at.localeCompare(b.achieved_at)||a.member_id.localeCompare(b.member_id))
    .map((row,index)=>({
      rank:index+1,
      member_id:row.member_id,
      nickname:memberMap.get(row.member_id)?.nickname||"好友",
      color:memberMap.get(row.member_id)?.color||"#8EC5FF",
      score:row.best_score,
      bird_skin:row.bird_skin,
      achieved_at:row.achieved_at
    }));

  const allTime=shape(allResult.data||[]);
  const weekly=shape(weekResult.data||[]);
  const updatedAt=new Date().toISOString();
  leaderboardCache={expiresAt:now+LEADERBOARD_CACHE_MS,weekStart,allTime,weekly,updatedAt};
  return {game_version:GAME_VERSION,week_start:weekStart,all_time:allTime,weekly,updated_at:updatedAt};
}

async function leaderboard(req:Request){
  const [base,viewerState]=await Promise.all([leaderboardBase(),optionalViewer(req)]);
  const viewer=viewerState.member?{
    member_id:viewerState.member.id,
    nickname:viewerState.member.nickname,
    all_time:base.all_time.find((x:any)=>x.member_id===viewerState.member?.id)||null,
    weekly:base.weekly.find((x:any)=>x.member_id===viewerState.member?.id)||null
  }:null;
  return {...base,viewer,excluded_account:viewerState.excluded};
}

async function startRun(req:Request,body:any){
  const member=await identify(req);
  const birdSkin=String(body.bird_skin||"");
  const version=String(body.game_version||"");
  if(!["warm","slate"].includes(birdSkin))fail("小鸟羽色无效",400,"INVALID_BIRD_SKIN");
  if(version!==GAME_VERSION)fail("游戏版本已更新，请刷新页面",409,"GAME_VERSION_MISMATCH");
  const recentCutoff=new Date(Date.now()-800).toISOString();
  const {data:recent,error:recentError}=await admin.from("flappy_runs").select("id").eq("user_id",member.user_id).gte("created_at",recentCutoff).limit(1);
  if(recentError)fail("暂时无法开始线上计分",503);
  if(recent?.length)fail("开始得太快了，请稍后再试",429,"RUN_RATE_LIMIT");
  const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);
  const token=base64url(bytes),tokenHash=await sha256(token);
  const startedAt=new Date(),expiresAt=new Date(startedAt.getTime()+15*60*1000);
  const {data,error}=await admin.from("flappy_runs").insert({
    user_id:member.user_id,member_id:member.id,run_token_hash:tokenHash,
    bird_skin:birdSkin,game_version:version,started_at:startedAt.toISOString(),expires_at:expiresAt.toISOString()
  }).select("id,started_at,expires_at").single();
  if(error)fail("暂时无法开始线上计分",503);
  return {run_id:data.id,run_token:token,started_at:data.started_at,expires_at:data.expires_at,game_version:GAME_VERSION};
}

async function submitRun(req:Request,body:any){
  const member=await identify(req);
  const token=String(body.run_token||"");
  const score=Number(body.score),durationMs=Number(body.duration_ms);
  const birdSkin=String(body.bird_skin||""),version=String(body.game_version||"");
  if(!/^[A-Za-z0-9_-]{40,80}$/.test(token))fail("本局凭证无效",400,"INVALID_RUN_TOKEN");
  const tokenHash=await sha256(token);
  const {data:run,error:runError}=await admin.from("flappy_runs").select("*").eq("run_token_hash",tokenHash).eq("user_id",member.user_id).maybeSingle();
  if(runError)fail("线上成绩校验失败",503);
  if(!run)fail("本局凭证不存在或已过期",404,"RUN_NOT_FOUND");
  if(run.submitted_at)fail("本局成绩已经提交",409,"RUN_ALREADY_SUBMITTED");

  const now=Date.now(),serverElapsed=now-new Date(run.started_at).getTime();
  let reason="";
  if(!Number.isSafeInteger(score)||score<0||score>200)reason="score_out_of_range";
  else if(!Number.isSafeInteger(durationMs)||durationMs<250||durationMs>1200000)reason="duration_out_of_range";
  else if(version!==GAME_VERSION||version!==run.game_version)reason="game_version_mismatch";
  else if(birdSkin!==run.bird_skin||!["warm","slate"].includes(birdSkin))reason="bird_skin_mismatch";
  else if(now>new Date(run.expires_at).getTime())reason="run_expired";
  // Active simulation time excludes pauses; wall time may be longer, never shorter.
  // The start request is nonblocking, so allow its bounded network delay.
  else if(durationMs>serverElapsed+20000)reason="duration_clock_mismatch";
  else if(score>0&&durationMs<1400+score*700)reason="score_too_fast";
  else if(score>Math.floor(Math.max(0,durationMs-900)/620)+2)reason="score_rate_exceeded";

  const submittedAt=new Date(now).toISOString();
  // Invalid attempts still consume their token; never violate table CHECKs here.
  const patch={score:Number.isSafeInteger(score)&&score>=0&&score<=200?score:null,duration_ms:Number.isSafeInteger(durationMs)&&durationMs>=250&&durationMs<=1200000?durationMs:null,submitted_at:submittedAt,verified:!reason,rejection_reason:reason||null};
  const {data:updated,error:updateError}=await admin.from("flappy_runs").update(patch).eq("id",run.id).is("submitted_at",null).select("id,verified").maybeSingle();
  if(updateError)fail("线上成绩校验失败",503);
  if(!updated)fail("本局成绩已经提交",409,"RUN_ALREADY_SUBMITTED");
  if(reason)fail("本局成绩未通过服务器校验",422,reason.toUpperCase());
  leaderboardCache=null;
  return {accepted:true,score,leaderboard:await leaderboard(req)};
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(req)});
  if(req.method!=="POST")return reply(req,{error:"仅支持 POST"},405);
  const origin=req.headers.get("origin")||"";
  if(origin&&!ORIGINS.has(origin))return reply(req,{error:"来源未获授权"},403);
  try{
    const body=await req.json().catch(()=>({}));
    const action=String(body.action||"leaderboard");
    const limit=action==="leaderboard"?60:action==="start_run"?30:action==="submit_run"?60:20;
    if(!await rateLimit(req,action,limit,60))return reply(req,{error:"请求过于频繁，请稍后再试",code:"RATE_LIMITED"},429);
    if(action==="leaderboard")return reply(req,await leaderboard(req));
    if(action==="start_run")return reply(req,await startRun(req,body));
    if(action==="submit_run")return reply(req,await submitRun(req,body));
    fail("未知操作",400,"UNKNOWN_ACTION");
  }catch(error){
    console.error(error);
    return reply(req,{error:(error as Error)?.message||"服务器暂时不可用",code:(error as any)?.code},(error as any)?.status||400);
  }
});
