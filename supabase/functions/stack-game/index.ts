import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const URL=Deno.env.get("SUPABASE_URL")!;
const GAME_VERSION="2026.09.24-stack-v1";
const LEADERBOARD_CACHE_MS=15000;
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
let leaderboardCache:{expiresAt:number;rows:any[];updatedAt:string}|null=null;

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

type Member={id:string;user_id:string;nickname:string;color:string};

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
  const {data:member,error}=await admin.from("members")
    .select("id,user_id,nickname,color,exclude_from_leaderboard")
    .eq("id",status.member_id).eq("user_id",userData.user.id).maybeSingle();
  if(error)fail("成员资料读取失败，请稍后重试",503);
  if(!member)fail("成员资料不存在",403,"SESSION_REVOKED");
  if(member.exclude_from_leaderboard)fail("当前账号不参与排行榜",403,"LEADERBOARD_EXCLUDED");
  return {id:member.id,user_id:member.user_id,nickname:member.nickname,color:member.color};
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
async function rateLimit(req:Request,action:string,limit:number,windowSeconds:number){
  const ip=(req.headers.get("cf-connecting-ip")||req.headers.get("x-real-ip")||"unknown").trim();
  const day=new Date().toISOString().slice(0,10);
  const key=await sha256(ip+"|"+day+"|"+action);
  const {data,error}=await admin.rpc("stack_rate_limit_check",{
    p_key:key,p_action:action,p_limit:limit,p_window_seconds:windowSeconds
  });
  if(error)fail("请求校验暂时不可用，请稍后重试",503,"RATE_LIMIT_UNAVAILABLE");
  return data===true;
}

async function accountLimit(userId:string,action:string,limit:number){
  const key=await sha256("stack|account|"+userId);
  const {data,error}=await admin.rpc("stack_rate_limit_check",{
    p_key:key,p_action:"account:"+action,p_limit:limit,p_window_seconds:60
  });
  if(error)fail("请求校验暂时不可用，请稍后重试",503,"RATE_LIMIT_UNAVAILABLE");
  if(data!==true)fail("请求过于频繁，请稍后再试",429,"RATE_LIMITED");
}

async function readBody(req:Request){
  const maxBytes=16*1024;
  if(Number(req.headers.get("content-length"))>maxBytes)fail("请求数据过大",413);
  const reader=req.body?.getReader();if(!reader)fail("请求数据无效",400);
  const decoder=new TextDecoder();let size=0,text="";
  try{
    for(;;){
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;if(size>maxBytes){await reader.cancel();fail("请求数据过大",413);}
      text+=decoder.decode(value,{stream:true});
    }
    text+=decoder.decode();
  }finally{reader.releaseLock();}
  let body;try{body=JSON.parse(text);}catch{fail("请求数据无效",400);}
  if(!body||typeof body!=="object"||Array.isArray(body))fail("请求数据无效",400);
  return body;
}

async function leaderboardBase(){
  const now=Date.now();
  if(leaderboardCache&&leaderboardCache.expiresAt>now){
    return {game_version:GAME_VERSION,all_time:leaderboardCache.rows,updated_at:leaderboardCache.updatedAt};
  }
  const [scores,members]=await Promise.all([
    admin.from("stack_best_scores")
      .select("user_id,member_id,best_height,perfect_count,max_combo,theme_id,achieved_at")
      .order("best_height",{ascending:false})
      .order("perfect_count",{ascending:false})
      .order("max_combo",{ascending:false})
      .order("achieved_at",{ascending:true}),
    admin.from("members").select("id,nickname,color,exclude_from_leaderboard").eq("exclude_from_leaderboard",false)
  ]);
  if(scores.error||members.error)fail("排行榜暂时无法加载",503);
  const memberMap=new Map<string,{nickname:string;color:string}>();
  for(const member of members.data||[])memberMap.set(member.id,{nickname:member.nickname,color:member.color});
  const rows=(scores.data||[])
    .filter(row=>memberMap.has(row.member_id))
    .sort((a,b)=>
      b.best_height-a.best_height||
      b.perfect_count-a.perfect_count||
      b.max_combo-a.max_combo||
      a.achieved_at.localeCompare(b.achieved_at)||
      a.member_id.localeCompare(b.member_id)
    )
    .map((row,index)=>({
      rank:index+1,
      member_id:row.member_id,
      nickname:memberMap.get(row.member_id)?.nickname||"好友",
      color:memberMap.get(row.member_id)?.color||"#8EC5FF",
      score:row.best_height,
      perfect_count:row.perfect_count,
      max_combo:row.max_combo,
      theme_id:row.theme_id,
      achieved_at:row.achieved_at
    }));
  const updatedAt=new Date().toISOString();
  leaderboardCache={expiresAt:now+LEADERBOARD_CACHE_MS,rows,updatedAt};
  return {game_version:GAME_VERSION,all_time:rows,updated_at:updatedAt};
}
async function leaderboard(req:Request){
  const [base,viewerState]=await Promise.all([leaderboardBase(),optionalViewer(req)]);
  const viewer=viewerState.member?{
    member_id:viewerState.member.id,
    nickname:viewerState.member.nickname,
    all_time:base.all_time.find((x:any)=>x.member_id===viewerState.member?.id)||null
  }:null;
  return {...base,viewer,excluded_account:viewerState.excluded};
}

async function startRun(req:Request,body:any){
  const member=await identify(req);
  await accountLimit(member.user_id,"start_run",30);
  const themeId=String(body.theme_id||"");
  const version=String(body.game_version||"");
  if(!["night","sand","slate","forest"].includes(themeId))fail("主题无效",400,"INVALID_THEME");
  if(version!==GAME_VERSION)fail("游戏版本已更新，请刷新页面",409,"GAME_VERSION_MISMATCH");

  const recentCutoff=new Date(Date.now()-800).toISOString();
  const {data:recent,error:recentError}=await admin.from("stack_runs")
    .select("id").eq("user_id",member.user_id).gte("created_at",recentCutoff).limit(1);
  if(recentError)fail("暂时无法开始线上计分",503);
  if(recent?.length)fail("开始得太快了，请稍后再试",429,"RUN_RATE_LIMIT");

  const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);
  const token=base64url(bytes),tokenHash=await sha256(token);
  const startedAt=new Date(),expiresAt=new Date(startedAt.getTime()+20*60*1000);
  const {data,error}=await admin.from("stack_runs").insert({
    user_id:member.user_id,
    member_id:member.id,
    run_token_hash:tokenHash,
    theme_id:themeId,
    game_version:version,
    started_at:startedAt.toISOString(),
    expires_at:expiresAt.toISOString()
  }).select("id,started_at,expires_at").single();
  if(error)fail("暂时无法开始线上计分",503);
  return {run_id:data.id,run_token:token,started_at:data.started_at,expires_at:data.expires_at,game_version:GAME_VERSION};
}

async function submitRun(req:Request,body:any){
  const member=await identify(req);
  await accountLimit(member.user_id,"submit_run",60);
  const token=String(body.run_token||"");
  const height=Number(body.height);
  const perfectCount=Number(body.perfect_count);
  const maxCombo=Number(body.max_combo);
  const durationMs=Number(body.duration_ms);
  const themeId=String(body.theme_id||"");
  const version=String(body.game_version||"");

  if(!/^[A-Za-z0-9_-]{40,80}$/.test(token))fail("本局凭证无效",400,"INVALID_RUN_TOKEN");
  const tokenHash=await sha256(token);
  const {data:run,error:runError}=await admin.from("stack_runs").select("*")
    .eq("run_token_hash",tokenHash).eq("user_id",member.user_id).maybeSingle();
  if(runError)fail("线上成绩校验失败",503);
  if(!run)fail("本局凭证不存在或已过期",404,"RUN_NOT_FOUND");
  if(run.submitted_at)fail("本局成绩已经提交",409,"RUN_ALREADY_SUBMITTED");

  const now=Date.now(),serverElapsed=now-new Date(run.started_at).getTime();
  let reason="";
  if(!Number.isSafeInteger(height)||height<0||height>200)reason="height_out_of_range";
  else if(!Number.isSafeInteger(perfectCount)||perfectCount<0||perfectCount>height)reason="perfect_count_invalid";
  else if(!Number.isSafeInteger(maxCombo)||maxCombo<0||maxCombo>perfectCount)reason="max_combo_invalid";
  else if(!Number.isSafeInteger(durationMs)||durationMs<250||durationMs>1200000)reason="duration_out_of_range";
  else if(version!==GAME_VERSION||version!==run.game_version)reason="game_version_mismatch";
  else if(themeId!==run.theme_id||!["night","sand","slate","forest"].includes(themeId))reason="theme_mismatch";
  else if(now>new Date(run.expires_at).getTime())reason="run_expired";
  else if(durationMs>serverElapsed+20000)reason="duration_clock_mismatch";
  else if(height>0&&durationMs<500+height*280)reason="height_too_fast";

  const submittedAt=new Date(now).toISOString();
  const validHeight=Number.isSafeInteger(height)&&height>=0&&height<=200?height:null;
  const validPerfect=validHeight!==null&&Number.isSafeInteger(perfectCount)&&perfectCount>=0&&perfectCount<=validHeight?perfectCount:null;
  const validCombo=validPerfect!==null&&Number.isSafeInteger(maxCombo)&&maxCombo>=0&&maxCombo<=validPerfect?maxCombo:null;
  const validDuration=Number.isSafeInteger(durationMs)&&durationMs>=250&&durationMs<=1200000?durationMs:null;
  const patch={
    height:validHeight,
    perfect_count:validPerfect,
    max_combo:validCombo,
    duration_ms:validDuration,
    submitted_at:submittedAt,
    verified:!reason,
    rejection_reason:reason||null
  };
  const {data:updated,error:updateError}=await admin.from("stack_runs").update(patch)
    .eq("id",run.id).is("submitted_at",null).select("id,verified").maybeSingle();
  if(updateError)fail("线上成绩校验失败",503);
  if(!updated)fail("本局成绩已经提交",409,"RUN_ALREADY_SUBMITTED");
  if(reason)fail("本局成绩未通过服务器校验",422,reason.toUpperCase());

  leaderboardCache=null;
  return {accepted:true,height,perfect_count:perfectCount,max_combo:maxCombo,leaderboard:await leaderboard(req)};
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(req)});
  if(req.method!=="POST")return reply(req,{error:"仅支持 POST"},405);
  const origin=req.headers.get("origin")||"";
  if(origin&&!ORIGINS.has(origin))return reply(req,{error:"来源未获授权"},403);
  try{
    const body=await readBody(req);
    const action=body.action===undefined?"leaderboard":body.action;
    if(typeof action!=="string"||!["leaderboard","start_run","submit_run"].includes(action))fail("未知操作",400,"UNKNOWN_ACTION");
    const limit=action==="start_run"?30:60;
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
