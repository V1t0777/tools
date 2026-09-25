import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
for(const game of ['flappy','stack']){
  function setup({deny=false,unavailable=false}={}){
    const source=stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/'+game+'-game/index.ts',import.meta.url),'utf8').replace(/^import .*\n/,''));
    let handler;const calls=[],writes=[];
    function query(table){
      const q={select(){return q;},eq(){return q;},maybeSingle(){return q;},
        insert(){writes.push(table);return q;},update(){writes.push(table);return q;},
        then(resolve,reject){return Promise.resolve({data:{id:'m1',user_id:'u1',exclude_from_leaderboard:false},error:null}).then(resolve,reject);}
      };return q;
    }
    vm.runInNewContext(source,{Request,Response,TextEncoder,TextDecoder,Uint8Array,btoa,crypto:webcrypto,console:{error(){}},
      Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://example.invalid':'mock'},serve:fn=>handler=fn},
      createClient:()=>({from:query,auth:{getUser:async()=>({data:{user:{id:'u1'}},error:null})},
        rpc:async(name,args)=>{
          calls.push({name,args});
          if(name==='toolbox_session_status')return {data:{active:true,member_id:'m1'},error:null};
          const account=args.p_action.startsWith('account:');
          return {data:!(account&&deny),error:account&&unavailable?{}:null};
        }})});
    async function call(body,extra={}){
      const response=await handler(new Request('https://example.invalid',{method:'POST',headers:{authorization:'Bearer valid',apikey:'public',...extra},body:typeof body==='string'?body:JSON.stringify(body)}));
      return {status:response.status,...await response.json()};
    }
    return {call,calls,writes};
  }
  test(game+': account counters ignore spoofed IP and body identity',async()=>{
    const s=setup();
    for(const ip of ['1.2.3.4','5.6.7.8'])await s.call({action:'start_run',user_id:ip},{'cf-connecting-ip':ip,'x-real-ip':ip});
    const limits=s.calls.filter(c=>c.args?.p_action==='account:start_run');
    assert.equal(limits.length,2);assert.equal(limits[0].args.p_key,limits[1].args.p_key);
    assert.equal(limits[0].args.p_limit,30);assert.equal(limits[0].args.p_window_seconds,60);
    const expected=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(game+'|account|u1'))).toString('hex');
    assert.equal(limits[0].args.p_key,expected);
  });
  test(game+': denied or unavailable account limiter prevents mutation',async()=>{
    for(const action of ['start_run','submit_run'])for(const [config,status] of [[{deny:true},429],[{unavailable:true},503]]){
      const s=setup(config);assert.equal((await s.call({action})).status,status);assert.deepEqual(s.writes,[]);
      const last=s.calls.at(-1);assert.equal(last.args.p_action,'account:'+action);assert.equal(last.args.p_limit,action==='start_run'?30:60);
    }
  });
  test(game+': malformed and oversized bodies rejected before any RPC',async()=>{
    for(const [body,status] of [['null',400],['[]',400],['{',400],[{action:'__proto__'},400],[{action:{}},400],[{action:'start_run',data:'界'.repeat(6000)},413]]){
      const s=setup();assert.equal((await s.call(body)).status,status);assert.deepEqual(s.calls,[]);
    }
    const s=setup();assert.equal((await s.call({action:'start_run'},{'content-length':'99999'})).status,413);assert.deepEqual(s.calls,[]);
  });
}
