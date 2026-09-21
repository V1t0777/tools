import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const URL=Deno.env.get("SUPABASE_URL")!;
function adminKey(){
  try{
    const raw=Deno.env.get("SUPABASE_SECRET_KEYS");
    if(raw){
      const keys=JSON.parse(raw);
      if(keys?.default)return keys.default;
    }
  }catch{}
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
}
const ADMIN_KEY=adminKey();
if(!ADMIN_KEY)throw new Error("服务端数据库密钥未配置");
const admin=createClient(URL,ADMIN_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const ORIGINS=new Set(["https://v1t0777.github.io","https://zhao-toolbox-secure.pages.dev","http://localhost:8000","http://127.0.0.1:8000"]);
const headers=(req:Request)=>({"Access-Control-Allow-Origin":ORIGINS.has(req.headers.get("origin")||"")?(req.headers.get("origin")||""):"https://v1t0777.github.io","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Vary":"Origin"});
const reply=(req:Request,body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:headers(req)});
function fail(message:string,status=400):never{const e=new Error(message) as Error&{status?:number};e.status=status;throw e;}
function code(){const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789",a=new Uint8Array(6);crypto.getRandomValues(a);return [...a].map(x=>chars[x%chars.length]).join("");}
function shuffle<T>(items:T[]){const a=[...items];for(let i=a.length-1;i;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}

async function identify(req:Request){
  const authorization=req.headers.get("authorization")||"";if(!authorization.startsWith("Bearer "))fail("请先登录",401);
  const key=req.headers.get("apikey")||Deno.env.get("SUPABASE_ANON_KEY")||"";
  const client=createClient(URL,key,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await client.rpc("toolbox_session_status");if(error||!data?.active||!data?.member_id)fail("当前账号不在工具箱成员名单中",403);
  const {data:member,error:memberError}=await admin.from("members").select("id,user_id,nickname,color").eq("id",data.member_id).maybeSingle();
  if(memberError){console.error("members lookup failed",memberError);fail("成员资料读取失败，请稍后重试",503);}
  if(!member)fail("成员资料不存在",403);return member;
}
async function room(id:string){const {data}=await admin.from("pictionary_rooms").select("*").eq("id",id).maybeSingle();if(!data)fail("房间不存在",404);return data;}
async function player(roomId:string,userId:string){const {data}=await admin.from("pictionary_players").select("*").eq("room_id",roomId).eq("user_id",userId).eq("active",true).maybeSingle();if(!data)fail("你不在这个房间",403);return data;}
async function players(roomId:string){
  const {data,error}=await admin.from("pictionary_players").select("user_id,display_name,seat,score,ready,active,joined_at").eq("room_id",roomId).eq("active",true).order("seat");if(error)throw error;
  const ids=(data||[]).map(x=>x.user_id);let members:any[]=[];
  if(ids.length){const out=await admin.from("members").select("id,user_id,nickname,color").in("user_id",ids);if(out.error){console.error("room members lookup failed",out.error);fail("成员资料读取失败，请稍后重试",503);}members=out.data||[];}
  const map=new Map(members.map(m=>[m.user_id,m]));
  return (data||[]).map(p=>({member_id:map.get(p.user_id)?.id||p.user_id,user_id:p.user_id,nickname:map.get(p.user_id)?.nickname||p.display_name,color:map.get(p.user_id)?.color||"#8EC5FF",turn_order:p.seat-1,score:p.score,ready:p.ready,joined_at:p.joined_at}));
}
async function makeRound(r:any,ps:any[]){
  const drawer=ps[(r.current_round_no-1)%ps.length];if(!drawer)fail("没有可用画手");
  const {data:exists}=await admin.from("pictionary_rounds").select("id").eq("room_id",r.id).eq("round_no",r.current_round_no).maybeSingle();if(exists)return;
  const {data:pool,error}=await admin.from("pictionary_words").select("id,word,category,difficulty,use_count,last_used_at").eq("active",true).order("use_count").order("last_used_at",{ascending:true,nullsFirst:true}).limit(42);if(error||!pool||pool.length<3)fail("词库暂时不可用",503);
  const chosen=shuffle(pool).slice(0,3);const {error:insertError}=await admin.from("pictionary_rounds").insert({room_id:r.id,round_no:r.current_round_no,drawer_user_id:drawer.user_id,status:"choosing",option_word_ids:chosen.map(x=>x.id)});if(insertError)throw insertError;
  const now=new Date().toISOString();await Promise.all(chosen.map(w=>admin.from("pictionary_words").update({use_count:w.use_count+1,last_used_at:now}).eq("id",w.id)));
}
async function state(roomId:string,member:any){
  const r=await room(roomId);await player(roomId,member.user_id);const ps=await players(roomId);const byUser=new Map(ps.map(p=>[p.user_id,p]));let roundData:any=null,answer=null,revealed_answer=null,options:any=null,guesses:any[]=[];
  if(r.current_round_no>0){
    const {data:rd}=await admin.from("pictionary_rounds").select("*").eq("room_id",roomId).eq("round_no",r.current_round_no).maybeSingle();
    if(rd){
      const privileged=member.user_id===rd.drawer_user_id||["summary","finished"].includes(r.status);
      const hintUnlocked=privileged||(r.status==="playing"&&rd.ends_at&&new Date(rd.ends_at).getTime()-Date.now()<=30000);
      roundData={id:rd.id,round_number:rd.round_no,drawer_member_id:byUser.get(rd.drawer_user_id)?.member_id||rd.drawer_user_id,drawer_nickname:byUser.get(rd.drawer_user_id)?.nickname||"好友",category:hintUnlocked?rd.category:null,difficulty:rd.difficulty,char_count:rd.word_length,hint:hintUnlocked?(rd.hint||`它属于「${rd.category||'常见事物'}」类`):null,started_at:rd.started_at,ends_at:rd.ends_at};
      if(member.user_id===rd.drawer_user_id)answer=rd.answer;if(["summary","finished"].includes(r.status))revealed_answer=rd.answer;
      const {data:gs}=await admin.from("pictionary_guesses").select("user_id,guess_text,is_correct,score_awarded,created_at").eq("round_id",rd.id).order("created_at").limit(80);guesses=(gs||[]).map(g=>({member_id:byUser.get(g.user_id)?.member_id||g.user_id,nickname:byUser.get(g.user_id)?.nickname||"好友",text:g.is_correct?"":g.guess_text,is_correct:g.is_correct,score_awarded:g.score_awarded,created_at:g.created_at}));
      if(r.status==="choosing"&&r.current_drawer_user_id===member.user_id){const {data:ws}=await admin.from("pictionary_words").select("id,word,category,difficulty").in("id",rd.option_word_ids||[]);options=(ws||[]).map(w=>({...w,id:String(w.id)}));}
    }
  }
  return {room:{id:r.id,code:r.room_code,host_member_id:byUser.get(r.host_user_id)?.member_id||r.host_user_id,status:r.status,round_no:r.current_round_no,rounds_per_player:r.rounds_per_player,total_rounds:r.total_rounds,current_drawer_member_id:byUser.get(r.current_drawer_user_id)?.member_id||r.current_drawer_user_id,ends_at:r.ends_at,summary_until:r.summary_until},players:ps.map(({user_id,...p})=>p),round:roundData,answer,revealed_answer,options,guesses};
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:headers(req)});if(req.method!=="POST")return reply(req,{error:"仅支持 POST"},405);
  const origin=req.headers.get("origin")||"";if(origin&&!ORIGINS.has(origin))return reply(req,{error:"来源未获授权"},403);
  try{
    const member=await identify(req);const b=await req.json().catch(()=>({}));const action=String(b.action||"");if(action==="me")return reply(req,{member});
    if(action==="create_room"){
      let r:any=null;for(let i=0;i<8&&!r;i++){const out=await admin.from("pictionary_rooms").insert({room_code:code(),host_user_id:member.user_id,status:"lobby"}).select("*").single();if(!out.error)r=out.data;}if(!r)fail("暂时无法生成房间码",503);
      const {error}=await admin.from("pictionary_players").insert({room_id:r.id,user_id:member.user_id,display_name:member.nickname,seat:1,ready:true,active:true});if(error)throw error;return reply(req,{state:await state(r.id,member)});
    }
    if(action==="join_room"){
      const c=String(b.code||"").toUpperCase().replace(/[^A-Z2-9]/g,"").slice(0,6);const {data:r}=await admin.from("pictionary_rooms").select("*").eq("room_code",c).maybeSingle();if(!r)fail("没有找到这个房间",404);
      const {data:old}=await admin.from("pictionary_players").select("*").eq("room_id",r.id).eq("user_id",member.user_id).maybeSingle();if(old&&!old.active)await admin.from("pictionary_players").update({active:true}).eq("room_id",r.id).eq("user_id",member.user_id);if(!old){if(r.status!=="lobby")fail("对局已经开始，只有原房间成员可以重连");const ps=await players(r.id);if(ps.length>=8)fail("房间已满");const {error}=await admin.from("pictionary_players").insert({room_id:r.id,user_id:member.user_id,display_name:member.nickname,seat:ps.length+1});if(error)throw error;}return reply(req,{state:await state(r.id,member)});
    }
    const id=String(b.room_id||"");const r=await room(id);await player(id,member.user_id);if(action==="state")return reply(req,{state:await state(id,member)});
    if(action==="toggle_ready"){if(r.status!=="lobby")fail("当前不能修改准备状态");if(r.host_user_id===member.user_id)fail("房主默认已准备");const p=await player(id,member.user_id);await admin.from("pictionary_players").update({ready:!p.ready,updated_at:new Date().toISOString()}).eq("room_id",id).eq("user_id",member.user_id);return reply(req,{state:await state(id,member)});}
    if(action==="start_game"){
      if(r.host_user_id!==member.user_id)fail("只有房主可以开始");if(r.status!=="lobby")fail("游戏已经开始");const ps=await players(id);if(ps.length<2)fail("至少需要 2 人");if(ps.some(p=>p.user_id!==r.host_user_id&&!p.ready))fail("还有玩家未准备");await admin.from("pictionary_rounds").delete().eq("room_id",id);await admin.from("pictionary_players").update({score:0}).eq("room_id",id);const total=ps.length*r.rounds_per_player;await admin.from("pictionary_rooms").update({status:"choosing",current_round_no:1,total_rounds:total,current_drawer_user_id:ps[0].user_id,ends_at:null,summary_until:null,finished_at:null,updated_at:new Date().toISOString()}).eq("id",id);const fresh=await room(id);await makeRound(fresh,ps);return reply(req,{state:await state(id,member)});
    }
    if(action==="choose_word"){
      if(r.status!=="choosing"||r.current_drawer_user_id!==member.user_id)fail("现在不是你的选题阶段");const {data:rd}=await admin.from("pictionary_rounds").select("*").eq("room_id",id).eq("round_no",r.current_round_no).single();const wordId=Number(b.option_id);if(!(rd.option_word_ids||[]).map(Number).includes(wordId))fail("题目选项无效");const {data:w}=await admin.from("pictionary_words").select("*").eq("id",wordId).single();const ends=new Date(Date.now()+60000).toISOString();await admin.from("pictionary_rounds").update({word_id:w.id,answer:w.word,category:w.category,difficulty:w.difficulty,word_length:Array.from(w.word).length,hint:`它属于「${w.category}」类`,status:"drawing",started_at:new Date().toISOString(),ends_at:ends}).eq("id",rd.id);await admin.from("pictionary_rooms").update({status:"playing",ends_at:ends,summary_until:null,updated_at:new Date().toISOString()}).eq("id",id);return reply(req,{state:await state(id,member)});
    }
    if(action==="guess"){const {data,error}=await admin.rpc("pictionary_submit_guess_service",{p_room_id:id,p_user_id:member.user_id,p_guess:String(b.text||"").trim()});if(error)fail(error.message);return reply(req,{...(data||{}),state:await state(id,member)});}
    if(action==="finish_round"){if(r.status==="playing"){if(r.ends_at&&new Date(r.ends_at).getTime()>Date.now()+700)fail("本轮仍在进行");await admin.from("pictionary_rooms").update({status:"summary",ends_at:null,summary_until:new Date(Date.now()+6000).toISOString(),updated_at:new Date().toISOString()}).eq("id",id).eq("status","playing");await admin.from("pictionary_rounds").update({status:"ended",ended_at:new Date().toISOString()}).eq("room_id",id).eq("round_no",r.current_round_no);}return reply(req,{state:await state(id,member)});}
    if(action==="next_round"){
      const fresh=await room(id);if(fresh.status!=="summary")return reply(req,{state:await state(id,member)});if(fresh.summary_until&&new Date(fresh.summary_until).getTime()>Date.now()+700)fail("本轮结果仍在展示");const ps=await players(id);if(fresh.current_round_no>=fresh.total_rounds)await admin.from("pictionary_rooms").update({status:"finished",current_drawer_user_id:null,summary_until:null,finished_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",id).eq("status","summary");else{const next=fresh.current_round_no+1,drawer=ps[(next-1)%ps.length];const {data:updated}=await admin.from("pictionary_rooms").update({status:"choosing",current_round_no:next,current_drawer_user_id:drawer.user_id,ends_at:null,summary_until:null,updated_at:new Date().toISOString()}).eq("id",id).eq("status","summary").select("*").maybeSingle();if(updated)await makeRound(updated,ps);}return reply(req,{state:await state(id,member)});
    }
    if(action==="play_again"){if(r.host_user_id!==member.user_id)fail("只有房主可以再开一局");if(r.status!=="finished")fail("本局尚未结束");await admin.from("pictionary_rounds").delete().eq("room_id",id);await admin.from("pictionary_players").update({score:0,ready:false,updated_at:new Date().toISOString()}).eq("room_id",id);await admin.from("pictionary_players").update({ready:true}).eq("room_id",id).eq("user_id",member.user_id);await admin.from("pictionary_rooms").update({status:"lobby",current_round_no:0,total_rounds:0,current_drawer_user_id:null,ends_at:null,summary_until:null,finished_at:null,updated_at:new Date().toISOString()}).eq("id",id);return reply(req,{state:await state(id,member)});}
    fail("未知操作");
  }catch(e){console.error(e);return reply(req,{error:(e as Error)?.message||"服务器暂时不可用"},(e as any)?.status||400);}
});
