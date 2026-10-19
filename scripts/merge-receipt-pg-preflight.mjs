#!/usr/bin/env node
/**
 * P3.20: disposable LOCAL PostgreSQL probe only; NEVER production.
 * Requires opt-in, a NEW empty local database and three pre-provisioned
 * NOLOGIN roles in a separate disposable PostgreSQL CLUSTER.
 * Refuses unexpected server address, database owner, schema or objects.
 * Never creates cluster-global roles or changes existing database content.
 */
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';

const uidA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const uidB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const draftSql=new URL('../supabase/drafts/merge-isle-p3.16-NOT-APPLIED.sql',import.meta.url);

export function parseDisposableDbUrl(value) {
  if(typeof value!=='string'||value.length>2048)return null;
  let u;try{u=new URL(value);}catch{return null;}
  if(!['postgres:','postgresql:'].includes(u.protocol)||
    !['localhost','127.0.0.1','[::1]'].includes(u.hostname)||
    u.search!==''||u.hash!==''||!u.username)return null;
  let db;try{db=decodeURIComponent(u.pathname.slice(1));}catch{return null;}
  if(!/^merge_receipt_test_[a-z0-9_]{3,48}$/.test(db))return null;
  return Object.freeze({PGHOST:u.hostname==='[::1]'?'::1':u.hostname,
    PGPORT:u.port||'5432',PGDATABASE:db,PGUSER:decodeURIComponent(u.username),
    PGPASSWORD:decodeURIComponent(u.password),PGSSLMODE:'disable',PGSERVICE:'',PGHOSTADDR:''});
}
function querySync(env,sql,{file=false}={}){
  const r=spawnSync('psql',['-X','-q','-t','-A','-v','ON_ERROR_STOP=1',file?'-f':'-c',sql],
    {env:{...process.env,...env,PGHOSTADDR:''},encoding:'utf8',timeout:15000,maxBuffer:100000});
  if(r.status!==0)throw Error('Disposable PostgreSQL command failed');
  return r.stdout.trim();
}
function queryAsync(env,sql) {
  return new Promise((resolve,reject)=>{
    const p=spawn('psql',['-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-c',sql],
      {env:{...process.env,...env,PGHOSTADDR:''},stdio:['ignore','pipe','ignore']});
    let value='';p.stdout.on('data',b=>{value+=String(b)});
    p.on('error',()=>reject(Error('psql unavailable')));
    p.on('close',code=>code===0?resolve(value.trim()):reject(Error('Postgres query failed')));
  });
}
function ensure(ok,message){if(!ok)throw Error(message);}

/**
 * Refuse databases that merely have a safe-looking name but contain any
 * user schema, public relation/function/type, extension or DB-level object.
 * All checks are read-only and precede the first mutating psql call.
 */
const pristineSql=[
  'SELECT CASE WHEN',
  "NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname NOT IN ('public','pg_catalog','information_schema') AND nspname NOT LIKE 'pg_%')",
  "AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')",
  "AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')",
  "AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public')",
  "AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname<>'plpgsql')",
  "AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_foreign_server)",
  "AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication)",
  "AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger)",
  "THEN 't' ELSE 'f' END"
].join('\n');

export function acceptsDisposableFingerprint(env,fingerprint){
  return !!env && !!fingerprint &&
    /^merge_receipt_test_[a-z0-9_]{3,48}$/.test(env.PGDATABASE) &&
    ['localhost','127.0.0.1','::1'].includes(env.PGHOST) &&
    /^[0-9]{1,5}$/.test(env.PGPORT) && Number(env.PGPORT)>0 && Number(env.PGPORT)<=65535 &&
    /^[a-z_][a-z0-9_]{0,62}$/i.test(env.PGUSER) &&
    env.PGHOSTADDR==='' && env.PGSERVICE==='' && env.PGSSLMODE==='disable' &&
    ['127.0.0.1','::1'].includes(fingerprint.serverAddress) &&
    fingerprint.database===env.PGDATABASE &&
    fingerprint.owner===env.PGUSER &&
    fingerprint.preparedRoles==='3' &&
    fingerprint.pristine==='t';
}

export async function runDisposablePostgresProbe(env){
  if(!env||!/^merge_receipt_test_[a-z0-9_]{3,48}$/.test(env.PGDATABASE)||
    !['localhost','127.0.0.1','::1'].includes(env.PGHOST)||
    !/^[0-9]{1,5}$/.test(env.PGPORT)||
    Number(env.PGPORT)<1||Number(env.PGPORT)>65535||
    !/^[a-z_][a-z0-9_]{0,62}$/i.test(env.PGUSER)||
    env.PGHOSTADDR!==''||env.PGSERVICE!==''||env.PGSSLMODE!=='disable')
    throw Error('Refusing non-disposable target');

  const fingerprint={
    serverAddress:querySync(env,'SELECT pg_catalog.inet_server_addr()::text'),
    database:querySync(env,'SELECT pg_catalog.current_database()'),
    owner:querySync(env,'SELECT pg_catalog.pg_get_userbyid(datdba) FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()'),
    preparedRoles:querySync(env,"SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated','service_role') AND NOT rolcanlogin"),
    pristine:querySync(env,pristineSql)
  };
  ensure(acceptsDisposableFingerprint(env,fingerprint),
    'Refusing a non-empty, non-local or non-owned database / missing NOLOGIN test roles');
  ensure(querySync(env,"SELECT pg_catalog.to_regclass('auth.users') IS NULL")==='t',
    'Refusing an existing Supabase schema');

  // The script deliberately does NOT CREATE ROLE: PostgreSQL roles are
  // cluster-global. Provision the three NOLOGIN roles in a fresh cluster
  // before running this probe; never mutate a shared local cluster.
  const bootstrap=[
    'BEGIN;',
    'CREATE SCHEMA auth;',
    'CREATE TABLE auth.users(id uuid PRIMARY KEY);',
    "INSERT INTO auth.users(id) VALUES ('"+uidA+"'),('"+uidB+"');",
    'COMMIT;'
  ].join('\n');
  querySync(env,bootstrap);
  querySync(env,fileURLToPath(draftSql),{file:true});
  ensure(querySync(env,"SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.merge_receipt_quotas'::regclass")==='t','RLS disabled');
  for(const role of ['anon','authenticated']) {
    ensure(querySync(env,"SELECT has_function_privilege('"+role+"','public.merge_consume_receipt_quota(uuid)','EXECUTE')")==='f','Unsafe function ACL');
    ensure(querySync(env,"SELECT has_table_privilege('"+role+"','public.merge_receipt_quotas','SELECT')")==='f','Unsafe table ACL');
  }
  ensure(querySync(env,"SELECT has_function_privilege('service_role','public.merge_consume_receipt_quota(uuid)','EXECUTE')")==='t','Missing service grant');
  const sql="SELECT public.merge_consume_receipt_quota('"+uidA+"'::uuid)";
  const result=await Promise.all(Array.from({length:40},()=>queryAsync(env,sql)));
  ensure(result.filter(x=>x==='t').length===12&&result.filter(x=>x==='f').length===28,'Concurrent quota exceeded');
  ensure(querySync(env,"SELECT attempts FROM public.merge_receipt_quotas WHERE user_id='"+uidA+"'")==='13','Quota saturation invalid');
  ensure(querySync(env,"SELECT public.merge_consume_receipt_quota('"+uidB+"'::uuid)")==='t','Cross-account quota failure');
  ensure(querySync(env,"SELECT attempts FROM public.merge_receipt_quotas WHERE user_id='"+uidB+"'")==='1','Account quota contaminated');
  querySync(env,"UPDATE public.merge_receipt_quotas SET window_started_at=pg_catalog.now()-INTERVAL '61 seconds' WHERE user_id='"+uidA+"'");
  ensure(querySync(env,sql)==='t','Quota does not reset');
  ensure(querySync(env,"SELECT attempts FROM public.merge_receipt_quotas WHERE user_id='"+uidA+"'")==='1','Reset count invalid');
  return Object.freeze({ok:true,concurrent:40,allowed:12,denied:28});
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]) {
  const env=parseDisposableDbUrl(process.env.MERGE_RECEIPT_TEST_DB_URL);
  if(process.argv.length!==3||process.argv[2]!=='--confirm-disposable-db'||!env){
    process.stderr.write('Refused. Requires --confirm-disposable-db and a fresh LOCAL merge_receipt_test_* database.\n');
    process.exitCode=2;
  }else{
    runDisposablePostgresProbe(env).then(r=>process.stdout.write(JSON.stringify(r)+'\n'))
      .catch(()=>{process.stderr.write('Disposable PostgreSQL test failed. Review only local test logs.\n');process.exitCode=1;});
  }
}
