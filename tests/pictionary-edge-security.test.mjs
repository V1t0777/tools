import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const source=stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/pictionary-game/index.ts',import.meta.url),'utf8').replace(/^import .*\n/,''));
function setup({limited=false,unavailable=false,active=true,roomMember=false}={}){
  let handler;const writes=[],limits=[],reads=[];
  const oldRoom={id:'r1',status:'playing',current_round_no:1,ends_at:new Date(0).toISOString(),last_activity_at:new Date(0).toISOString()};
  function query(table){
    reads.push(table);let mutation=false;
    const q={select(){return q;},eq(){return q;},neq(){return q;},order(){return q;},limit(){return q;},in(){return q;},maybeSingle(){return q;},single(){return q;},update(){mutation=true;return q;},insert(){mutation=true;return q;},delete(){mutation=true;return q;},then(resolve,reject){
      if(mutation)writes.push(table);
      const data=table==='members'?{id:'m1',user_id:'u1',nickname:'friend'}:table==='pictionary_rooms'?oldRoom:table==='pictionary_players'?(roomMember?{active:true,user_id:'u1'}:null):null;
      return Promise.resolve({data,error:null}).then(resolve,reject);
    }};return q;
  }
  vm.runInNewContext(source,{Request,Response,TextEncoder,TextDecoder,Uint8Array,crypto:webcrypto,console:{error(){}},Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://example.supabase.co':'mock'},serve:fn=>handler=fn},createClient:()=>({from:query,rpc:async(name,args)=>{
    if(name==='toolbox_session_status')return {data:{active,member_id:'m1'},error:null};
    limits.push(args);return {data:!limited,error:unavailable?{}:null};
  }})});
  const call=async(body,extra={})=>{
    const response=await handler(new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer valid',apikey:'public','content-type':'application/json',...extra},body:typeof body==='string'?body:JSON.stringify(body)}));
    return {status:response.status,body:await response.json()};
  };return {call,writes,limits,reads};
}
test('nonmembers cannot advance expired rooms via state or unknown actions',async()=>{
  for(const action of ['state','close_room','nonsense']){
    const s=setup();const r=await s.call({action,room_id:'r1'});assert.equal(r.status,action==='nonsense'?400:403);assert.deepEqual(s.writes,[]);
  }
});
test('join code does not permit a nonmember to maintain an active game',async()=>{
  const s=setup();assert.equal((await s.call({action:'join_room',code:'ABC234'})).status,403);assert.deepEqual(s.writes,[]);
});
test('rate limiting uses authenticated identity and separate action namespace',async()=>{
  const s=setup();assert.equal((await s.call({action:'me'},{'x-real-ip':'spoofed'})).status,200);
  assert.equal(s.limits[0].p_action,'pictionary:me');assert.match(s.limits[0].p_key,/^[0-9a-f]{64}$/);assert.equal(s.limits[0].p_limit,60);
  await s.call({action:'me'},{'x-real-ip':'different'});assert.equal(s.limits[0].p_key,s.limits[1].p_key);
});
test('rate denial and unavailable limiter fail before game mutations',async()=>{
  for(const [config,status] of [[{limited:true},429],[{unavailable:true},503]]){
    const s=setup(config);assert.equal((await s.call({action:'create_room'})).status,status);assert.deepEqual(s.writes,[]);
  }
});
test('revoked sessions cannot reach limiter or game state',async()=>{
  const s=setup({active:false});assert.equal((await s.call({action:'me'})).status,403);assert.deepEqual(s.limits,[]);assert.deepEqual(s.reads,[]);
});
test('malformed, oversized and unknown requests rejected before database calls',async()=>{
  for(const body of ['null','[]','{',JSON.stringify({action:'__proto__'}),JSON.stringify({action:'me',data:'x'.repeat(1024*1024)})]){
    const s=setup();assert.ok([400,413].includes((await s.call(body)).status));assert.deepEqual(s.reads,[]);assert.deepEqual(s.limits,[]);
  }
});

