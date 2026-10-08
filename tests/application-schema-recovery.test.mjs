import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const base=new URL('../supabase/',import.meta.url);
const catalog=JSON.parse(readFileSync(new URL('schema/application-schema-catalog.json',base),'utf8'));
const manifest=JSON.parse(readFileSync(new URL('migrations-history.manifest.json',base),'utf8'));
const pre=readFileSync(new URL('schema/pre-migration-manual-tables.sql',base),'utf8');
const post=readFileSync(new URL('schema/post-migration-manual-objects.sql',base),'utf8');
const historical=manifest.migrations.map(m=>readFileSync(
  new URL('migrations/'+m.version+'_'+m.name+'.sql',base),'utf8')).join('\n');
const all=pre+'\n'+historical+'\n'+post;

test('application catalog captures every business schema object without private data rows',()=>{
  assert.equal(catalog.contains_user_rows,false);
  assert.deepEqual(catalog.counts,{
    tables:40,constraints:253,indexes:122,policies:47,triggers:15,functions:85,grants:51
  });
  for(const [key,count] of Object.entries(catalog.counts))
    assert.equal(catalog[key].length,count,key+' count drift');
  assert.doesNotMatch(JSON.stringify(catalog),/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
});

test('historical and companion sources name-cover 40 tables and 85 functions',()=>{
  const tables=new Set([...all.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public|private)\.\s*"?([a-z_][a-z0-9_]*)/gi)].map(m=>m[1]));
  const functions=new Set([...all.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public|private)\.\s*"?([a-z_][a-z0-9_]*)/gi)].map(m=>m[1]));
  assert.deepEqual(catalog.tables.filter(t=>!tables.has(t.name)).map(t=>t.schema+'.'+t.name),[]);
  assert.deepEqual(catalog.functions.filter(f=>!functions.has(f.name)).map(f=>f.schema+'.'+f.name),[]);
});

test('12 previously unmigrated table prerequisites are explicitly bootstrap-only',()=>{
  for(const name of ['members','night_shifts','pictionary_rooms','pictionary_words',
    'pictionary_players','pictionary_rounds','pictionary_round_results',
    'bead_groups','bead_group_members','bead_inventory','bead_projects','bead_inventory_events']){
    assert.ok(pre.includes('CREATE TABLE IF NOT EXISTS public."'+name+'"'),'missing '+name);
    assert.ok(pre.includes('ALTER TABLE public."'+name+'" ENABLE ROW LEVEL SECURITY'));
  }
  assert.doesNotMatch(pre,/CREATE TABLE IF NOT EXISTS private\."(?:admin_users|app_access)"/);
  assert.ok(pre.includes('CREATE OR REPLACE FUNCTION public.rls_auto_enable()'));
  assert.ok(post.includes('private.can_edit_bead_group'));
  assert.ok(post.includes('private.is_bead_group_member'));
  assert.ok(post.includes('REVOKE ALL PRIVILEGES ON TABLE'));
  assert.ok(!manifest.migrations.some(m=>m.name.includes('manual_tables')),
    'recovery-only prerequisites must not be counted as applied migrations');
});
