import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const root=new URL('../supabase/',import.meta.url);
const dir=new URL('migrations/',root);
const manifest=JSON.parse(readFileSync(new URL('migrations-history.manifest.json',root),'utf8'));
const files=readdirSync(dir).filter(x=>x.endsWith('.sql')).sort();
const expected=manifest.migrations.map(x=>x.version+'_'+x.name+'.sql').sort();

test('all applied migration versions have exactly one corresponding SQL file',()=>{
  assert.equal(manifest.source,'supabase_migrations.schema_migrations');
  assert.equal(manifest.count,manifest.migrations.length);
  assert.ok(manifest.count>=42,'baseline must retain the 42 recovered production versions');
  assert.deepEqual(files,expected,'no missing, duplicate or invented migration versions');
  const versions=manifest.migrations.map(x=>x.version);
  assert.deepEqual(versions,[...versions].sort());
  assert.equal(new Set(versions).size,versions.length);
});

test('verbatim migrations match the SHA-256 of SQL actually executed in production',()=>{
  let verbatim=0,redacted=0;
  for(const m of manifest.migrations){
    assert.match(m.version,/^\d{14}$/);
    assert.match(m.name,/^[a-z0-9_]+$/);
    assert.match(m.original_sha256,/^[0-9a-f]{64}$/);
    const sql=readFileSync(new URL(m.version+'_'+m.name+'.sql',dir),'utf8');
    assert.ok(sql.trim().length>0,'empty SQL file '+m.version);
    if(m.sanitized){redacted++;continue;}
    verbatim++;
    const digest=createHash('sha256').update(sql,'utf8').digest('hex');
    assert.equal(digest,m.original_sha256,'historical SQL changed for '+m.version);
  }
  assert.equal(verbatim,manifest.migrations.filter(m=>!m.sanitized).length);
  assert.equal(redacted,3);
});

test('privacy-stripped migration sources never expose live staff or account identity',()=>{
  const migrated=(version)=>{
    const m=manifest.migrations.find(x=>x.version===version);
    assert.ok(m,'version missing '+version);
    return readFileSync(new URL(m.version+'_'+m.name+'.sql',dir),'utf8');
  };
  const bootstrap=migrated('20260916134448');
  assert.doesNotMatch(bootstrap,/insert\s+into\s+public\.(?:staff|admin_users)\s*\(/i);
  assert.match(bootstrap,/OMITTED PRIVATE SEED/);
  assert.doesNotMatch(bootstrap,/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  for(const version of ['20260923152254','20260923165738']){
    const sql=migrated(version);
    const emails=[...sql.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)]
      .map(m=>m[0].toLowerCase());
    assert.deepEqual(emails,['test@example.invalid']);
  }
});
