import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const source=readFileSync(new URL('../scripts/security-check.sh',import.meta.url),'utf8');
const block=source.match(/patterns=\(([\s\S]*?)\n\)/)[1];
const patterns=[...block.matchAll(/^  '(.+)'$/gm)].map(x=>x[1]);
function matches(pattern,value){
  const dir=mkdtempSync(join(tmpdir(),'toolbox-scan-'));
  try{
    writeFileSync(join(dir,'fixture.txt'),value);
    const result=spawnSync('git',['grep','--no-index','-lEI','-e',pattern,'--','fixture.txt'],{cwd:dir,encoding:'utf8'});
    assert.ok([0,1].includes(result.status),'Git scan must execute successfully');
    return result.status===0;
  }finally{rmSync(dir,{recursive:true,force:true});}
}
test('every production secret pattern detects a synthetic positive fixture',()=>{
  const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
  const fixtures=[
    ['postgresql', '://example:', 'fictional@localhost/db'].join(''),
    ['-----BEGIN ','PRIVATE KEY','-----'].join(''),
    'github_'+'pat_'+'x'.repeat(24),
    'gh'+'p_'+'x'.repeat(24),
    's'+'k-'+'x'.repeat(24),
    'xox'+'b-'+'x'.repeat(24),
    'sb_'+'secret_'+'x'.repeat(24),
    [b64({alg:'HS256',typ:'JWT'}),b64({role:'service_role',exp:1}),'x'.repeat(43)].join('.')
  ];
  assert.equal(patterns.length,fixtures.length);
  patterns.forEach((pattern,i)=>assert.equal(matches(pattern,fixtures[i]),true,'pattern '+i));
});
test('public configuration and environment lookups do not trigger secret rules',()=>{
  for(const pattern of patterns)assert.equal(matches(pattern,'sb_publishable_'+'x'.repeat(32)+' SUPABASE_SERVICE_ROLE_KEY SUPABASE_SECRET_KEYS'),false);
});
test('scanner explicitly supplies dash-prefixed patterns and fails on execution errors',()=>{
  assert.match(source,/git grep -lEI -e "\$pattern"/);
  assert.match(source,/status=\$\?/);
  assert.match(source,/\[\[ "\$status" -ne 1 \]\]/);
  assert.match(source,/exit 2/);
  assert.ok(!source.includes(':(exclude)SECURITY.md'));
  assert.ok(!source.includes(':(exclude)docs/disaster-recovery.md'));
  assert.ok(!source.includes('git grep -n'));
});
