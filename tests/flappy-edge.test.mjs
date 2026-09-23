// Executes the actual Edge handler with a deterministic in-memory Supabase adapter.
// Live PostgreSQL triggers/RLS are covered separately by flappy-database.sql.
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {test} from 'node:test';

const source=stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/flappy-game/index.ts',import.meta.url),'utf8').replace(/^import .*\n/,''));
function setup(){
  const db={members:[{id:'m1',user_id:'u1',nickname:'好友',color:'#ffffff'},{id:'mt',user_id:'ut',nickname:'test'}],flappy_runs:[],flappy_best_scores:[],flappy_weekly_bests:[]};
  const users={good:{id:'u1',email:'friend@example.com'},test:{id:'ut',email:'TEST@test.com'},nonmember:{id:'ux',email:'x@example.com'}};
  let handler;
  function query(table){
    const filters=[];let action='select',values,one=false;
    const q={select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},is(k,v){filters.push(r=>(r[k]??null)===v);return q;},gte(k,v){filters.push(r=>r[k]>=v);return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},order(){return q;},limit(){return q;},maybeSingle(){one=true;return q;},single(){one=true;return q;},insert(v){action='insert';values=v;return q;},update(v){action='update';values=v;return q;},then(resolve,reject){
      try{
        let rows=db[table].filter(r=>filters.every(f=>f(r)));
        if(action==='insert'){const row={id:'run'+db[table].length,created_at:new Date().toISOString(),submitted_at:null,verified:false,...values};db[table].push(row);rows=[row];}
        if(action==='update')for(const row of rows){Object.assign(row,values);if(row.verified){for(const name of ['flappy_best_scores','flappy_weekly_bests']){const old=db[name].find(x=>x.user_id===row.user_id);if(!old||old.best_score<row.score){const best={user_id:row.user_id,member_id:row.member_id,best_score:row.score,bird_skin:row.bird_skin,achieved_at:row.submitted_at,week_start:'2026-09-21'};if(old)Object.assign(old,best);else db[name].push(best);}}}}
        return Promise.resolve({data:one?(rows[0]||null):rows,error:null}).then(resolve,reject);
      }catch(e){return Promise.reject(e).then(resolve,reject);}
    }};return q;
  }
  const context={Request,Response,TextEncoder,Uint8Array,Intl,Date,JSON,Set,Map,Error,Number,String,Math,Promise,btoa,crypto:webcrypto,console:{error(){}},
    Deno:{env:{get(k){return k==='SUPABASE_URL'?'https://example.supabase.co':'mock';}},serve(fn){handler=fn;}},
    createClient(url,key,opts){
      const token=opts?.global?.headers.Authorization?.slice(7);
      return {from:query,
        rpc:async()=>({data:{active:token!=='revoked',member_id:token==='test'?'mt':token==='nonmember'?null:'m1'},error:null}),
        auth:{getUser:async()=>({data:{user:users[token]||null},error:null}),
          admin:{getUserById:async id=>({data:{user:Object.values(users).find(u=>u.id===id)},error:null})}
        }
      };
    }
  };
  vm.runInNewContext(source,context);
  async function call(action,body={},token='good',origin='https://v1t0777.github.io'){
    const headers={'content-type':'application/json',apikey:'public',origin};if(token)headers.authorization='Bearer '+token;
    const response=await handler(new Request('https://example.test',{method:'POST',headers,body:JSON.stringify({action,...body})}));return {status:response.status,...await response.json()};
  }
  return {db,call};
}
const version='2026.09.23-leaderboard-v1';
const start={bird_skin:'warm',game_version:version};
async function issued(s){const r=await s.call('start_run',start);assert.equal(r.status,200);return {run_token:r.run_token,score:1,duration_ms:3000,...start};}
test('public read, guest/nonmember/test/invalid-token rejection',async()=>{
  const s=setup();assert.equal((await s.call('leaderboard',{},null)).status,200);
  for(const token of [null,'bad','nonmember','test'])assert.ok((await s.call('start_run',start,token)).status>=400);
  assert.equal((await s.call('start_run',start,'good','https://evil.test')).status,403);
  assert.equal((await s.call('start_run',{...start,game_version:'old'})).status,409);
});
test('valid score, one-time token, atomic racing claims, skin record',async()=>{
  const s=setup(),payload=await issued(s);
  const responses=await Promise.all([s.call('submit_run',payload),s.call('submit_run',payload)]);
  assert.deepEqual(responses.map(x=>x.status).sort(),[200,409]);
  assert.equal(s.db.flappy_best_scores[0].best_score,1);assert.equal(s.db.flappy_best_scores[0].bird_skin,'warm');
  assert.equal((await s.call('start_run',start)).status,429);
});
test('every invalid attempt consumes token without invalid CHECK values',async()=>{
  for(const change of [{score:999},{score:1.5},{duration_ms:-1},{duration_ms:99999999},{duration_ms:500,score:40},{bird_skin:'slate'},{game_version:'old'}]){
    const s=setup(),payload={...await issued(s),...change};
    assert.equal((await s.call('submit_run',payload)).status,422,JSON.stringify(change));
    const row=s.db.flappy_runs[0];assert.ok(row.submitted_at);assert.equal(row.verified,false);
    assert.ok(row.score===null||(row.score>=0&&row.score<=200));assert.ok(row.duration_ms===null||(row.duration_ms>=250&&row.duration_ms<=1200000));
    assert.equal((await s.call('submit_run',payload)).status,409);assert.equal(s.db.flappy_best_scores.length,0);
  }
});
test('expired, stolen, clock mismatch tokens rejected',async()=>{
  const s=setup(),payload=await issued(s);s.db.flappy_runs[0].expires_at=new Date(0).toISOString();
  assert.equal((await s.call('submit_run',payload)).code,'RUN_EXPIRED');
  const t=setup(),p=await issued(t);t.db.flappy_runs[0].user_id='someone-else';assert.equal((await t.call('submit_run',p)).status,404);
  const u=setup(),p2=await issued(u);assert.equal((await u.call('submit_run',{...p2,duration_ms:90000})).code,'DURATION_CLOCK_MISMATCH');
});
test('test account rows are excluded from both boards',async()=>{
  const s=setup();const row={user_id:'ut',member_id:'mt',best_score:99,bird_skin:'warm',achieved_at:new Date().toISOString()};s.db.flappy_best_scores.push(row);
  const r=await s.call('leaderboard',{},'test');assert.equal(r.excluded_account,true);assert.deepEqual(r.all_time,[]);assert.equal(r.viewer,null);
});

