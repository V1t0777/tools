import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const get=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const m=get('supabase/migrations/20261008030926_roster_mfa_stepup_and_login_anomaly_watch.sql');
test('sensitive roster write requires MFA after factor enrollment',()=>{
 assert.match(m,/roster_recent_mfa_stepup/);
 assert.match(m,/auth\.mfa_challenges/);
 assert.match(m,/interval '5 minutes'/);
 assert.match(m,/s\.aal::text='aal2'/);
 for(const table of ['staff','schedule_assignments','duty_types'])assert.match(m,new RegExp('ON public\\.'+table));
});
test('MFA enrollment prompts one-time code and never persists secret',()=>{
 const mfa=get('shared/toolbox-mfa.js');
 assert.match(mfa,/challenge_id:challenge\.id,code/);
 assert.match(mfa,/adoptVerifiedSession\(result\)/);
 assert.doesNotMatch(mfa,/localStorage\.setItem/);
 assert.doesNotMatch(mfa,/console\.log\(/);
 const admin=get('admin-night-shift/index.html');
 assert.match(admin,/ToolboxMFA\.ensureRecent\(\)/);
 assert.match(admin,/toolbox_login_security_alerts/);
});
test('login anomaly monitoring stores no raw network/browser values',()=>{
 assert.match(m,/CREATE TABLE private\.login_security_events/);
 assert.match(m,/REVOKE ALL ON private\.login_security_events FROM PUBLIC,anon,authenticated/);
 assert.match(m,/\*\/15 \* \* \* \*/);
 const definition=m.match(/CREATE TABLE private\.login_security_events\(([\s\S]+?)\);/);
 assert.ok(definition);
 assert.doesNotMatch(definition[1],/\bip\b|ip_address|user_agent/i);
 assert.match(m,/RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER/);
});
test('secure build includes explicit same-origin MFA module',()=>{
 assert.match(get('cloudflare-secure/build.sh'),/shared\/toolbox-mfa\.js/);
 assert.match(get('scripts/security-check.sh'),/node scripts\/xss-audit\.mjs/);
 assert.match(get('scripts/security-check.sh'),/node scripts\/privacy-scan\.mjs/);
});
