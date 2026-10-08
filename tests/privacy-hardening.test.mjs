import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const auth=read('shared/toolbox-auth.js');
const migration=read('supabase/migrations/20261008023746_privacy_member_access_and_audit_minimization.sql');

test('cross-tab session notification does not include credentials',()=>{
 assert.match(auth,/postMessage\(\{source:tabId,event\}\)/);
 assert.doesNotMatch(auth,/postMessage\(\{source:tabId,event,session\}\)/);
 assert.match(auth,/authGeneration\+\+;session=readStored\(\)/);
});
test('members client role gets only the three display columns',()=>{
 assert.match(migration,/REVOKE SELECT ON TABLE public\.members FROM authenticated/);
 assert.match(migration,/GRANT SELECT \(id, nickname, color\) ON TABLE public\.members TO authenticated/);
 const recovery=read('supabase/schema/post-migration-manual-objects.sql');
 assert.match(recovery,/GRANT SELECT \(id,nickname,color\) ON TABLE public\."members" TO authenticated/);
 assert.doesNotMatch(recovery,/GRANT SELECT ON TABLE public\."members" TO authenticated/);
});
test('access auditing minimizes payloads and retention never deletes business tables',()=>{
 assert.match(migration,/CREATE OR REPLACE FUNCTION private\.log_access_change/);
 assert.match(migration,/jsonb_strip_nulls\(jsonb_build_object/);
 assert.doesNotMatch(migration,/v_old\s*:=\s*to_jsonb\(OLD\);/i);
 assert.match(migration,/interval '180 days'/);
 assert.match(migration,/DELETE FROM private\.access_audit_log/);
 assert.doesNotMatch(migration,/DELETE FROM (?:public\.night_shifts|public\.staff|public\.dinner_history)/i);
});
for(const name of ['pictionary','blackjack','flappy','stack']){
 test(name+' Edge Function does not expose untrusted error objects',()=>{
  const s=read('supabase/functions/'+name+'-game/index.ts');
  assert.match(s,/safeToExpose/);
  assert.match(s,/INTERNAL_ERROR/);
  assert.doesNotMatch(s,/console\.error\((?:error|e)\)/);
  assert.doesNotMatch(s,/error:\s*\(error as Error\)\?\.message/);
 });
}
