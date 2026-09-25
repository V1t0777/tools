import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const source=stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/stack-game/index.ts',import.meta.url),'utf8').replace(/^import .*\n/,''));
function setup({active=true,excluded=false,limited=false}={}){
  let handler;const writes=[],filters=[];
  const query=table=>{
    let single=false;const q={select(){return q;},order(){return q;},limit(){return q;},
      eq(k,v){filters.push([table,k,v]);return q;},gte(){return q;},
      maybeSingle(){single=true;return q;},single(){single=true;return q;},
      insert(){writes.push(table);return q;},update(){writes.push(table);return q;},
      then(resolve,reject){const member={id:'m1',user_id:'u1',nickname:'friend',color:'#ffffff',exclude_from_leaderboard:excluded};
        return Promise.resolve({data:table==='members'?(single?member:[member]):single?null:[],error:null}).then(resolve,reject);}
    };return q;
  };
  vm.runInNewContext(source,{Request,Response,TextEncoder,TextDecoder,Uint8Array,btoa,crypto:webcrypto,console:{error(){}},
    Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://example.invalid':'mock'},serve:fn=>handler=fn},
    createClient:()=>({from:query,rpc:async name=>({data:name==='stack_rate_limit_check'?!limited:{active,member_id:'m1'},error:null}),
      auth:{getUser:async token=>({data:{user:token==='valid'?{id:'u1'}:null},error:null})}})});
  async function call(action,token=null,body={}){
    const headers={'content-type':'application/json',apikey:'public'};if(token)headers.authorization='Bearer '+token;
    const response=await handler(new Request('https://example.invalid',{method:'POST',headers,body:JSON.stringify({action,...body})}));
    return {status:response.status,...await response.json()};
  }
  return {call,writes,filters};
}
test('Stack permits public leaderboard but authenticates game writes',async()=>{
  const s=setup();assert.equal((await s.call('leaderboard')).status,200);
  for(const token of [null,'invalid','sb_publishable_example'])assert.equal((await s.call('start_run',token)).status,401);
  assert.deepEqual(s.writes,[]);
});
test('Stack revoked and excluded accounts cannot start games',async()=>{
  for(const config of [{active:false},{excluded:true}]){
    const s=setup(config);assert.equal((await s.call('start_run','valid')).status,403);assert.deepEqual(s.writes,[]);
  }
});
test('Stack submitted token lookup is bound to verified user',async()=>{
  const s=setup();assert.equal((await s.call('submit_run','valid',{run_token:'a'.repeat(43)})).status,404);
  assert.ok(s.filters.some(([table,key,value])=>table==='stack_runs'&&key==='user_id'&&value==='u1'));
  assert.deepEqual(s.writes,[]);
});
test('Stack limiter denial prevents writes',async()=>{
  const s=setup({limited:true});assert.equal((await s.call('start_run','valid')).status,429);assert.deepEqual(s.writes,[]);
});
